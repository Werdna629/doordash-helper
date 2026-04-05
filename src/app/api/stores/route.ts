import { NextRequest, NextResponse } from "next/server";
import { getStoreInfo, parseStoreIdFromUrl } from "@/lib/doordash-api";
import type { Store } from "@/lib/types";

/**
 * POST /api/stores — Look up store info from a DoorDash URL.
 * Body: { url: string }
 * Returns the store info including name, fees, pickup availability.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url } = body as { url?: string };

    if (!url) {
      return NextResponse.json(
        { error: "Missing 'url' in request body" },
        { status: 400 }
      );
    }

    const storeId = parseStoreIdFromUrl(url);
    if (!storeId) {
      return NextResponse.json(
        { error: "Could not parse store ID from URL. Expected a DoorDash store URL." },
        { status: 400 }
      );
    }

    const storeInfo = await getStoreInfo(storeId);
    if (!storeInfo) {
      return NextResponse.json(
        { error: `Could not fetch info for store ${storeId}` },
        { status: 404 }
      );
    }

    // Override URL with the user-provided one
    const store: Store = { ...storeInfo, url };

    return NextResponse.json(store);
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
