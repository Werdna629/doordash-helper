import { NextRequest, NextResponse } from "next/server";
import { browserManager } from "@/lib/browser";

/** GET /api/auth — Check if the DoorDash session is authenticated */
export async function GET() {
  try {
    const status = await browserManager.checkAuth();
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
 * Two modes:
 * - No body or empty body: trigger browser login flow (opens visible window)
 * - Body with { cookies: "..." }: import cookies directly (paste from DevTools)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { cookies } = body as { cookies?: string };

    if (cookies && cookies.trim()) {
      // Cookie-paste auth
      const result = await browserManager.importCookies(cookies);
      if (!result.success) {
        return NextResponse.json(
          { success: false, error: result.error },
          { status: 400 }
        );
      }

      // Verify the cookies actually work
      const status = await browserManager.checkAuth();
      return NextResponse.json({
        success: status.loggedIn,
        cookieCount: result.cookieCount,
        cookieInfo: status.cookieInfo,
        error: status.loggedIn
          ? null
          : `Imported ${result.cookieCount} cookies but session not recognized. ${status.cookieInfo || ""}. Cookies may be expired — try copying fresh ones.`,
      });
    }

    // Browser login flow
    const success = await browserManager.login();
    return NextResponse.json({ success });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
