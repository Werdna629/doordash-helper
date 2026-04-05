// ============================================================
// DoorDash Grocery Credit Optimizer — Shared Types
// ============================================================

/** A grocery store configured by the user */
export interface Store {
  id: string;
  name: string;
  /** DoorDash store URL (user pastes this) */
  url: string;
  /** Whether this store supports pickup orders (no fees) */
  pickupAvailable: boolean;
  /** Minimum subtotal for free delivery (e.g., 25.00). null if unknown. */
  freeDeliveryThreshold: number | null;
  /** Base delivery fee when under the free delivery threshold */
  deliveryFee: number | null;
  /** Service fee rate as a decimal (e.g., 0.10 for 10%). null if unknown. */
  serviceFeeRate: number | null;
  /** Minimum service fee (e.g., 5.49 with DashPass). null if unknown. */
  minServiceFee: number | null;
}

/** A search result returned from DoorDash item search */
export interface SearchResult {
  itemId: string;
  storeId: string;
  name: string;
  description: string;
  price: number;
  /** Price per unit display (e.g., "$0.05/oz") */
  unitPrice: string | null;
  imageUrl: string | null;
  /** Whether the item is currently in stock */
  inStock: boolean;
}

/** A confirmed wishlist item with prices across stores */
export interface WishlistItem {
  /** Unique ID for this wishlist entry */
  id: string;
  /** The search query the user originally typed */
  searchQuery: string;
  /** The confirmed item from the primary store */
  confirmedItem: SearchResult;
  /** Matched items at other stores (storeId → SearchResult or null if no match) */
  storeMatches: Record<string, SearchResult | null>;
}

/** Fee breakdown for a single order at a specific store */
export interface FeeBreakdown {
  subtotal: number;
  deliveryFee: number;
  serviceFee: number;
  /** Total before credit */
  totalBeforeCredit: number;
  /** Credit amount applied (up to $10) */
  creditApplied: number;
  /** Final out-of-pocket cost */
  outOfPocket: number;
}

/** A single store recommendation from the optimizer */
export interface StoreRecommendation {
  store: Store;
  /** Items to buy at this store */
  items: Array<{
    wishlistItem: WishlistItem;
    /** The specific search result / price at this store */
    storeItem: SearchResult;
  }>;
  fees: FeeBreakdown;
  /** Whether this recommendation uses pickup (no fees) */
  isPickup: boolean;
}

/** Full optimization result */
export interface OptimizationResult {
  /** Ranked recommendations (cheapest first) */
  recommendations: StoreRecommendation[];
  /** Total number of wishlist items considered */
  totalItems: number;
  /** Credit amount used */
  creditAmount: number;
}

/** Auth status of the browser session */
export interface AuthStatus {
  loggedIn: boolean;
  /** User's name if logged in */
  userName: string | null;
}

/** Captured GraphQL operation for debugging/discovery */
export interface CapturedGraphQLOperation {
  operationName: string;
  query: string;
  variables: Record<string, unknown>;
  timestamp: number;
}
