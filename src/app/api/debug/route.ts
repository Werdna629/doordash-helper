import { NextRequest, NextResponse } from "next/server";
import { captureNetworkRequests } from "@/lib/doordash-api";

/**
 * POST /api/debug — Capture network requests from a DoorDash page.
 * Useful for debugging what requests/responses DoorDash makes.
 * Body: { storeUrl: string, durationMs?: number }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { storeUrl, durationMs } = body as {
      storeUrl?: string;
      durationMs?: number;
    };

    if (!storeUrl) {
      return NextResponse.json(
        { error: "Missing 'storeUrl' in request body" },
        { status: 400 }
      );
    }

    const requests = await captureNetworkRequests(
      storeUrl,
      durationMs ?? 10_000
    );

    return NextResponse.json({
      captured: requests.length,
      requests,
    });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
