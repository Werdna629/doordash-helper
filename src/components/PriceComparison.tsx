"use client";

import type { Store, WishlistItem } from "@/lib/types";

interface Props {
  wishlistItems: WishlistItem[];
  stores: Store[];
  onRemoveItem: (itemId: string) => void;
}

export default function PriceComparison({
  wishlistItems,
  stores,
  onRemoveItem,
}: Props) {
  if (wishlistItems.length === 0) return null;

  const storeName = (storeId: string) =>
    stores.find((s) => s.id === storeId)?.name || `Store ${storeId}`;

  // Get all unique store IDs involved
  const storeIds = stores.map((s) => s.id);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-2 text-lg font-semibold">
        Wishlist ({wishlistItems.length} items)
      </h2>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="py-2 text-left font-medium text-gray-600">Item</th>
              {storeIds.map((sid) => (
                <th
                  key={sid}
                  className="py-2 text-right font-medium text-gray-600"
                >
                  {storeName(sid)}
                </th>
              ))}
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {wishlistItems.map((item) => {
              // Find cheapest price across stores
              const prices: Record<string, number | null> = {};
              let cheapestPrice = Infinity;

              for (const sid of storeIds) {
                const match =
                  item.confirmedItem.storeId === sid
                    ? item.confirmedItem
                    : item.storeMatches[sid];
                const price = match?.inStock ? match.price : null;
                prices[sid] = price;
                if (price !== null && price < cheapestPrice) {
                  cheapestPrice = price;
                }
              }

              return (
                <tr key={item.id} className="border-b border-gray-100">
                  <td className="py-2">
                    <div className="font-medium">{item.confirmedItem.name}</div>
                    <div className="text-xs text-gray-400">
                      Searched: &quot;{item.searchQuery}&quot;
                    </div>
                  </td>
                  {storeIds.map((sid) => {
                    const price = prices[sid];
                    const isCheapest =
                      price !== null && price === cheapestPrice;
                    return (
                      <td key={sid} className="py-2 text-right">
                        {price !== null ? (
                          <span
                            className={
                              isCheapest
                                ? "font-bold text-green-700"
                                : "text-gray-700"
                            }
                          >
                            ${price.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="py-2 text-right">
                    <button
                      onClick={() => onRemoveItem(item.id)}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
