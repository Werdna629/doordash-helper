import { NextRequest, NextResponse } from "next/server";
import { sessionManager } from "@/lib/session";

/**
 * POST /api/debug — Test a direct fetch to a DoorDash URL.
 * Body: { url: string }
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

    const result = await sessionManager.fetchText(url);

    return NextResponse.json({
      status: result.status,
      contentType: result.contentType,
      length: result.text.length,
      preview: result.text.slice(0, 2000),
    });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
