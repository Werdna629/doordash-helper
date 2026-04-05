import { NextRequest, NextResponse } from "next/server";
import { captureNetworkRequests } from "@/lib/doordash-api";

/**
 * POST /api/debug — Capture GraphQL network requests from a store page.
 * Useful for discovering DoorDash's current GraphQL operations.
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

    const operations = await captureNetworkRequests(
      storeUrl,
      durationMs ?? 10_000
    );

    return NextResponse.json({
      capturedOperations: operations.length,
      operations: operations.map((op) => ({
        operationName: op.operationName,
        variables: op.variables,
        queryPreview: op.query.slice(0, 200) + "...",
        fullQuery: op.query,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
