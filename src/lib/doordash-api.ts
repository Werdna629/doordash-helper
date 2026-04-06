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
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });

    // Wait for the page to load and make its API calls
    await page.waitForTimeout(5000);

    page.off("response", responseHandler);

    // Try to extract store name from the page
    const pageData = await page.evaluate(() => {
      const getName = () => {
        // Try various selectors for store name
        const h1 = document.querySelector("h1");
        if (h1?.textContent?.trim()) return h1.textContent.trim();

        const title = document.title;
        if (title && !title.includes("DoorDash")) return title.split("|")[0]?.trim() || title;
        if (title) {
          const parts = title.split("|");
          if (parts.length > 1) return parts[0].trim();
        }

        return null;
      };

      // Look for delivery/fee info in the page text
      const bodyText = document.body.innerText || "";

      // Check for pickup option
      const hasPickup =
        bodyText.toLowerCase().includes("pickup") &&
        (bodyText.toLowerCase().includes("pickup available") ||
         bodyText.toLowerCase().includes("switch to pickup") ||
         !!document.querySelector('[data-testid*="pickup"], [aria-label*="ickup"]'));

      // Try to find delivery fee info from page text
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
        url: window.location.href,
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
 * Search for items by navigating to the store's search page on DoorDash
 * and intercepting the GraphQL responses.
 */
export async function searchItems(
  storeId: string,
  query: string,
  _limit: number = 10
): Promise<SearchResult[]> {
  try {
    const page = await browserManager.getPage();

    const searchResults: SearchResult[] = [];

    // Intercept GraphQL responses that contain search results
    const responseHandler = async (response: { url: () => string; request: () => { method: () => string }; json: () => Promise<unknown> }) => {
      if (
        response.url().includes("graphql") &&
        response.request().method() === "POST"
      ) {
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

    // Navigate to the store's search URL
    const searchUrl = `https://www.doordash.com/convenience/store/${storeId}/?searchTerm=${encodeURIComponent(query)}`;
    await page.goto(searchUrl, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });

    // Wait for search results to load
    await page.waitForTimeout(4000);

    page.off("response", responseHandler);

    // If we got results from GraphQL interception, use those
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

    // Look for item cards — DoorDash typically renders items in cards/tiles
    const candidates = document.querySelectorAll(
      '[data-testid*="item"], [data-testid*="product"], [class*="ItemCard"], [class*="ProductCard"], a[href*="/item/"]'
    );

    candidates.forEach((el) => {
      // Find name — usually in a span or div with specific styling
      const nameEl =
        el.querySelector("span[class*='Name'], div[class*='Name']") ||
        el.querySelector("span:not(:empty)");
      const name = nameEl?.textContent?.trim();

      // Find price
      const priceEl =
        el.querySelector("span[class*='Price'], div[class*='Price']") ||
        el.querySelector("span[class*='price']");
      const price = priceEl?.textContent?.trim();

      // Find image
      const imgEl = el.querySelector("img");
      const imageUrl = imgEl?.src || null;

      if (name && price) {
        results.push({ name, price, imageUrl });
      }
    });

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
