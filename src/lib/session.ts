import path from "path";
import os from "os";
import fs from "fs";

const CONFIG_DIR = path.join(os.homedir(), ".config", "doordash-helper");
const SESSION_FILE = path.join(CONFIG_DIR, "session.json");

interface StoredSession {
  cookies: string;
  userAgent: string;
  headers: Record<string, string>;
  savedAt: string;
}

/**
 * Session manager for DoorDash.
 *
 * Instead of using a headless browser (which Cloudflare blocks), we store
 * cookies and headers from the user's real browser (via cURL paste) and
 * replay them in direct Node.js fetch requests.
 */
class SessionManager {
  private cookies: string = "";
  private userAgent: string =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  private extraHeaders: Record<string, string> = {};

  constructor() {
    this.loadSession();
  }

  /**
   * Import session from a cURL command or cookie string.
   * Extracts cookies, user-agent, and other relevant headers.
   */
  importFromCurl(raw: string): { success: boolean; cookieCount: number; error?: string } {
    const trimmed = raw.trim();

    let cookieStr = "";
    let userAgent = this.userAgent;
    const headers: Record<string, string> = {};

    if (trimmed.startsWith("curl ") || trimmed.includes("curl '") || trimmed.includes('curl "')) {
      // Extract cookies
      const cookieMatch = trimmed.match(/-H\s+['"][Cc]ookie:\s*([^'"]+)['"]/);
      const cookieMatchB = trimmed.match(/(?:-b|--cookie)\s+['"]([^'"]+)['"]/);
      cookieStr = cookieMatch?.[1] || cookieMatchB?.[1] || "";

      // Extract user-agent
      const uaMatch = trimmed.match(/-H\s+['"][Uu]ser-[Aa]gent:\s*([^'"]+)['"]/);
      if (uaMatch) userAgent = uaMatch[1];

      // Extract other useful headers
      const headerRegex = /-H\s+['"]([^:'"]+):\s*([^'"]+)['"]/g;
      let m;
      while ((m = headerRegex.exec(trimmed)) !== null) {
        const key = m[1].toLowerCase();
        const value = m[2];
        // Keep headers that might be useful, skip cookie/UA (handled above)
        if (key !== "cookie" && key !== "user-agent" &&
            !key.startsWith("sec-") && key !== "accept-language" &&
            key !== "accept-encoding") {
          headers[m[1]] = value;
        }
      }
    } else if (trimmed.startsWith("[")) {
      // JSON cookie array
      try {
        const parsed = JSON.parse(trimmed) as Array<{ name: string; value: string }>;
        cookieStr = parsed.map(c => `${c.name}=${c.value}`).join("; ");
      } catch {
        return { success: false, cookieCount: 0, error: "Invalid JSON cookie array" };
      }
    } else {
      // Plain cookie string
      cookieStr = trimmed;
    }

    if (!cookieStr) {
      return { success: false, cookieCount: 0, error: "No cookies found in input" };
    }

    const cookieCount = cookieStr.split(";").filter(s => s.trim().includes("=")).length;

    this.cookies = cookieStr;
    this.userAgent = userAgent;
    this.extraHeaders = headers;
    this.saveSession();

    return { success: true, cookieCount };
  }

  /**
   * Check if we have a valid session by fetching a DoorDash page.
   */
  async checkAuth(): Promise<{ loggedIn: boolean; userName: string | null; cookieInfo?: string }> {
    if (!this.cookies) {
      return { loggedIn: false, userName: null, cookieInfo: "No cookies stored. Paste a cURL command to log in." };
    }

    try {
      const resp = await this.fetch("https://www.doordash.com/consumer/account/", {
        redirect: "manual", // Don't follow redirects — we want to check the Location
      });

      // If we get a redirect to login, we're not logged in
      const location = resp.headers.get("location") || "";
      if (resp.status >= 300 && resp.status < 400) {
        const isLoginRedirect =
          location.includes("/consumer/login") ||
          location.includes("/identity/login") ||
          location.includes("/consumer/auth");

        if (isLoginRedirect) {
          return {
            loggedIn: false,
            userName: null,
            cookieInfo: `Redirected to login (${resp.status}). Cookies may be expired — paste a fresh cURL.`,
          };
        }
      }

      // Check if we got a Cloudflare challenge
      if (resp.status === 403) {
        const text = await resp.text();
        if (text.includes("Just a moment") || text.includes("security verification")) {
          return {
            loggedIn: false,
            userName: null,
            cookieInfo: "Cloudflare challenge on auth check (403). Try pasting a fresh cURL — make sure it includes cf_clearance cookie.",
          };
        }
      }

      // 200 or other success — we're logged in
      const cookieCount = this.cookies.split(";").filter(s => s.includes("=")).length;
      const hasCfClearance = this.cookies.includes("cf_clearance");
      return {
        loggedIn: resp.status === 200,
        userName: null,
        cookieInfo: `${cookieCount} cookies${hasCfClearance ? " (has cf_clearance)" : " (no cf_clearance!)"}, status=${resp.status}`,
      };
    } catch (err) {
      return { loggedIn: false, userName: null, cookieInfo: `Error: ${err}` };
    }
  }

  /**
   * Make a fetch request with stored session cookies and headers.
   */
  async fetch(url: string, options: RequestInit = {}): Promise<Response> {
    const headers: Record<string, string> = {
      "User-Agent": this.userAgent,
      Cookie: this.cookies,
      ...this.extraHeaders,
      ...(options.headers as Record<string, string> || {}),
    };

    return globalThis.fetch(url, {
      ...options,
      headers,
    });
  }

  /**
   * Convenience: fetch a URL and return the text body + metadata.
   */
  async fetchText(
    url: string,
    extraHeaders: Record<string, string> = {}
  ): Promise<{ text: string; status: number; contentType: string }> {
    const resp = await this.fetch(url, { headers: extraHeaders });
    const text = await resp.text();
    return {
      text,
      status: resp.status,
      contentType: resp.headers.get("content-type") || "unknown",
    };
  }

  get hasCookies(): boolean {
    return this.cookies.length > 0;
  }

  // -- Persistence --

  private saveSession(): void {
    try {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      const data: StoredSession = {
        cookies: this.cookies,
        userAgent: this.userAgent,
        headers: this.extraHeaders,
        savedAt: new Date().toISOString(),
      };
      fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2));
    } catch {
      // ignore
    }
  }

  private loadSession(): void {
    try {
      if (fs.existsSync(SESSION_FILE)) {
        const data = JSON.parse(fs.readFileSync(SESSION_FILE, "utf-8")) as StoredSession;
        this.cookies = data.cookies || "";
        this.userAgent = data.userAgent || this.userAgent;
        this.extraHeaders = data.headers || {};
      }
    } catch {
      // ignore
    }
  }
}

export const sessionManager = new SessionManager();
