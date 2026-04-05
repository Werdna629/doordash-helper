import { browserManager } from "./browser";
import type { SearchResult, Store } from "./types";

const GRAPHQL_URL = "https://www.doordash.com/graphql";

/**
 * DoorDash API client that executes GraphQL queries inside the browser context.
 *
 * All requests go through page.evaluate(fetch(...)) to inherit the browser's
 * cookies, TLS fingerprint, and session state.
 *
 * NOTE: The GraphQL queries below are based on known DoorDash operations
 * discovered from network traffic analysis. They may need to be updated
 * if DoorDash changes their internal API. Use the `captureNetworkRequests()`
 * helper to discover current operations.
 */

// ============================================================
// Store Info
// ============================================================

/**
 * Extract a store ID from a DoorDash store URL.
 * Example URL: https://www.doordash.com/convenience/store/1235954/
 * Example URL: https://www.doordash.com/store/safeway-san-francisco-1235954/
 */
export function parseStoreIdFromUrl(url: string): string | null {
  // Match /store/<slug>-<id>/ or /convenience/store/<id>/
  const convenienceMatch = url.match(/\/convenience\/store\/(\d+)/);
  if (convenienceMatch) return convenienceMatch[1];

  const storeMatch = url.match(/\/store\/[^/]+-(\d+)/);
  if (storeMatch) return storeMatch[1];

  // Try bare numeric ID at end of path
  const numericMatch = url.match(/\/(\d+)\/?$/);
  if (numericMatch) return numericMatch[1];

  return null;
}

/**
 * Get store information including pickup availability and fee structure.
 */
export async function getStoreInfo(storeId: string): Promise<Store | null> {
  try {
    const data = (await browserManager.browserFetch(GRAPHQL_URL, {
      method: "POST",
      body: JSON.stringify({
        operationName: "storepageFeed",
        variables: {
          storeId: parseInt(storeId, 10),
        },
        query: STORE_PAGE_FEED_QUERY,
      }),
    })) as StoreFeedResponse;

    if (!data?.data) return null;

    const storeHeader = data.data?.storepageFeed?.storeHeader;
    const storeName = storeHeader?.name ?? `Store ${storeId}`;

    // Extract fee info from the store's delivery info
    const deliveryInfo = storeHeader?.deliveryInfo;
    const pickupAvailable = storeHeader?.fulfillmentOptions?.some(
      (opt: { type: string }) => opt.type === "PICKUP"
    ) ?? false;

    return {
      id: storeId,
      name: storeName,
      url: `https://www.doordash.com/store/${storeId}/`,
      pickupAvailable,
      freeDeliveryThreshold: deliveryInfo?.freeDeliveryThreshold ?? null,
      deliveryFee: deliveryInfo?.deliveryFee ?? null,
      serviceFeeRate: deliveryInfo?.serviceFeeRate ?? null,
      minServiceFee: deliveryInfo?.minServiceFee ?? null,
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
 * Search for items in a specific store.
 * Returns top results matching the query.
 */
export async function searchItems(
  storeId: string,
  query: string,
  limit: number = 10
): Promise<SearchResult[]> {
  try {
    const data = (await browserManager.browserFetch(GRAPHQL_URL, {
      method: "POST",
      body: JSON.stringify({
        operationName: "convenienceSearchQuery",
        variables: {
          storeId: parseInt(storeId, 10),
          searchTerm: query,
          numItems: limit,
        },
        query: CONVENIENCE_SEARCH_QUERY,
      }),
    })) as ConvenienceSearchResponse;

    if (!data?.data) return [];

    const items =
      data.data?.convenienceSearchQuery?.items ??
      data.data?.convenienceSearchQuery?.searchResults ??
      [];

    return items.map(
      (item: RawSearchItem): SearchResult => ({
        itemId: String(item.id ?? item.itemId),
        storeId,
        name: item.name ?? item.displayName ?? "",
        description: item.description ?? "",
        price: parsePrice(item.displayPrice ?? item.price),
        unitPrice: item.unitPrice ?? item.pricePerUnit ?? null,
        imageUrl: item.imageUrl ?? item.headerImageUrl ?? null,
        inStock: item.isAvailable !== false,
      })
    );
  } catch (error) {
    console.error(
      `Failed to search items at store ${storeId} for "${query}":`,
      error
    );
    return [];
  }
}

/**
 * Find a matching item at a different store by searching with the item name.
 * Returns the best matches for the user to confirm.
 */
export async function findMatchingItem(
  storeId: string,
  itemName: string,
  limit: number = 5
): Promise<SearchResult[]> {
  // Search the other store using the confirmed item's name
  return searchItems(storeId, itemName, limit);
}

// ============================================================
// Network Request Capture (for GraphQL query discovery)
// ============================================================

/**
 * Navigate to a store page and capture all GraphQL operations made.
 * Useful during development to discover the exact queries DoorDash uses.
 */
export async function captureNetworkRequests(
  storeUrl: string,
  durationMs: number = 10_000
): Promise<
  Array<{
    operationName: string;
    variables: Record<string, unknown>;
    query: string;
  }>
> {
  const page = await browserManager.getPage();
  const captured: Array<{
    operationName: string;
    variables: Record<string, unknown>;
    query: string;
  }> = [];

  const handler = (request: { url: () => string; method: () => string; postData: () => string | null }) => {
    if (
      request.url().includes("graphql") &&
      request.method() === "POST"
    ) {
      try {
        const body = JSON.parse(request.postData() || "{}");
        captured.push({
          operationName: body.operationName || "unknown",
          variables: body.variables || {},
          query: body.query || "",
        });
      } catch {
        // ignore parse errors
      }
    }
  };

  page.on("request", handler);

  await page.goto(storeUrl, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForTimeout(durationMs);

  page.off("request", handler);

  return captured;
}

// ============================================================
// GraphQL Queries
// ============================================================
// These are based on known DoorDash GraphQL operations.
// They may need updating — use captureNetworkRequests() to discover current ones.

const STORE_PAGE_FEED_QUERY = `
  query storepageFeed($storeId: Int!) {
    storepageFeed(storeId: $storeId) {
      storeHeader {
        name
        description
        deliveryInfo {
          freeDeliveryThreshold
          deliveryFee
          serviceFeeRate
          minServiceFee
        }
        fulfillmentOptions {
          type
        }
        address {
          street
          city
          state
        }
      }
    }
  }
`;

const CONVENIENCE_SEARCH_QUERY = `
  query convenienceSearchQuery($storeId: Int!, $searchTerm: String!, $numItems: Int) {
    convenienceSearchQuery(
      storeId: $storeId
      searchTerm: $searchTerm
      numItems: $numItems
    ) {
      items {
        id
        name
        displayName
        description
        displayPrice
        price
        unitPrice
        pricePerUnit
        imageUrl
        headerImageUrl
        isAvailable
      }
      searchResults {
        id
        itemId
        name
        displayName
        description
        displayPrice
        price
        unitPrice
        pricePerUnit
        imageUrl
        headerImageUrl
        isAvailable
      }
    }
  }
`;

// ============================================================
// Internal types for raw API responses
// ============================================================

interface RawSearchItem {
  id?: number;
  itemId?: number;
  name?: string;
  displayName?: string;
  description?: string;
  displayPrice?: string;
  price?: string | number;
  unitPrice?: string;
  pricePerUnit?: string;
  imageUrl?: string;
  headerImageUrl?: string;
  isAvailable?: boolean;
}

interface ConvenienceSearchResponse {
  data?: {
    convenienceSearchQuery?: {
      items?: RawSearchItem[];
      searchResults?: RawSearchItem[];
    };
  };
}

interface StoreFeedResponse {
  data?: {
    storepageFeed?: {
      storeHeader?: {
        name?: string;
        description?: string;
        deliveryInfo?: {
          freeDeliveryThreshold?: number;
          deliveryFee?: number;
          serviceFeeRate?: number;
          minServiceFee?: number;
        };
        fulfillmentOptions?: Array<{ type: string }>;
        address?: {
          street?: string;
          city?: string;
          state?: string;
        };
      };
    };
  };
}

// ============================================================
// Helpers
// ============================================================

/** Parse a price string like "$4.99" or number into cents-as-dollars number */
function parsePrice(price: string | number | undefined): number {
  if (price === undefined || price === null) return 0;
  if (typeof price === "number") return price;
  // Strip "$" and commas, parse as float
  const cleaned = price.replace(/[$,]/g, "").trim();
  return parseFloat(cleaned) || 0;
}
