import { browserManager } from "./browser";
import type { SearchResult, Store } from "./types";

/**
 * DoorDash API client.
 *
 * DoorDash uses Next.js with React Server Components. Their pages return
 * `text/x-component` RSC payloads, not JSON APIs. So we navigate to real
 * DoorDash pages, wait for them to render, and scrape data from the DOM.
 */

// ============================================================
// Store Info
// ============================================================

/**
 * Extract a store ID from a DoorDash store URL.
 */
export function parseStoreIdFromUrl(url: string): string | null {
  const convenienceMatch = url.match(/\/convenience\/store\/(\d+)/);
  if (convenienceMatch) return convenienceMatch[1];

  const storeMatch = url.match(/\/store\/[^/]+-(\d+)/);
  if (storeMatch) return storeMatch[1];

  const numericMatch = url.match(/\/(\d+)\/?$/);
  if (numericMatch) return numericMatch[1];

  return null;
}

/**
 * Get store info by navigating to the store page and scraping the DOM.
 */
export async function getStoreInfo(storeId: string, storeUrl: string): Promise<Store | null> {
  try {
    const page = await browserManager.getPage();

    await page.goto(storeUrl, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });

    // Wait for the page to render — look for a heading or the store name to appear
    try {
      await page.waitForSelector("h1", { timeout: 10_000 });
    } catch {
      // If no h1 appears, wait a flat amount and hope for the best
      await page.waitForTimeout(5000);
    }

    const pageData = await page.evaluate(() => {
      // --- Store Name ---
      const getName = () => {
        // Strategy 1: Page title "StoreName - DoorDash" or "Order from StoreName"
        const title = document.title || "";
        // Split on common separators
        const titleParts = title.split(/\s+[-|–—]\s+/);
        if (titleParts.length >= 2) {
          const candidate = titleParts[0].trim()
            .replace(/^Order from\s+/i, "")
            .replace(/\s+Delivery.*$/i, "");
          if (candidate && !candidate.toLowerCase().includes("doordash") && candidate.length > 1) {
            return candidate;
          }
        }

        // Strategy 2: h1 tag
        const h1 = document.querySelector("h1");
        if (h1?.textContent?.trim()) return h1.textContent.trim();

        // Strategy 3: og:title meta tag
        const ogTitle = document.querySelector('meta[property="og:title"]');
        if (ogTitle) {
          const content = ogTitle.getAttribute("content") || "";
          const parts = content.split(/\s+[-|–—]\s+/);
          if (parts[0]?.trim()) return parts[0].trim();
        }

        return null;
      };

      // --- Fee Info ---
      const bodyText = document.body.innerText || "";

      const hasPickup =
        !!document.querySelector('[data-testid*="pickup" i], [data-testid*="Pickup"], [aria-label*="ickup"]') ||
        (bodyText.toLowerCase().includes("pickup available") ||
         bodyText.toLowerCase().includes("switch to pickup"));

      const freeDeliveryMatch = bodyText.match(
        /free delivery[^$]*?\$(\d+(?:\.\d{2})?)/i
      ) || bodyText.match(
        /\$0\.00 delivery(?:\s+fee)?\s+(?:on orders |over |for orders? over )?\$(\d+(?:\.\d{2})?)/i
      );
      const deliveryFeeMatch = bodyText.match(
        /\$(\d+\.\d{2})\s+delivery fee/i
      );
      const serviceFeeMatch = bodyText.match(
        /\$(\d+\.\d{2})\s+service fee/i
      );

      return {
        name: getName(),
        hasPickup,
        freeDeliveryThreshold: freeDeliveryMatch ? parseFloat(freeDeliveryMatch[1]) : null,
        deliveryFee: deliveryFeeMatch ? parseFloat(deliveryFeeMatch[1]) : null,
        serviceFee: serviceFeeMatch ? parseFloat(serviceFeeMatch[1]) : null,
      };
    });

    return {
      id: storeId,
      name: pageData.name || `Store ${storeId}`,
      url: storeUrl,
      pickupAvailable: pageData.hasPickup,
      freeDeliveryThreshold: pageData.freeDeliveryThreshold,
      deliveryFee: pageData.deliveryFee,
      serviceFeeRate: null,
      minServiceFee: pageData.serviceFee,
    };
  } catch (error) {
    console.error(`Failed to get store info for ${storeId}:`, error);
    return null;
  }
}

// ============================================================
// Item Search
// ============================================================

/**
 * Search for items by navigating to the store's search page and scraping
 * rendered results from the DOM.
 *
 * DoorDash search URL: /convenience/store/{storeId}/search/{query}
 * This is a Next.js RSC page — the data comes embedded in the RSC stream,
 * not as a separate JSON response.
 */
export async function searchItems(
  storeId: string,
  query: string,
  _limit: number = 10
): Promise<SearchResult[]> {
  try {
    const page = await browserManager.getPage();

    const searchUrl = `https://www.doordash.com/convenience/store/${storeId}/search/${encodeURIComponent(query)}`;
    await page.goto(searchUrl, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });

    // Wait for item cards to appear — look for elements with prices
    try {
      await page.waitForFunction(
        () => {
          const text = document.body.innerText || "";
          // Check if any price-like string appeared in the body
          return /\$\d+\.\d{2}/.test(text);
        },
        { timeout: 10_000 }
      );
      // Give a bit more time for all items to render
      await page.waitForTimeout(2000);
    } catch {
      // If no prices appear, the search might have no results
      await page.waitForTimeout(3000);
    }

    return await scrapeSearchResults(page, storeId);
  } catch (error) {
    console.error(
      `Failed to search items at store ${storeId} for "${query}":`,
      error
    );
    return [];
  }
}

/**
 * Scrape item cards from the rendered DoorDash page.
 *
 * DoorDash renders items as card elements, typically anchor tags with
 * an image, name text, and a price. We find these by looking for elements
 * that contain both a $X.XX price and an image.
 */
async function scrapeSearchResults(
  page: { evaluate: <T>(fn: () => T) => Promise<T> },
  storeId: string
): Promise<SearchResult[]> {
  const items = await page.evaluate(() => {
    const results: Array<{
      name: string;
      price: string;
      imageUrl: string | null;
      itemId: string | null;
    }> = [];
    const seen = new Set<string>();

    // Strategy 1: Find item card elements using known selectors
    const selectorGroups = [
      // Specific DoorDash data-testid patterns
      '[data-testid*="MenuItem"]',
      '[data-testid*="StoreItem"]',
      '[data-testid*="ItemCard"]',
      // Links to item pages
      'a[href*="/store/"][href*="/item/"]',
      'a[href*="/convenience/"][href*="/item/"]',
    ];

    let cards: Element[] = [];
    for (const sel of selectorGroups) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) {
        cards = Array.from(els);
        break;
      }
    }

    // Strategy 2: Broader — find any anchor that has both a price and an image
    if (cards.length === 0) {
      const allAnchors = document.querySelectorAll("a[href]");
      cards = Array.from(allAnchors).filter((el) => {
        const text = el.textContent || "";
        return /\$\d+\.\d{2}/.test(text) && el.querySelector("img");
      });
    }

    // Strategy 3: Even broader — any div/article that has a price and image
    if (cards.length === 0) {
      const allEls = document.querySelectorAll("div, article, li");
      cards = Array.from(allEls).filter((el) => {
        const text = el.textContent || "";
        if (!/\$\d+\.\d{2}/.test(text)) return false;
        if (!el.querySelector("img")) return false;
        // Filter out large containers — item cards are typically small
        const children = el.querySelectorAll("div, article, li");
        // If this element contains other potential cards, it's a container, not a card
        const hasNestedPriceCards = Array.from(children).some(
          (child) => child !== el && /\$\d+\.\d{2}/.test(child.textContent || "") && child.querySelector("img")
        );
        return !hasNestedPriceCards;
      });
    }

    for (const el of cards) {
      const text = el.textContent || "";

      // Extract all prices
      const priceMatches = text.match(/\$\d+\.\d{2}/g);
      if (!priceMatches || priceMatches.length === 0) continue;
      // Use the first price (usually the main price)
      const price = priceMatches[0];

      // Extract name: get the text, remove prices, take the first meaningful line
      let cleanText = text;
      for (const p of priceMatches) {
        cleanText = cleanText.replace(p, "");
      }
      // Remove common UI text
      cleanText = cleanText
        .replace(/add to cart/gi, "")
        .replace(/out of stock/gi, "")
        .replace(/each/gi, "")
        .replace(/\(\d+ (?:ct|oz|fl oz|lb|pk|count)\)/gi, "");

      const lines = cleanText
        .split(/\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 1);
      const name = lines[0];
      if (!name || name.length < 2) continue;

      // Deduplicate
      if (seen.has(name)) continue;
      seen.add(name);

      // Extract item ID from href if available
      let itemId: string | null = null;
      const anchor = el.tagName === "A" ? el : el.querySelector("a[href]");
      if (anchor) {
        const href = anchor.getAttribute("href") || "";
        const idMatch = href.match(/\/item\/(\d+)/);
        if (idMatch) itemId = idMatch[1];
      }

      // Find image
      const imgEl = el.querySelector("img");
      const imageUrl = imgEl?.getAttribute("src") || null;

      results.push({ name, price, imageUrl, itemId });
    }

    return results;
  });

  return items.map(
    (item, i): SearchResult => ({
      itemId: item.itemId || `scraped-${storeId}-${i}-${Date.now()}`,
      storeId,
      name: item.name,
      description: "",
      price: parsePrice(item.price),
      unitPrice: null,
      imageUrl: item.imageUrl,
      inStock: true,
    })
  );
}

/**
 * Find a matching item at a different store by searching with the item name.
 */
export async function findMatchingItem(
  storeId: string,
  itemName: string,
  limit: number = 5
): Promise<SearchResult[]> {
  return searchItems(storeId, itemName, limit);
}

// ============================================================
// Network Request Capture (for debugging)
// ============================================================

/**
 * Navigate to a page and capture all network requests/responses.
 * Useful for debugging what DoorDash's page is doing.
 */
export async function captureNetworkRequests(
  storeUrl: string,
  durationMs: number = 10_000
): Promise<
  Array<{
    url: string;
    method: string;
    contentType: string;
    responsePreview: string;
  }>
> {
  const page = await browserManager.getPage();
  const captured: Array<{
    url: string;
    method: string;
    contentType: string;
    responsePreview: string;
  }> = [];

  const responseHandler = async (response: {
    url: () => string;
    request: () => { method: () => string };
    headers: () => Record<string, string>;
    text: () => Promise<string>;
  }) => {
    const url = response.url();
    // Only capture interesting requests (not static assets)
    if (
      url.includes("graphql") ||
      url.includes("/search") ||
      url.includes("/store/") ||
      url.includes("api")
    ) {
      try {
        const text = await response.text();
        captured.push({
          url,
          method: response.request().method(),
          contentType: response.headers()["content-type"] || "unknown",
          responsePreview: text.slice(0, 500),
        });
      } catch {
        /* ignore */
      }
    }
  };

  page.on("response", responseHandler);

  await page.goto(storeUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
  await page.waitForTimeout(durationMs);

  page.off("response", responseHandler);

  return captured;
}

// ============================================================
// Helpers
// ============================================================

function parsePrice(price: unknown): number {
  if (price === undefined || price === null) return 0;
  if (typeof price === "number") return price;
  if (typeof price === "string") {
    const cleaned = price.replace(/[$,]/g, "").trim();
    return parseFloat(cleaned) || 0;
  }
  return 0;
}
