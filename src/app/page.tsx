"use client";

import { useState, useEffect, useCallback } from "react";
import AuthStatus from "@/components/AuthStatus";
import StoreSelector from "@/components/StoreSelector";
import ItemPicker from "@/components/ItemPicker";
import PriceComparison from "@/components/PriceComparison";
import OptimizationResults from "@/components/OptimizationResults";
import type {
  Store,
  WishlistItem,
  SearchResult,
  OptimizationResult,
} from "@/lib/types";

const STORES_KEY = "doordash-helper-stores";
const WISHLIST_KEY = "doordash-helper-wishlist";

export default function Home() {
  const [stores, setStores] = useState<Store[]>([]);
  const [wishlistItems, setWishlistItems] = useState<WishlistItem[]>([]);
  const [optimizationResult, setOptimizationResult] =
    useState<OptimizationResult | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [creditAmount, setCreditAmount] = useState(10);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const savedStores = localStorage.getItem(STORES_KEY);
      if (savedStores) setStores(JSON.parse(savedStores));
      const savedWishlist = localStorage.getItem(WISHLIST_KEY);
      if (savedWishlist) setWishlistItems(JSON.parse(savedWishlist));
    } catch {
      // ignore
    }
  }, []);

  // Persist stores to localStorage
  const handleStoresChange = useCallback((newStores: Store[]) => {
    setStores(newStores);
    localStorage.setItem(STORES_KEY, JSON.stringify(newStores));
  }, []);

  // Persist wishlist to localStorage
  const updateWishlist = useCallback((items: WishlistItem[]) => {
    setWishlistItems(items);
    localStorage.setItem(WISHLIST_KEY, JSON.stringify(items));
    setOptimizationResult(null);
  }, []);

  const handleItemConfirmed = useCallback(
    (
      searchQuery: string,
      confirmedItem: SearchResult,
      storeMatches: Record<string, SearchResult | null>
    ) => {
      const newItem: WishlistItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        searchQuery,
        confirmedItem,
        storeMatches,
      };
      updateWishlist([...wishlistItems, newItem]);
    },
    [wishlistItems, updateWishlist]
  );

  const handleRemoveItem = useCallback(
    (itemId: string) => {
      updateWishlist(wishlistItems.filter((i) => i.id !== itemId));
    },
    [wishlistItems, updateWishlist]
  );

  const handleOptimize = async () => {
    if (wishlistItems.length === 0 || stores.length === 0) return;
    setOptimizing(true);

    try {
      const res = await fetch("/api/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stores, wishlistItems, creditAmount }),
      });
      const data = await res.json();
      setOptimizationResult(data);
    } catch {
      // ignore
    } finally {
      setOptimizing(false);
    }
  };

  return (
    <main className="mx-auto max-w-4xl p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">
          DoorDash Credit Optimizer
        </h1>
        <p className="mt-1 text-gray-500">
          Maximize the value of your monthly DoorDash grocery credit. Search
          items, compare prices across stores, and find the cheapest cart.
        </p>
      </div>

      <div className="space-y-6">
        <AuthStatus />

        <StoreSelector stores={stores} onStoresChange={handleStoresChange} />

        {stores.length > 0 && (
          <ItemPicker stores={stores} onItemConfirmed={handleItemConfirmed} />
        )}

        <PriceComparison
          wishlistItems={wishlistItems}
          stores={stores}
          onRemoveItem={handleRemoveItem}
        />

        {wishlistItems.length > 0 && stores.length > 0 && (
          <div className="flex items-center gap-4">
            <button
              onClick={handleOptimize}
              disabled={optimizing}
              className="rounded bg-green-600 px-6 py-3 text-base font-semibold text-white shadow hover:bg-green-700 disabled:opacity-50"
            >
              {optimizing ? "Optimizing..." : "Find Cheapest Order"}
            </button>

            <label className="flex items-center gap-2 text-sm text-gray-600">
              Credit amount: $
              <input
                type="number"
                value={creditAmount}
                onChange={(e) =>
                  setCreditAmount(parseFloat(e.target.value) || 10)
                }
                className="w-16 rounded border border-gray-300 px-2 py-1 text-center"
                min={0}
                step={0.5}
              />
            </label>
          </div>
        )}

        <OptimizationResults result={optimizationResult} loading={optimizing} />
      </div>
    </main>
  );
}
