import { NextRequest, NextResponse } from "next/server";
import { optimize } from "@/lib/optimizer";
import type { Store, WishlistItem } from "@/lib/types";

/**
 * POST /api/optimize — Run the cart optimizer.
 * Body: { stores: Store[], wishlistItems: WishlistItem[], creditAmount?: number }
 * Returns ranked recommendations.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { stores, wishlistItems, creditAmount } = body as {
      stores?: Store[];
      wishlistItems?: WishlistItem[];
      creditAmount?: number;
    };

    if (!stores || !wishlistItems) {
      return NextResponse.json(
        { error: "Missing 'stores' or 'wishlistItems' in request body" },
        { status: 400 }
      );
    }

    if (wishlistItems.length === 0) {
      return NextResponse.json(
        { error: "Wishlist is empty" },
        { status: 400 }
      );
    }

    const result = optimize(stores, wishlistItems, creditAmount ?? 10);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
