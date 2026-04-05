import type {
  FeeBreakdown,
  OptimizationResult,
  Store,
  StoreRecommendation,
  WishlistItem,
} from "./types";

const DEFAULT_CREDIT = 10.0;

/**
 * Calculate the fee breakdown for a single order at a specific store.
 */
function calculateFees(
  subtotal: number,
  store: Store,
  usePickup: boolean,
  creditAmount: number
): FeeBreakdown {
  let deliveryFee = 0;
  let serviceFee = 0;

  if (!usePickup) {
    // Delivery fees
    if (
      store.freeDeliveryThreshold !== null &&
      subtotal >= store.freeDeliveryThreshold
    ) {
      deliveryFee = 0;
    } else {
      deliveryFee = store.deliveryFee ?? 3.99;
    }

    // Service fee: percentage of subtotal with a minimum
    const rate = store.serviceFeeRate ?? 0.1;
    const minFee = store.minServiceFee ?? 5.49;
    serviceFee = Math.max(subtotal * rate, minFee);
  }

  const totalBeforeCredit = subtotal + deliveryFee + serviceFee;
  const creditApplied = Math.min(creditAmount, totalBeforeCredit);
  const outOfPocket = Math.max(0, totalBeforeCredit - creditApplied);

  return {
    subtotal,
    deliveryFee,
    serviceFee,
    totalBeforeCredit,
    creditApplied,
    outOfPocket,
  };
}

/**
 * Generate a recommendation for a single store: buy all available items there.
 */
function recommendStore(
  store: Store,
  wishlistItems: WishlistItem[],
  creditAmount: number
): StoreRecommendation | null {
  // Collect items available at this store
  const availableItems: StoreRecommendation["items"] = [];

  for (const item of wishlistItems) {
    // Check if this store has a match for this wishlist item
    const storeItem =
      item.confirmedItem.storeId === store.id
        ? item.confirmedItem
        : item.storeMatches[store.id];

    if (storeItem && storeItem.inStock) {
      availableItems.push({ wishlistItem: item, storeItem });
    }
  }

  if (availableItems.length === 0) return null;

  const subtotal = availableItems.reduce(
    (sum, { storeItem }) => sum + storeItem.price,
    0
  );

  const isPickup = store.pickupAvailable;
  const fees = calculateFees(subtotal, store, isPickup, creditAmount);

  return {
    store,
    items: availableItems,
    fees,
    isPickup,
  };
}

/**
 * For delivery stores, also try a "smart subset" strategy:
 * drop the most expensive items to keep out-of-pocket minimal.
 *
 * This finds the subset of items that maximizes "free stuff" (items covered by credit)
 * while minimizing what you actually pay.
 */
function recommendSmartSubset(
  store: Store,
  wishlistItems: WishlistItem[],
  creditAmount: number
): StoreRecommendation | null {
  // Collect available items and sort by price ascending
  const availableItems: StoreRecommendation["items"] = [];

  for (const item of wishlistItems) {
    const storeItem =
      item.confirmedItem.storeId === store.id
        ? item.confirmedItem
        : item.storeMatches[store.id];

    if (storeItem && storeItem.inStock) {
      availableItems.push({ wishlistItem: item, storeItem });
    }
  }

  if (availableItems.length === 0) return null;

  // Sort cheapest first — we want to maximize items under the credit
  availableItems.sort((a, b) => a.storeItem.price - b.storeItem.price);

  const isPickup = store.pickupAvailable;

  // Greedily add items until we exceed the credit
  const selectedItems: StoreRecommendation["items"] = [];
  let runningSubtotal = 0;

  for (const item of availableItems) {
    const newSubtotal = runningSubtotal + item.storeItem.price;
    const newFees = calculateFees(newSubtotal, store, isPickup, creditAmount);

    // If adding this item would start costing us more out-of-pocket
    // than the item is worth, still include it but flag the transition
    selectedItems.push(item);
    runningSubtotal = newSubtotal;

    // For pickup: stop when subtotal hits the credit amount (everything above is OOP)
    // For delivery: we might want to hit the free delivery threshold
    if (isPickup && runningSubtotal >= creditAmount) {
      break;
    }
  }

  if (selectedItems.length === 0) return null;

  const subtotal = selectedItems.reduce(
    (sum, { storeItem }) => sum + storeItem.price,
    0
  );
  const fees = calculateFees(subtotal, store, isPickup, creditAmount);

  return {
    store,
    items: selectedItems,
    fees,
    isPickup,
  };
}

/**
 * Main optimization function.
 *
 * For each store, generates two recommendations:
 * 1. "All items" — buy everything from this store
 * 2. "Smart subset" — buy only what's covered by the credit (maximize free items)
 *
 * Returns all recommendations ranked by out-of-pocket cost (cheapest first).
 */
export function optimize(
  stores: Store[],
  wishlistItems: WishlistItem[],
  creditAmount: number = DEFAULT_CREDIT
): OptimizationResult {
  const recommendations: StoreRecommendation[] = [];

  for (const store of stores) {
    // Strategy 1: Buy all available items at this store
    const allItems = recommendStore(store, wishlistItems, creditAmount);
    if (allItems) {
      recommendations.push(allItems);
    }

    // Strategy 2: Smart subset — maximize free items
    const smartSubset = recommendSmartSubset(
      store,
      wishlistItems,
      creditAmount
    );
    if (
      smartSubset &&
      // Only include if it's different from the "all items" recommendation
      smartSubset.items.length !== allItems?.items.length
    ) {
      recommendations.push(smartSubset);
    }
  }

  // Sort by out-of-pocket cost (cheapest first), then by number of items (more is better)
  recommendations.sort((a, b) => {
    const costDiff = a.fees.outOfPocket - b.fees.outOfPocket;
    if (Math.abs(costDiff) > 0.01) return costDiff;
    // Tie-break: more items is better
    return b.items.length - a.items.length;
  });

  return {
    recommendations,
    totalItems: wishlistItems.length,
    creditAmount,
  };
}
