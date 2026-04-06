import { NextRequest, NextResponse } from "next/server";
import { sessionManager } from "@/lib/session";

/** GET /api/auth — Check if the DoorDash session is authenticated */
export async function GET() {
  try {
    const status = await sessionManager.checkAuth();
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json(
      { loggedIn: false, userName: null, error: String(error) },
      { status: 500 }
    );
  }
}

/**
 * POST /api/auth — Authenticate with DoorDash.
 *
 * Body: { cookies: "curl command or cookie string" }
 * Extracts cookies and headers from the pasted cURL, stores them,
 * and verifies the session works.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { cookies } = body as { cookies?: string };

    if (!cookies || !cookies.trim()) {
      return NextResponse.json(
        { success: false, error: "Paste a cURL command or cookie string" },
        { status: 400 }
      );
    }

    const result = sessionManager.importFromCurl(cookies);
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    // Verify the cookies actually work
    const status = await sessionManager.checkAuth();
    return NextResponse.json({
      success: status.loggedIn,
      cookieCount: result.cookieCount,
      cookieInfo: status.cookieInfo,
      error: status.loggedIn
        ? null
        : `Imported ${result.cookieCount} cookies but session not recognized. ${status.cookieInfo || ""}`,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
