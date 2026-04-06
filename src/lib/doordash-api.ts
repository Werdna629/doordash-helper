import { browserManager } from "./browser";
import type { SearchResult, Store } from "./types";

/**
 * DoorDash API client.
 *
 * Instead of guessing GraphQL queries (which break when DoorDash changes
 * their schema), we navigate to real DoorDash pages and either:
 * - Intercept the GraphQL responses the page itself makes, or
 * - Scrape data directly from the rendered page
 *
 * This is more robust since it uses DoorDash's own frontend code to make
 * the right API calls.
 */

// ============================================================
// Store Info
// ============================================================

/**
 * Extract a store ID from a DoorDash store URL.
 * Example URL: https://www.doordash.com/convenience/store/2834013/
 * Example URL: https://www.doordash.com/store/safeway-san-francisco-1235954/
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
 * Get store info by navigating to the store page and scraping it.
 * Also intercepts GraphQL responses to capture fee/delivery info.
 */
export async function getStoreInfo(storeId: string, storeUrl: string): Promise<Store | null> {
  try {
    const page = await browserManager.getPage();

    // Collect GraphQL response data as the page loads
    const graphqlData: Record<string, unknown>[] = [];

    const responseHandler = async (response: { url: () => string; request: () => { method: () => string }; json: () => Promise<unknown> }) => {
      if (
        response.url().includes("graphql") &&
        response.request().method() === "POST"
      ) {
        try {
          const json = await response.json();
          graphqlData.push(json as Record<string, unknown>);
        } catch {
          // ignore
        }
      }
    };

    page.on("response", responseHandler);

    // Navigate to the store page
    await page.goto(storeUrl, {
      waitUntil: "networkidle",
      timeout: 25_000,
    });

    // Wait a bit more for dynamic rendering
    await page.waitForTimeout(3000);

    page.off("response", responseHandler);

    // Extract store name from the page — try multiple strategies
    const pageData = await page.evaluate(() => {
      const getName = () => {
        // Strategy 1: Page title usually has "StoreName - DoorDash" or "StoreName | DoorDash"
        const title = document.title || "";
        const titleParts = title.split(/[|\-–—]/);
        if (titleParts.length >= 2) {
          const candidate = titleParts[0].trim();
          // Filter out generic DoorDash titles
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
          const parts = content.split(/[|\-–—]/);
          if (parts[0]?.trim()) return parts[0].trim();
        }

        // Strategy 4: Look for a prominent store name element
        const candidates = document.querySelectorAll(
          '[data-testid*="store-name"], [data-testid*="StoreName"], [class*="StoreName"], [class*="storeName"]'
        );
        for (const el of candidates) {
          if (el.textContent?.trim()) return el.textContent.trim();
        }

        return null;
      };

      const bodyText = document.body.innerText || "";

      const hasPickup =
        bodyText.toLowerCase().includes("pickup") &&
        (bodyText.toLowerCase().includes("pickup available") ||
         bodyText.toLowerCase().includes("switch to pickup") ||
         !!document.querySelector('[data-testid*="pickup"], [data-testid*="Pickup"], [aria-label*="ickup"]'));

      const freeDeliveryMatch = bodyText.match(
        /free delivery (?:on orders |over |for orders over )?\$(\d+(?:\.\d{2})?)/i
      );
      const deliveryFeeMatch = bodyText.match(
        /delivery fee[:\s]*\$(\d+(?:\.\d{2})?)/i
      );
      const serviceFeeMatch = bodyText.match(
        /service fee[:\s]*\$(\d+(?:\.\d{2})?)/i
      );

      return {
        name: getName(),
        hasPickup,
        freeDeliveryThreshold: freeDeliveryMatch ? parseFloat(freeDeliveryMatch[1]) : null,
        deliveryFee: deliveryFeeMatch ? parseFloat(deliveryFeeMatch[1]) : null,
        serviceFee: serviceFeeMatch ? parseFloat(serviceFeeMatch[1]) : null,
      };
    });

    // Also try to extract info from intercepted GraphQL responses
    const storeInfo = extractStoreInfoFromGraphQL(graphqlData);

    const name = pageData.name || storeInfo.name || `Store ${storeId}`;

    return {
      id: storeId,
      name,
      url: storeUrl,
      pickupAvailable: pageData.hasPickup || storeInfo.pickupAvailable || false,
      freeDeliveryThreshold: pageData.freeDeliveryThreshold ?? storeInfo.freeDeliveryThreshold ?? null,
      deliveryFee: pageData.deliveryFee ?? storeInfo.deliveryFee ?? null,
      serviceFeeRate: storeInfo.serviceFeeRate ?? null,
      minServiceFee: storeInfo.minServiceFee ?? null,
    };
  } catch (error) {
    console.error(`Failed to get store info for ${storeId}:`, error);
    return null;
  }
}

/** Deep-search GraphQL response data for store-related fields */
function extractStoreInfoFromGraphQL(responses: Record<string, unknown>[]): Partial<Store> {
  const info: Partial<Store> = {};

  for (const resp of responses) {
    const json = JSON.stringify(resp);

    // Try to find store name
    if (!info.name) {
      const nameMatch = json.match(/"name"\s*:\s*"([^"]{3,60})"/);
      if (nameMatch) info.name = nameMatch[1];
    }

    // Look for fee-related fields anywhere in the response
    if (json.includes("deliveryFee") || json.includes("serviceFee") || json.includes("fulfillment")) {
      try {
        deepExtractFees(resp, info);
      } catch {
        // ignore
      }
    }
  }

  return info;
}

/** Recursively search an object for fee-related fields */
function deepExtractFees(obj: unknown, info: Partial<Store>): void {
  if (!obj || typeof obj !== "object") return;

  if (Array.isArray(obj)) {
    for (const item of obj) deepExtractFees(item, info);
    return;
  }

  const record = obj as Record<string, unknown>;

  // Check for pickup in fulfillment options
  if (record.type === "PICKUP" || record.fulfillmentType === "PICKUP") {
    info.pickupAvailable = true;
  }

  // Extract fee fields
  if (typeof record.freeDeliveryThreshold === "number" && info.freeDeliveryThreshold === undefined) {
    info.freeDeliveryThreshold = record.freeDeliveryThreshold;
  }
  if (typeof record.deliveryFee === "number" && info.deliveryFee === undefined) {
    info.deliveryFee = record.deliveryFee;
  }
  if (typeof record.serviceFeeRate === "number" && info.serviceFeeRate === undefined) {
    info.serviceFeeRate = record.serviceFeeRate;
  }
  if (typeof record.minServiceFee === "number" && info.minServiceFee === undefined) {
    info.minServiceFee = record.minServiceFee;
  }

  // Recurse
  for (const value of Object.values(record)) {
    if (value && typeof value === "object") {
      deepExtractFees(value, info);
    }
  }
}

// ============================================================
// Item Search
// ============================================================

/**
 * Search for items by navigating to the store's search page on DoorDash.
 *
 * DoorDash's search URL pattern: /convenience/store/{storeId}/search/{query}
 * The page loads and makes its own API calls. We intercept all responses
 * (both GraphQL and regular JSON) to capture results, plus scrape the DOM
 * as a fallback.
 */
export async function searchItems(
  storeId: string,
  query: string,
  _limit: number = 10
): Promise<SearchResult[]> {
  try {
    const page = await browserManager.getPage();

    const searchResults: SearchResult[] = [];

    // Intercept ALL responses that might contain search results
    const responseHandler = async (response: { url: () => string; request: () => { method: () => string }; json: () => Promise<unknown>; text: () => Promise<string> }) => {
      const url = response.url();
      const isGraphQL = url.includes("graphql") && response.request().method() === "POST";
      const isSearchAPI = url.includes("/search") && url.includes(storeId);

      if (isGraphQL || isSearchAPI) {
        try {
          const json = (await response.json()) as Record<string, unknown>;
          const items = extractSearchResultsFromGraphQL(json, storeId);
          searchResults.push(...items);
        } catch {
          // ignore
        }
      }
    };

    page.on("response", responseHandler);

    // Navigate to the store's search page using the correct URL pattern
    const searchUrl = `https://www.doordash.com/convenience/store/${storeId}/search/${encodeURIComponent(query)}`;
    await page.goto(searchUrl, {
      waitUntil: "networkidle",
      timeout: 25_000,
    });

    // Wait for search results to render
    await page.waitForTimeout(3000);

    page.off("response", responseHandler);

    // If we got results from response interception, use those
    if (searchResults.length > 0) {
      return searchResults;
    }

    // Fallback: scrape search results from the rendered page
    return await scrapeSearchResults(page, storeId);
  } catch (error) {
    console.error(
      `Failed to search items at store ${storeId} for "${query}":`,
      error
    );
    return [];
  }
}

/** Extract search result items from a GraphQL response */
function extractSearchResultsFromGraphQL(
  response: Record<string, unknown>,
  storeId: string
): SearchResult[] {
  const results: SearchResult[] = [];
  const json = JSON.stringify(response);

  // Only process responses that look like they contain item data
  if (!json.includes("price") || !json.includes("name")) return results;

  // Recursively find arrays of items
  findItemArrays(response, storeId, results);

  return results;
}

/** Recursively find arrays that look like item lists */
function findItemArrays(
  obj: unknown,
  storeId: string,
  results: SearchResult[]
): void {
  if (!obj || typeof obj !== "object") return;

  if (Array.isArray(obj)) {
    // Check if this array contains item-like objects
    const itemLike = obj.filter(
      (item) =>
        item &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        ("name" in item || "displayName" in item) &&
        ("price" in item || "displayPrice" in item || "unitPrice" in item)
    );

    if (itemLike.length > 0) {
      for (const item of itemLike) {
        const record = item as Record<string, unknown>;
        const name = String(record.name || record.displayName || "");
        if (!name) continue;

        // Skip if we already have this item
        if (results.some((r) => r.name === name)) continue;

        results.push({
          itemId: String(record.id ?? record.itemId ?? record.menuItemId ?? `${Date.now()}-${Math.random()}`),
          storeId,
          name,
          description: String(record.description || ""),
          price: parsePrice(record.displayPrice ?? record.price ?? record.salePrice),
          unitPrice: record.unitPrice ? String(record.unitPrice) : record.pricePerUnit ? String(record.pricePerUnit) : null,
          imageUrl: record.imageUrl ? String(record.imageUrl) : record.headerImageUrl ? String(record.headerImageUrl) : record.imgUrl ? String(record.imgUrl) : null,
          inStock: record.isAvailable !== false && record.isSoldOut !== true,
        });
      }
    }

    for (const item of obj) findItemArrays(item, storeId, results);
    return;
  }

  for (const value of Object.values(obj as Record<string, unknown>)) {
    if (value && typeof value === "object") {
      findItemArrays(value, storeId, results);
    }
  }
}

/** Scrape search results from the rendered page as a fallback */
async function scrapeSearchResults(
  page: { evaluate: (fn: () => Array<{ name: string; price: string; imageUrl: string | null }>) => Promise<Array<{ name: string; price: string; imageUrl: string | null }>> },
  storeId: string
): Promise<SearchResult[]> {
  const items = await page.evaluate(() => {
    const results: Array<{ name: string; price: string; imageUrl: string | null }> = [];
    const seen = new Set<string>();

    // DoorDash renders items as clickable cards/links, often inside anchors
    // Try multiple selectors to find them
    const selectors = [
      '[data-testid*="MenuItem"]',
      '[data-testid*="item"]',
      '[data-testid*="product"]',
      '[data-testid*="Product"]',
      'a[href*="/store/"][href*="/item/"]',
      'a[href*="/convenience/"][href*="/item/"]',
      '[class*="ItemCard"]',
      '[class*="ProductCard"]',
      '[class*="menuItem"]',
    ];

    let candidates: Element[] = [];
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) {
        candidates = Array.from(els);
        break;
      }
    }

    // If no specific selectors match, try a broader approach:
    // find all elements that contain both a price-like string and an img
    if (candidates.length === 0) {
      const allLinks = document.querySelectorAll("a[href]");
      candidates = Array.from(allLinks).filter((el) => {
        const text = el.textContent || "";
        return text.includes("$") && el.querySelector("img");
      });
    }

    for (const el of candidates) {
      const text = el.textContent || "";

      // Extract price (look for $X.XX pattern)
      const priceMatch = text.match(/\$(\d+\.\d{2})/);
      if (!priceMatch) continue;
      const price = priceMatch[0];

      // Extract name: get text content but exclude the price portion
      // Usually the name is the most prominent text before the price
      const allText = text.replace(/\$\d+\.\d{2}/g, "").trim();
      // Split by newlines and take the first non-empty line as the name
      const lines = allText.split(/\n/).map((l) => l.trim()).filter(Boolean);
      const name = lines[0];
      if (!name || name.length < 2) continue;

      // Deduplicate
      if (seen.has(name)) continue;
      seen.add(name);

      // Find image
      const imgEl = el.querySelector("img");
      const imageUrl = imgEl?.getAttribute("src") || null;

      results.push({ name, price, imageUrl });
    }

    return results;
  });

  return items.map(
    (item, i): SearchResult => ({
      itemId: `scraped-${storeId}-${i}`,
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
// Network Request Capture (for GraphQL query discovery)
// ============================================================

/**
 * Navigate to a store page and capture all GraphQL operations made.
 * Useful for debugging and discovering DoorDash's current API.
 */
export async function captureNetworkRequests(
  storeUrl: string,
  durationMs: number = 10_000
): Promise<
  Array<{
    operationName: string;
    variables: Record<string, unknown>;
    query: string;
    responsePreview?: string;
  }>
> {
  const page = await browserManager.getPage();
  const captured: Array<{
    operationName: string;
    variables: Record<string, unknown>;
    query: string;
    responsePreview?: string;
  }> = [];

  const requestBodies = new Map<string, { operationName: string; variables: Record<string, unknown>; query: string }>();

  // Capture request bodies
  page.on("request", (request: { url: () => string; method: () => string; postData: () => string | null; }) => {
    if (request.url().includes("graphql") && request.method() === "POST") {
      try {
        const body = JSON.parse(request.postData() || "{}");
        requestBodies.set(request.url() + body.operationName, {
          operationName: body.operationName || "unknown",
          variables: body.variables || {},
          query: body.query || "",
        });
      } catch { /* ignore */ }
    }
  });

  // Capture responses
  const responseHandler = async (response: { url: () => string; request: () => { method: () => string; postData: () => string | null }; text: () => Promise<string> }) => {
    if (response.url().includes("graphql") && response.request().method() === "POST") {
      try {
        const reqBody = JSON.parse(response.request().postData() || "{}");
        const key = response.url() + reqBody.operationName;
        const reqData = requestBodies.get(key);
        const respText = await response.text();

        captured.push({
          operationName: reqData?.operationName || reqBody.operationName || "unknown",
          variables: reqData?.variables || reqBody.variables || {},
          query: reqData?.query || reqBody.query || "",
          responsePreview: respText.slice(0, 500),
        });
      } catch { /* ignore */ }
    }
  };

  page.on("response", responseHandler);

  await page.goto(storeUrl, { waitUntil: "networkidle", timeout: 30_000 });
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
