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
      const success = await browserManager.importCookies(cookies);
      if (!success) {
        return NextResponse.json(
          { success: false, error: "Could not parse cookies. See instructions on the page." },
          { status: 400 }
        );
      }

      // Verify the cookies actually work
      const status = await browserManager.checkAuth();
      return NextResponse.json({
        success: status.loggedIn,
        error: status.loggedIn ? null : "Cookies were imported but the session appears invalid. They may be expired.",
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
