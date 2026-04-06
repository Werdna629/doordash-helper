import { NextRequest, NextResponse } from "next/server";
import { searchItems, findMatchingItem } from "@/lib/doordash-api";

/**
 * POST /api/search — Search for items at a store.
 * Body: { storeId: string, query: string, limit?: number }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { storeId, query, limit } = body as {
      storeId?: string;
      query?: string;
      limit?: number;
    };

    if (!storeId || !query) {
      return NextResponse.json(
        { error: "Missing 'storeId' or 'query' in request body" },
        { status: 400 }
      );
    }

    const { results, debug } = await searchItems(storeId, query, limit ?? 10);
    return NextResponse.json({ results, debug });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/search — Find matching items across other stores.
 * Body: { storeIds: string[], itemName: string, limit?: number }
 * Returns matches per store.
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { storeIds, itemName, limit } = body as {
      storeIds?: string[];
      itemName?: string;
      limit?: number;
    };

    if (!storeIds || !itemName) {
      return NextResponse.json(
        { error: "Missing 'storeIds' or 'itemName' in request body" },
        { status: 400 }
      );
    }

    // Search all stores in parallel
    const matchPromises = storeIds.map(async (sid) => {
      const matches = await findMatchingItem(sid, itemName, limit ?? 5);
      return { storeId: sid, matches };
    });

    const results = await Promise.all(matchPromises);
    const matchesByStore: Record<
      string,
      Awaited<ReturnType<typeof findMatchingItem>>
    > = {};

    for (const { storeId: sid, matches } of results) {
      matchesByStore[sid] = matches;
    }

    return NextResponse.json({ matchesByStore });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
