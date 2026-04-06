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
 * Get store info. The store page itself is usually Cloudflare-blocked,
 * so we navigate to a search page (which works) and extract the store
 * name from the page title / breadcrumbs.
 */
export async function getStoreInfo(
  storeId: string,
  storeUrl: string
): Promise<{ store: Store | null; debug: string }> {
  try {
    const page = await browserManager.getPage();

    // Navigate to a search page — these bypass Cloudflare unlike store pages
    const searchUrl = `https://www.doordash.com/convenience/store/${storeId}/search/a`;
    await page.goto(searchUrl, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });

    // Wait for the page to render
    try {
      await page.waitForFunction(
        () => {
          const body = document.body.innerText || "";
          // Wait until we see prices or meaningful content
          return /\$\d+\.\d{2}/.test(body) || body.length > 200;
        },
        { timeout: 10_000 }
      );
      await page.waitForTimeout(1500);
    } catch {
      await page.waitForTimeout(3000);
    }

    const pageData = await page.evaluate(() => {
      const title = document.title || "";
      const bodyText = document.body.innerText || "";
      const url = window.location.href;

      // --- Store Name ---
      const getName = () => {
        // Strategy 1: Page title often contains store name
        // e.g., "Target - Search Results - DoorDash" or "Search a at Target"
        if (title) {
          // "StoreName - ..." pattern
          const dashParts = title.split(/\s+[-|–—]\s+/);
          for (const part of dashParts) {
            const cleaned = part.trim()
              .replace(/^Order from\s+/i, "")
              .replace(/\s+Delivery.*$/i, "")
              .replace(/^Search\s+.*\s+at\s+/i, "");
            if (cleaned && cleaned.length > 1 &&
                !cleaned.toLowerCase().includes("doordash") &&
                !cleaned.toLowerCase().includes("search") &&
                cleaned !== "a") {
              return cleaned;
            }
          }
          // "Search X at StoreName" pattern
          const atMatch = title.match(/at\s+([^-–—|]+)/i);
          if (atMatch) {
            const name = atMatch[1].trim();
            if (name && !name.toLowerCase().includes("doordash")) return name;
          }
        }

        // Strategy 2: og:title
        const ogEl = document.querySelector('meta[property="og:title"]');
        if (ogEl) {
          const content = ogEl.getAttribute("content") || "";
          const parts = content.split(/\s+[-|–—]\s+/);
          for (const part of parts) {
            const cleaned = part.trim();
            if (cleaned && cleaned.length > 1 && !cleaned.toLowerCase().includes("doordash")) {
              return cleaned;
            }
          }
        }

        // Strategy 3: Look for breadcrumb or header with store name
        const h1 = document.querySelector("h1")?.textContent?.trim();
        if (h1 && h1.length > 1 &&
            !h1.toLowerCase().includes("doordash") &&
            !h1.toLowerCase().includes("just a moment") &&
            !h1.toLowerCase().includes("www.")) {
          return h1;
        }

        return null;
      };

      const hasPickup =
        !!document.querySelector('[data-testid*="pickup" i], [data-testid*="Pickup"], [aria-label*="ickup"]') ||
        bodyText.toLowerCase().includes("pickup available") ||
        bodyText.toLowerCase().includes("switch to pickup");

      const freeDeliveryMatch = bodyText.match(/free delivery[^$]*?\$(\d+(?:\.\d{2})?)/i);
      const deliveryFeeMatch = bodyText.match(/\$(\d+\.\d{2})\s+delivery fee/i);
      const serviceFeeMatch = bodyText.match(/\$(\d+\.\d{2})\s+service fee/i);

      return {
        name: getName(),
        hasPickup,
        freeDeliveryThreshold: freeDeliveryMatch ? parseFloat(freeDeliveryMatch[1]) : null,
        deliveryFee: deliveryFeeMatch ? parseFloat(deliveryFeeMatch[1]) : null,
        serviceFee: serviceFeeMatch ? parseFloat(serviceFeeMatch[1]) : null,
        debug: {
          title,
          url,
          bodyPreview: bodyText.slice(0, 500),
        },
      };
    });

    const debug = `title="${pageData.debug.title}" | url=${pageData.debug.url} | body="${pageData.debug.bodyPreview.slice(0, 300)}"`;

    const store: Store = {
      id: storeId,
      name: pageData.name || `Store ${storeId}`,
      url: storeUrl,
      pickupAvailable: pageData.hasPickup,
      freeDeliveryThreshold: pageData.freeDeliveryThreshold,
      deliveryFee: pageData.deliveryFee,
      serviceFeeRate: null,
      minServiceFee: pageData.serviceFee,
    };

    return { store, debug };
  } catch (error) {
    return { store: null, debug: `Error: ${error}` };
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
): Promise<{ results: SearchResult[]; debug: string }> {
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
          return /\$\d+\.\d{2}/.test(text);
        },
        { timeout: 10_000 }
      );
      await page.waitForTimeout(1500);
    } catch {
      await page.waitForTimeout(3000);
    }

    // Scroll down to trigger lazy loading of more items
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });

    // Capture debug info about what the page looks like
    const debugInfo = await page.evaluate(() => {
      const title = document.title || "(empty title)";
      const url = window.location.href;
      const bodyPreview = (document.body.innerText || "").slice(0, 500);
      const imgCount = document.querySelectorAll("img").length;
      const anchorCount = document.querySelectorAll("a[href]").length;
      const priceMatches = (document.body.innerText || "").match(/\$\d+\.\d{2}/g);
      // Dump all img alt attributes to help debug item names
      const imgAlts = Array.from(document.querySelectorAll("img[alt]"))
        .map(img => img.getAttribute("alt"))
        .filter(alt => alt && alt.length > 2)
        .slice(0, 15);
      return {
        title, url, bodyPreview,
        imgCount, anchorCount,
        priceCount: priceMatches?.length ?? 0,
        imgAlts,
      };
    });

    const debug = `title="${debugInfo.title}" | url=${debugInfo.url} | imgs=${debugInfo.imgCount} | anchors=${debugInfo.anchorCount} | prices=${debugInfo.priceCount} | imgAlts=${JSON.stringify(debugInfo.imgAlts)} | body="${debugInfo.bodyPreview.slice(0, 200)}"`;

    const results = await scrapeSearchResults(page, storeId);
    return { results, debug };
  } catch (error) {
    return { results: [], debug: `Error: ${error}` };
  }
}

/**
 * Scrape item cards from the rendered DoorDash page.
 *
 * Uses two approaches:
 * 1. Find anchor links to item pages — most reliable
 * 2. Fall back to finding elements with prices + images
 *
 * For item names, prefers img alt attributes over textContent
 * since textContent includes promotional badges, counts, and stock text.
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

    // --- Find item card containers ---
    let cards: Element[] = [];

    // Strategy 1: Links to item pages (most reliable)
    const itemLinks = document.querySelectorAll(
      'a[href*="/item/"], a[href*="/store/"][href*="/item/"]'
    );
    if (itemLinks.length > 0) {
      cards = Array.from(itemLinks);
    }

    // Strategy 2: data-testid patterns
    if (cards.length === 0) {
      for (const sel of [
        '[data-testid*="MenuItem"]',
        '[data-testid*="StoreItem"]',
        '[data-testid*="ItemCard"]',
      ]) {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) { cards = Array.from(els); break; }
      }
    }

    // Strategy 3: Anchors with price + image
    if (cards.length === 0) {
      cards = Array.from(document.querySelectorAll("a[href]")).filter(el => {
        const text = el.textContent || "";
        return /\$\d+\.\d{2}/.test(text) && el.querySelector("img");
      });
    }

    // Strategy 4: Leaf divs with price + image (no nested price-cards)
    if (cards.length === 0) {
      cards = Array.from(document.querySelectorAll("div, article, li")).filter(el => {
        const text = el.textContent || "";
        if (!/\$\d+\.\d{2}/.test(text) || !el.querySelector("img")) return false;
        return !Array.from(el.querySelectorAll("div, article, li")).some(
          child => child !== el && /\$\d+\.\d{2}/.test(child.textContent || "") && child.querySelector("img")
        );
      });
    }

    for (const el of cards) {
      // --- Extract item ID from href ---
      let itemId: string | null = null;
      const anchor = el.tagName === "A" ? el : el.querySelector("a[href]");
      if (anchor) {
        const href = anchor.getAttribute("href") || "";
        const idMatch = href.match(/\/item\/(\d+)/);
        if (idMatch) itemId = idMatch[1];
      }

      // --- Extract image URL and name from alt ---
      const imgEl = el.querySelector("img");
      const imageUrl = imgEl?.getAttribute("src") || null;
      const imgAlt = imgEl?.getAttribute("alt")?.trim() || null;

      // --- Extract price ---
      // Look for the price — prefer the last $X.XX which is usually the display price
      const text = el.textContent || "";
      const priceMatches = text.match(/\$\d+\.\d{2}/g);
      if (!priceMatches || priceMatches.length === 0) continue;
      // Use the last price (display price) — earlier ones may be original/strikethrough prices
      const price = priceMatches[priceMatches.length - 1];

      // --- Extract name ---
      let name = "";

      // Best: use img alt (clean item name without promo text)
      if (imgAlt && imgAlt.length > 3 && !imgAlt.toLowerCase().includes("doordash")) {
        name = imgAlt;
      } else {
        // Fallback: clean up textContent
        let cleanText = text;
        for (const p of priceMatches) {
          cleanText = cleanText.replace(p, "");
        }
        cleanText = cleanText
          .replace(/buy \d+,?\s*save\s+with\s+coupon/gi, "")
          .replace(/buy \d+,?\s*get \d+\s+free/gi, "")
          .replace(/save\s+\$\d+(\.\d{2})?/gi, "")
          .replace(/add to cart/gi, "")
          .replace(/out of stock/gi, "")
          .replace(/many in stock/gi, "")
          .replace(/few left/gi, "")
          .replace(/limited stock/gi, "")
          .replace(/\b\d+\s*ct\b/gi, "")
          .replace(/each/gi, "")
          .replace(/sponsored/gi, "");

        const lines = cleanText.split(/\n/).map(l => l.trim()).filter(l => l.length > 2);
        name = lines[0] || "";
      }

      if (!name || name.length < 2) continue;

      // Deduplicate by name or itemId
      const dedupeKey = itemId || name;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

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
  const { results } = await searchItems(storeId, itemName, limit);
  return results;
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
