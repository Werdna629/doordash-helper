"use client";

import { useState } from "react";
import type { Store } from "@/lib/types";

interface Props {
  stores: Store[];
  onStoresChange: (stores: Store[]) => void;
}

export default function StoreSelector({ stores, onStoresChange }: Props) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addStore = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/stores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to add store");
        return;
      }

      // Don't add duplicates
      if (stores.some((s) => s.id === data.id)) {
        setError("This store is already added");
        return;
      }

      onStoresChange([...stores, data as Store]);
      setUrl("");
    } catch {
      setError("Failed to connect. Is the browser session active?");
    } finally {
      setLoading(false);
    }
  };

  const removeStore = (storeId: string) => {
    onStoresChange(stores.filter((s) => s.id !== storeId));
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-2 text-lg font-semibold">Grocery Stores</h2>
      <p className="mb-3 text-sm text-gray-500">
        Paste DoorDash store URLs for the grocery stores you want to compare.
      </p>

      {/* Store list */}
      {stores.length > 0 && (
        <div className="mb-3 space-y-2">
          {stores.map((store) => (
            <div
              key={store.id}
              className="flex items-center justify-between rounded border border-gray-100 bg-gray-50 px-3 py-2"
            >
              <div>
                <span className="font-medium">{store.name}</span>
                <div className="flex gap-3 text-xs text-gray-500">
                  {store.pickupAvailable && (
                    <span className="text-green-600">Pickup available</span>
                  )}
                  {store.freeDeliveryThreshold !== null && (
                    <span>
                      Free delivery over ${store.freeDeliveryThreshold}
                    </span>
                  )}
                  {store.minServiceFee !== null && (
                    <span>Min service fee: ${store.minServiceFee}</span>
                  )}
                </div>
              </div>
              <button
                onClick={() => removeStore(store.id)}
                className="text-sm text-red-500 hover:text-red-700"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add store form */}
      <div className="flex gap-2">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addStore()}
          placeholder="https://www.doordash.com/convenience/store/..."
          className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />
        <button
          onClick={addStore}
          disabled={loading || !url.trim()}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Loading..." : "Add Store"}
        </button>
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
