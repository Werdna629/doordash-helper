import { NextResponse } from "next/server";
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

/** POST /api/auth — Trigger the login flow (opens a visible browser window) */
export async function POST() {
  try {
    const success = await browserManager.login();
    return NextResponse.json({ success });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
