"use client";

import { useState } from "react";
import type { SearchResult, Store } from "@/lib/types";

interface Props {
  stores: Store[];
  onItemConfirmed: (
    searchQuery: string,
    confirmedItem: SearchResult,
    storeMatches: Record<string, SearchResult | null>
  ) => void;
}

export default function ItemPicker({ stores, onItemConfirmed }: Props) {
  const [query, setQuery] = useState("");
  const [searchStoreId, setSearchStoreId] = useState<string>("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [matchingItem, setMatchingItem] = useState<SearchResult | null>(null);
  const [crossStoreMatches, setCrossStoreMatches] = useState<
    Record<string, SearchResult[]>
  >({});
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [selectedMatches, setSelectedMatches] = useState<
    Record<string, SearchResult | null>
  >({});

  const handleSearch = async () => {
    if (!query.trim() || !searchStoreId) return;
    setSearching(true);
    setResults([]);
    setMatchingItem(null);
    setCrossStoreMatches({});

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: searchStoreId, query: query.trim() }),
      });
      const data = await res.json();
      setResults(data.results || []);
    } catch {
      // ignore
    } finally {
      setSearching(false);
    }
  };

  const handleConfirmItem = async (item: SearchResult) => {
    setMatchingItem(item);
    setLoadingMatches(true);
    setCrossStoreMatches({});
    setSelectedMatches({});

    // Search other stores for the same item
    const otherStoreIds = stores
      .filter((s) => s.id !== item.storeId)
      .map((s) => s.id);

    if (otherStoreIds.length === 0) {
      // Only one store — just confirm directly
      onItemConfirmed(query, item, {});
      resetState();
      return;
    }

    try {
      const res = await fetch("/api/search", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeIds: otherStoreIds,
          itemName: item.name,
        }),
      });
      const data = await res.json();
      setCrossStoreMatches(data.matchesByStore || {});

      // Auto-select the first match at each store
      const auto: Record<string, SearchResult | null> = {};
      for (const [sid, matches] of Object.entries(
        (data.matchesByStore || {}) as Record<string, SearchResult[]>
      )) {
        auto[sid] = matches.length > 0 ? matches[0] : null;
      }
      setSelectedMatches(auto);
    } catch {
      // ignore
    } finally {
      setLoadingMatches(false);
    }
  };

  const handleAcceptMatches = () => {
    if (!matchingItem) return;
    onItemConfirmed(query, matchingItem, selectedMatches);
    resetState();
  };

  const resetState = () => {
    setQuery("");
    setResults([]);
    setMatchingItem(null);
    setCrossStoreMatches({});
    setSelectedMatches({});
  };

  const storeName = (storeId: string) =>
    stores.find((s) => s.id === storeId)?.name || `Store ${storeId}`;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-2 text-lg font-semibold">Search Items</h2>

      {/* Search form */}
      <div className="mb-3 flex gap-2">
        <select
          value={searchStoreId}
          onChange={(e) => setSearchStoreId(e.target.value)}
          className="rounded border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">Select store...</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder='Search for an item (e.g., "milk")'
          className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />
        <button
          onClick={handleSearch}
          disabled={searching || !query.trim() || !searchStoreId}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {searching ? "Searching..." : "Search"}
        </button>
      </div>

      {/* Search results — pick exact item */}
      {results.length > 0 && !matchingItem && (
        <div>
          <p className="mb-2 text-sm font-medium text-gray-700">
            Select the exact item you want:
          </p>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {results.map((item) => (
              <button
                key={item.itemId}
                onClick={() => handleConfirmItem(item)}
                className="flex w-full items-center gap-3 rounded border border-gray-100 bg-gray-50 p-2 text-left hover:bg-blue-50 hover:border-blue-200"
              >
                {item.imageUrl && (
                  <img
                    src={item.imageUrl}
                    alt={item.name}
                    className="h-12 w-12 rounded object-cover"
                  />
                )}
                <div className="flex-1">
                  <div className="text-sm font-medium">{item.name}</div>
                  {item.description && (
                    <div className="text-xs text-gray-500">
                      {item.description}
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <div className="font-semibold text-green-700">
                    ${item.price.toFixed(2)}
                  </div>
                  {item.unitPrice && (
                    <div className="text-xs text-gray-500">
                      {item.unitPrice}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Cross-store matching */}
      {matchingItem && (
        <div>
          <div className="mb-3 rounded border border-blue-200 bg-blue-50 p-3">
            <p className="text-sm font-medium text-blue-800">
              Selected: {matchingItem.name} — ${matchingItem.price.toFixed(2)} at{" "}
              {storeName(matchingItem.storeId)}
            </p>
          </div>

          {loadingMatches ? (
            <p className="text-sm text-gray-500">
              Finding this item at other stores...
            </p>
          ) : (
            <div>
              <p className="mb-2 text-sm font-medium text-gray-700">
                Matches at other stores:
              </p>
              <div className="space-y-3">
                {Object.entries(crossStoreMatches).map(([sid, matches]) => (
                  <div key={sid}>
                    <p className="text-xs font-semibold text-gray-600">
                      {storeName(sid)}
                    </p>
                    {(matches as SearchResult[]).length === 0 ? (
                      <p className="text-xs text-gray-400">No matches found</p>
                    ) : (
                      <div className="space-y-1">
                        {(matches as SearchResult[]).slice(0, 3).map((m) => (
                          <label
                            key={m.itemId}
                            className={`flex cursor-pointer items-center gap-2 rounded border p-2 text-sm ${
                              selectedMatches[sid]?.itemId === m.itemId
                                ? "border-blue-400 bg-blue-50"
                                : "border-gray-100 bg-gray-50 hover:bg-gray-100"
                            }`}
                          >
                            <input
                              type="radio"
                              name={`match-${sid}`}
                              checked={
                                selectedMatches[sid]?.itemId === m.itemId
                              }
                              onChange={() =>
                                setSelectedMatches((prev) => ({
                                  ...prev,
                                  [sid]: m,
                                }))
                              }
                              className="text-blue-600"
                            />
                            <span className="flex-1">{m.name}</span>
                            <span className="font-semibold text-green-700">
                              ${m.price.toFixed(2)}
                            </span>
                          </label>
                        ))}
                        <label
                          className={`flex cursor-pointer items-center gap-2 rounded border p-2 text-sm ${
                            selectedMatches[sid] === null
                              ? "border-blue-400 bg-blue-50"
                              : "border-gray-100 bg-gray-50 hover:bg-gray-100"
                          }`}
                        >
                          <input
                            type="radio"
                            name={`match-${sid}`}
                            checked={selectedMatches[sid] === null}
                            onChange={() =>
                              setSelectedMatches((prev) => ({
                                ...prev,
                                [sid]: null,
                              }))
                            }
                            className="text-blue-600"
                          />
                          <span className="text-gray-500">
                            No good match at this store
                          </span>
                        </label>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-3 flex gap-2">
                <button
                  onClick={handleAcceptMatches}
                  className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
                >
                  Add to Wishlist
                </button>
                <button
                  onClick={resetState}
                  className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
