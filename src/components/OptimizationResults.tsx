"use client";

import type { OptimizationResult, StoreRecommendation } from "@/lib/types";

interface Props {
  result: OptimizationResult | null;
  loading: boolean;
}

function RecommendationCard({
  rec,
  rank,
}: {
  rec: StoreRecommendation;
  rank: number;
}) {
  const isFree = rec.fees.outOfPocket === 0;

  return (
    <div
      className={`rounded-lg border p-4 ${
        rank === 1
          ? "border-green-300 bg-green-50"
          : "border-gray-200 bg-white"
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <div>
          <span className="text-xs font-semibold uppercase text-gray-500">
            Option {rank}
          </span>
          <h3 className="text-lg font-bold">{rec.store.name}</h3>
        </div>
        <div className="text-right">
          {isFree ? (
            <span className="text-2xl font-bold text-green-600">FREE</span>
          ) : (
            <span className="text-2xl font-bold text-gray-900">
              ${rec.fees.outOfPocket.toFixed(2)}
            </span>
          )}
          <div className="text-xs text-gray-500">out-of-pocket</div>
        </div>
      </div>

      {rec.isPickup && (
        <span className="mb-2 inline-block rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
          Pickup — No fees
        </span>
      )}

      {/* Items */}
      <div className="mb-3 space-y-1">
        {rec.items.map(({ wishlistItem, storeItem }) => (
          <div
            key={wishlistItem.id}
            className="flex justify-between text-sm"
          >
            <span>{storeItem.name}</span>
            <span className="font-medium">${storeItem.price.toFixed(2)}</span>
          </div>
        ))}
      </div>

      {/* Fee breakdown */}
      <div className="border-t border-gray-200 pt-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-600">Subtotal</span>
          <span>${rec.fees.subtotal.toFixed(2)}</span>
        </div>
        {!rec.isPickup && (
          <>
            <div className="flex justify-between">
              <span className="text-gray-600">Delivery fee</span>
              <span>
                {rec.fees.deliveryFee === 0
                  ? "Free"
                  : `$${rec.fees.deliveryFee.toFixed(2)}`}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Service fee</span>
              <span>${rec.fees.serviceFee.toFixed(2)}</span>
            </div>
          </>
        )}
        <div className="flex justify-between font-medium">
          <span className="text-gray-600">Total before credit</span>
          <span>${rec.fees.totalBeforeCredit.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-green-600">
          <span>Credit applied</span>
          <span>-${rec.fees.creditApplied.toFixed(2)}</span>
        </div>
        <div className="mt-1 flex justify-between border-t border-gray-200 pt-1 text-base font-bold">
          <span>You pay</span>
          <span>
            {isFree ? (
              <span className="text-green-600">$0.00</span>
            ) : (
              `$${rec.fees.outOfPocket.toFixed(2)}`
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function OptimizationResults({ result, loading }: Props) {
  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <p className="text-gray-500">Optimizing your cart...</p>
      </div>
    );
  }

  if (!result) return null;

  if (result.recommendations.length === 0) {
    return (
      <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 shadow-sm">
        <p className="text-yellow-800">
          No recommendations found. Make sure your wishlist items are available
          at your stores.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">
        Recommendations ({result.recommendations.length} options)
      </h2>
      <p className="text-sm text-gray-500">
        Based on {result.totalItems} wishlist items with a $
        {result.creditAmount.toFixed(2)} credit.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        {result.recommendations.map((rec, i) => (
          <RecommendationCard key={`${rec.store.id}-${i}`} rec={rec} rank={i + 1} />
        ))}
      </div>
    </div>
  );
}
