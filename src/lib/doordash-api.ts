import { browserManager } from "./browser";
import type { SearchResult, Store } from "./types";

/**
 * DoorDash API client.
 *
 * DoorDash uses Next.js with React Server Components (RSC). Page navigations
 * are blocked by Cloudflare bot detection, but in-browser fetch() requests
 * with RSC headers bypass this and return parseable text/x-component payloads.
 *
 * We run fetch() inside the Patchright browser context so that:
 * - Cookies are automatically included (same origin)
 * - TLS fingerprint matches a real browser
 * - Cloudflare doesn't intercept XHR/fetch the same way as navigations
 */

// RSC headers that DoorDash's Next.js expects
const RSC_HEADERS: Record<string, string> = {
  Accept: "text/x-component",
  RSC: "1",
  "Next-Router-State-Tree": "%5B%22%22%2C%7B%22children%22%3A%5B%22(main)%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%5D%7D%5D%7D%2Cnull%2Cnull%2Ctrue%5D",
  "Next-Url": "/",
};

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
 * Get store info by fetching the store page as an RSC payload and parsing it.
 */
export async function getStoreInfo(
  storeId: string,
  storeUrl: string
): Promise<{ store: Store | null; debug: string }> {
  try {
    const rscUrl = storeUrl.endsWith("/") ? storeUrl : storeUrl + "/";
    const result = await browserManager.browserFetchText(rscUrl, {
      ...RSC_HEADERS,
      "Next-Url": `/convenience/store/${storeId}`,
    });

    const debug = `status=${result.status} | contentType=${result.contentType} | length=${result.text.length} | preview="${result.text.slice(0, 500)}"`;

    if (result.status !== 200 || result.text.length < 50) {
      return { store: null, debug: `Fetch failed: ${debug}` };
    }

    // Parse store info from the RSC payload
    const parsed = parseRscPayload(result.text);
    const storeName = extractStoreName(parsed, result.text) || `Store ${storeId}`;
    const storeDetails = extractStoreDetails(parsed, result.text);

    const store: Store = {
      id: storeId,
      name: storeName,
      url: storeUrl,
      pickupAvailable: storeDetails.pickupAvailable,
      freeDeliveryThreshold: storeDetails.freeDeliveryThreshold,
      deliveryFee: storeDetails.deliveryFee,
      serviceFeeRate: null,
      minServiceFee: storeDetails.minServiceFee,
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
 * Search for items by fetching the search page as an RSC payload.
 *
 * DoorDash search URL: /convenience/store/{storeId}/search/{query}
 */
export async function searchItems(
  storeId: string,
  query: string,
  _limit: number = 10
): Promise<{ results: SearchResult[]; debug: string }> {
  try {
    const searchUrl = `https://www.doordash.com/convenience/store/${storeId}/search/${encodeURIComponent(query)}/`;
    const result = await browserManager.browserFetchText(searchUrl, {
      ...RSC_HEADERS,
      "Next-Url": `/convenience/store/${storeId}/search/${encodeURIComponent(query)}`,
    });

    const debug = `status=${result.status} | contentType=${result.contentType} | length=${result.text.length} | preview="${result.text.slice(0, 500)}"`;

    if (result.status !== 200 || result.text.length < 50) {
      return { results: [], debug: `Fetch failed: ${debug}` };
    }

    const parsed = parseRscPayload(result.text);
    const items = extractSearchResults(parsed, result.text, storeId);

    return {
      results: items.slice(0, _limit),
      debug: `${debug} | items_found=${items.length}`,
    };
  } catch (error) {
    return { results: [], debug: `Error: ${error}` };
  }
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
// RSC Payload Parsing
// ============================================================

/**
 * Parse a React Server Components text/x-component payload.
 *
 * RSC payloads are newline-delimited, with each line in the format:
 *   INDEX:TYPE_INDICATOR JSON_DATA
 *
 * Example lines:
 *   0:["$","div",null,{"children":...}]
 *   1:{"name":"Target","id":2834013}
 *   3:T1234,{raw text of 1234 bytes}
 *
 * We extract all JSON objects/arrays from the payload for field searching.
 */
function parseRscPayload(text: string): unknown[] {
  const results: unknown[] = [];
  const lines = text.split("\n");

  for (const line of lines) {
    // Match lines like "INDEX:JSON" or "INDEX:[...]" or "INDEX:{...}"
    const match = line.match(/^[0-9a-f]+:(.+)$/);
    if (!match) continue;

    const content = match[1].trim();
    if (!content.startsWith("{") && !content.startsWith("[") && !content.startsWith('"')) {
      continue;
    }

    try {
      const parsed = JSON.parse(content);
      results.push(parsed);
    } catch {
      // Not valid JSON — might be a partial or RSC-specific format
    }
  }

  return results;
}

/**
 * Extract the store name from parsed RSC data.
 * Looks for common patterns in DoorDash's RSC payload.
 */
function extractStoreName(parsed: unknown[], rawText: string): string | null {
  // Strategy 1: Look for "name" fields in JSON objects that look like store data
  for (const obj of parsed) {
    const name = findInObject(obj, (key, value) => {
      if (typeof value !== "string" || value.length < 2 || value.length > 100) return false;
      // Look for store-name-like fields
      if (key === "name" || key === "storeName" || key === "businessName" || key === "displayName") {
        // Filter out generic values
        if (value.toLowerCase().includes("doordash") || value.toLowerCase() === "www.doordash.com") return false;
        return true;
      }
      return false;
    });
    if (name) return name as string;
  }

  // Strategy 2: Regex for "name":"StoreName" in raw text
  const namePatterns = [
    /"(?:name|storeName|businessName|displayName)"\s*:\s*"([^"]{2,60})"/g,
  ];
  for (const pattern of namePatterns) {
    let match;
    while ((match = pattern.exec(rawText)) !== null) {
      const candidate = match[1];
      if (!candidate.toLowerCase().includes("doordash") &&
          !candidate.toLowerCase().includes("www.") &&
          candidate.length > 1) {
        return candidate;
      }
    }
  }

  // Strategy 3: Look for headerTitle or similar
  const headerMatch = rawText.match(/"headerTitle"\s*:\s*"([^"]{2,60})"/);
  if (headerMatch) return headerMatch[1];

  return null;
}

/**
 * Extract store details (pickup, fees) from RSC data.
 */
function extractStoreDetails(parsed: unknown[], rawText: string): {
  pickupAvailable: boolean;
  freeDeliveryThreshold: number | null;
  deliveryFee: number | null;
  minServiceFee: number | null;
} {
  const details = {
    pickupAvailable: false,
    freeDeliveryThreshold: null as number | null,
    deliveryFee: null as number | null,
    minServiceFee: null as number | null,
  };

  // Check for pickup in raw text
  details.pickupAvailable =
    rawText.toLowerCase().includes('"pickup"') ||
    rawText.toLowerCase().includes("pickupavailable") ||
    rawText.toLowerCase().includes('"isPickupAvailable":true');

  // Look for delivery fee threshold
  const thresholdMatch = rawText.match(/"freeDeliveryThreshold"[:\s]*(\d+(?:\.\d+)?)/);
  if (thresholdMatch) details.freeDeliveryThreshold = parseFloat(thresholdMatch[1]);

  const deliveryMatch = rawText.match(/"deliveryFee"[:\s]*(\d+(?:\.\d+)?)/);
  if (deliveryMatch) details.deliveryFee = parseFloat(deliveryMatch[1]);

  const serviceMatch = rawText.match(/"serviceFee"[:\s]*(\d+(?:\.\d+)?)/);
  if (serviceMatch) details.minServiceFee = parseFloat(serviceMatch[1]);

  // Also try common patterns
  if (!details.freeDeliveryThreshold) {
    const alt = rawText.match(/"minOrderSubtotal"[:\s]*(\d+(?:\.\d+)?)/);
    if (alt) details.freeDeliveryThreshold = parseFloat(alt[1]) / 100; // cents to dollars
  }

  return details;
}

/**
 * Extract search results from parsed RSC data.
 */
function extractSearchResults(parsed: unknown[], rawText: string, storeId: string): SearchResult[] {
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  // Strategy 1: Find item-like objects in parsed data
  for (const obj of parsed) {
    findAllItems(obj, (item: Record<string, unknown>) => {
      const name = (item.name || item.displayName || item.itemName || item.title) as string | undefined;
      const price = (item.price || item.displayPrice || item.unitPrice) as number | string | undefined;
      const id = (item.id || item.itemId || item.menuItemId) as string | number | undefined;
      const imageUrl = (item.imageUrl || item.imgUrl || item.heroImageUrl || item.thumbnailUrl) as string | undefined;
      const description = (item.description || item.itemDescription) as string | undefined;

      if (!name || typeof name !== "string" || name.length < 2) return;
      if (price === undefined || price === null) return;

      const itemId = id ? String(id) : null;
      const dedupeKey = itemId || name;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);

      results.push({
        itemId: itemId || `rsc-${storeId}-${results.length}-${Date.now()}`,
        storeId,
        name,
        description: typeof description === "string" ? description : "",
        price: parsePrice(price),
        unitPrice: null,
        imageUrl: typeof imageUrl === "string" ? imageUrl : null,
        inStock: true,
      });
    });
  }

  // Strategy 2: If no structured items found, try regex on raw text
  if (results.length === 0) {
    // Look for item patterns in raw RSC text
    // Pattern: "name":"Item Name"..."price":XXXX or "displayPrice":"$X.XX"
    const itemRegex = /"(?:name|displayName|itemName)"\s*:\s*"([^"]{3,120})"/g;
    const priceRegex = /"(?:price|displayPrice|unitPrice)"\s*:\s*(?:"?\$?(\d+(?:\.\d+)?)"?|(\d+))/g;

    const names: string[] = [];
    const prices: number[] = [];

    let match;
    while ((match = itemRegex.exec(rawText)) !== null) {
      const name = match[1];
      // Filter out non-item names
      if (name.toLowerCase().includes("doordash") ||
          name.length < 3 ||
          name.startsWith("http") ||
          name.includes("\\u")) continue;
      names.push(name);
    }

    while ((match = priceRegex.exec(rawText)) !== null) {
      const val = match[1] || match[2];
      if (val) prices.push(parseFloat(val));
    }

    // Pair names with prices (best effort)
    for (let i = 0; i < names.length && i < prices.length; i++) {
      if (seen.has(names[i])) continue;
      seen.add(names[i]);

      let price = prices[i];
      // DoorDash often stores prices in cents
      if (price > 100) price = price / 100;

      results.push({
        itemId: `regex-${storeId}-${i}-${Date.now()}`,
        storeId,
        name: names[i],
        description: "",
        price,
        unitPrice: null,
        imageUrl: null,
        inStock: true,
      });
    }
  }

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
  if (typeof price === "number") {
    // DoorDash sometimes stores prices in cents
    return price > 100 ? price / 100 : price;
  }
  if (typeof price === "string") {
    const cleaned = price.replace(/[$,]/g, "").trim();
    const val = parseFloat(cleaned) || 0;
    return val > 100 ? val / 100 : val;
  }
  return 0;
}

/**
 * Find a value in a nested object/array by key predicate.
 * Returns the first matching value.
 */
function findInObject(
  obj: unknown,
  predicate: (key: string, value: unknown) => boolean,
  depth: number = 0
): unknown | null {
  if (depth > 15) return null;
  if (obj === null || obj === undefined) return null;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const result = findInObject(item, predicate, depth + 1);
      if (result !== null) return result;
    }
  } else if (typeof obj === "object") {
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (predicate(key, value)) return value;
      const result = findInObject(value, predicate, depth + 1);
      if (result !== null) return result;
    }
  }

  return null;
}

/**
 * Find all item-like objects in a nested structure.
 * An "item" is an object with at least a name and price field.
 */
function findAllItems(
  obj: unknown,
  callback: (item: Record<string, unknown>) => void,
  depth: number = 0
): void {
  if (depth > 15) return;
  if (obj === null || obj === undefined) return;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      findAllItems(item, callback, depth + 1);
    }
  } else if (typeof obj === "object") {
    const record = obj as Record<string, unknown>;
    // Check if this object looks like an item
    const hasName = "name" in record || "displayName" in record || "itemName" in record || "title" in record;
    const hasPrice = "price" in record || "displayPrice" in record || "unitPrice" in record;
    if (hasName && hasPrice) {
      callback(record);
    }
    // Recurse into children
    for (const value of Object.values(record)) {
      findAllItems(value, callback, depth + 1);
    }
  }
}
