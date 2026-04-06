import { chromium, type Browser, type BrowserContext, type Page } from "patchright";
import path from "path";
import os from "os";

const USER_DATA_DIR = path.join(
  os.homedir(),
  ".config",
  "doordash-helper",
  "browser-profile"
);

/**
 * Singleton browser manager using Patchright (stealth Playwright fork).
 *
 * - Maintains a persistent Chromium profile so DoorDash session cookies survive restarts.
 * - All DoorDash GraphQL calls execute inside the browser via page.evaluate(fetch(...))
 *   to inherit the correct TLS fingerprint and cookies.
 */
class BrowserManager {
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  /** Launch (or reuse) the persistent browser context. */
  async launch(): Promise<void> {
    if (this.context) return;

    this.context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: true,
      viewport: { width: 1280, height: 800 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    });

    // Reuse the first page or create one
    const pages = this.context.pages();
    this.page = pages.length > 0 ? pages[0] : await this.context.newPage();
  }

  /** Get the active page, launching the browser if needed. */
  async getPage(): Promise<Page> {
    await this.launch();
    return this.page!;
  }

  /** Get the browser context. */
  async getContext(): Promise<BrowserContext> {
    await this.launch();
    return this.context!;
  }

  /**
   * Open a visible browser window for the user to log in to DoorDash.
   * Returns once the user has completed login (detected by cookie presence).
   */
  async login(): Promise<boolean> {
    // Close the headless context first
    await this.close();

    // Launch a visible (headed) browser for manual login
    const visibleContext = await chromium.launchPersistentContext(
      USER_DATA_DIR,
      {
        headless: false,
        viewport: { width: 1280, height: 800 },
      }
    );

    const page = visibleContext.pages()[0] || (await visibleContext.newPage());
    await page.goto("https://www.doordash.com/consumer/login/");

    // Wait for the user to log in — detected by navigating away from login page
    // or by the presence of a session cookie. Poll every 2 seconds, timeout 5 min.
    const loggedIn = await this.waitForLogin(page, 300_000);

    await visibleContext.close();

    // Re-launch headless context (cookies are persisted in USER_DATA_DIR)
    await this.launch();

    return loggedIn;
  }

  /**
   * Import cookies from a raw cookie string (copied from browser DevTools).
   * This bypasses the browser login flow entirely — just injects session cookies
   * into the headless browser profile.
   *
   * Supported formats:
   * - "key=value; key2=value2" (from document.cookie in console)
   * - Full cURL command (extracts the -H 'cookie: ...' or -b '...' header)
   * - JSON array (from cookie export extensions like EditThisCookie)
   */
  async importCookies(rawCookies: string): Promise<{ success: boolean; cookieCount: number; error?: string }> {
    const context = await this.getContext();

    const cookies = this.parseCookies(rawCookies);

    if (cookies.length === 0) {
      return { success: false, cookieCount: 0, error: "No cookies could be parsed from the input." };
    }

    await context.addCookies(cookies);

    // Navigate to DoorDash to ensure cookies take effect
    const page = await this.getPage();
    await page.goto("https://www.doordash.com/home/", {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });

    return { success: true, cookieCount: cookies.length };
  }

  /**
   * Check if the current session is authenticated.
   * Navigates to DoorDash and checks whether we land on a logged-in page
   * or get redirected to login.
   */
  async checkAuth(): Promise<{ loggedIn: boolean; userName: string | null; cookieInfo?: string }> {
    try {
      const context = await this.getContext();
      const page = await this.getPage();

      // List all cookies we have for DoorDash (for debugging)
      const cookies = await context.cookies("https://www.doordash.com");
      const cookieNames = cookies.map((c) => c.name);

      // Navigate to an account page — if we're logged in we'll see it,
      // if not we'll get redirected to login
      const response = await page.goto("https://www.doordash.com/consumer/account/", {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });

      // Wait a moment for any redirects to settle
      await page.waitForTimeout(2000);

      const finalUrl = page.url();

      const isOnLoginPage =
        finalUrl.includes("/consumer/login") ||
        finalUrl.includes("/identity/login") ||
        finalUrl.includes("/consumer/auth");

      // Try to grab the user's name from the account page if logged in
      let userName: string | null = null;
      if (!isOnLoginPage) {
        try {
          userName = await page.evaluate(() => {
            // Look for common patterns where DoorDash shows the user name
            const el = document.querySelector('[data-testid="AccountName"]') ||
                       document.querySelector('h1') ||
                       document.querySelector('[class*="AccountName"]');
            return el?.textContent?.trim() || null;
          });
        } catch {
          // ignore
        }
      }

      return {
        loggedIn: !isOnLoginPage,
        userName,
        cookieInfo: `${cookies.length} cookies (${cookieNames.slice(0, 8).join(", ")}${cookies.length > 8 ? "..." : ""}). Final URL: ${finalUrl}`,
      };
    } catch (err) {
      return { loggedIn: false, userName: null, cookieInfo: `Error: ${err}` };
    }
  }

  /**
   * Execute a fetch request inside the browser context.
   * This inherits all cookies and TLS fingerprinting from the real browser session.
   */
  async browserFetch(
    url: string,
    options: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    } = {}
  ): Promise<unknown> {
    const page = await this.getPage();

    return page.evaluate(
      async ({ url, options }) => {
        const resp = await fetch(url, {
          method: options.method || "GET",
          headers: {
            "Content-Type": "application/json",
            ...options.headers,
          },
          body: options.body,
          credentials: "include",
        });

        if (!resp.ok) {
          throw new Error(`Fetch failed: ${resp.status} ${resp.statusText}`);
        }

        return resp.json();
      },
      { url, options }
    );
  }

  /**
   * Execute a fetch request inside the browser context and return the raw text.
   * Used for DoorDash RSC (text/x-component) responses.
   *
   * Ensures the page is on a DoorDash origin first so cookies are sent.
   */
  async browserFetchText(
    url: string,
    headers: Record<string, string> = {}
  ): Promise<{ text: string; status: number; contentType: string }> {
    const page = await this.getPage();

    // Ensure we're on the DoorDash origin so cookies are sent.
    // Navigate to about:blank first if needed, then to a minimal DoorDash page.
    const currentUrl = page.url();
    if (!currentUrl.includes("doordash.com")) {
      // Navigate to the DoorDash homepage — even if Cloudflare blocks it,
      // the origin will be set and cookies will be available for fetch().
      try {
        await page.goto("https://www.doordash.com/home/", {
          waitUntil: "domcontentloaded",
          timeout: 10_000,
        });
      } catch {
        // Timeout is fine — we just need the origin set
      }
    }

    return page.evaluate(
      async ({ url, headers }) => {
        const resp = await fetch(url, {
          method: "GET",
          headers: {
            ...headers,
          },
          credentials: "include",
        });

        const text = await resp.text();
        return {
          text,
          status: resp.status,
          contentType: resp.headers.get("content-type") || "unknown",
        };
      },
      { url, headers }
    );
  }

  /** Close the browser. */
  async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
      this.page = null;
    }
  }

  // -- Private helpers --

  private parseCookies(
    raw: string
  ): Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
  }> {
    let trimmed = raw.trim();

    // Try JSON array format first (e.g., from EditThisCookie extension)
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed) as Array<{
          name: string;
          value: string;
          domain?: string;
          path?: string;
        }>;
        return parsed.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain || ".doordash.com",
          path: c.path || "/",
        }));
      } catch {
        // fall through to string parsing
      }
    }

    // If it looks like a cURL command, extract the cookie header
    if (trimmed.startsWith("curl ") || trimmed.includes("curl '")) {
      trimmed = this.extractCookiesFromCurl(trimmed);
    }

    // Parse "key=value; key2=value2" format
    return this.parseCookieString(trimmed);
  }

  /** Extract cookie string from a cURL command */
  private extractCookiesFromCurl(curl: string): string {
    // Match -H 'cookie: ...' or -H "cookie: ..." (case-insensitive)
    const headerMatch = curl.match(
      /-H\s+['"]cookie:\s*([^'"]+)['"]/i
    );
    if (headerMatch) return headerMatch[1];

    // Match -b '...' or -b "..." or --cookie '...'
    const bMatch = curl.match(
      /(?:-b|--cookie)\s+['"]([^'"]+)['"]/
    );
    if (bMatch) return bMatch[1];

    // Match -H 'Cookie: ...' with different casing / whitespace
    const headerMatch2 = curl.match(
      /-H\s+['"][Cc]ookie:\s*([^'"]+)['"]/
    );
    if (headerMatch2) return headerMatch2[1];

    // Couldn't find cookies in the cURL command — return as-is and hope
    // it's just a cookie string that happens to have "curl" in it
    return curl;
  }

  /** Parse a "key=value; key2=value2" cookie string */
  private parseCookieString(
    cookieStr: string
  ): Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
  }> {
    const cookies: Array<{
      name: string;
      value: string;
      domain: string;
      path: string;
    }> = [];

    for (const part of cookieStr.split(";")) {
      const eqIndex = part.indexOf("=");
      if (eqIndex === -1) continue;

      const name = part.slice(0, eqIndex).trim();
      const value = part.slice(eqIndex + 1).trim();

      if (!name) continue;

      cookies.push({
        name,
        value,
        domain: ".doordash.com",
        path: "/",
      });
    }

    return cookies;
  }

  private async waitForLogin(
    page: Page,
    timeoutMs: number
  ): Promise<boolean> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const url = page.url();
      // If user navigated away from login, they probably logged in
      if (
        !url.includes("/consumer/login") &&
        !url.includes("/identity/login")
      ) {
        return true;
      }

      // Also check for session cookies
      const cookies = await page.context().cookies("https://www.doordash.com");
      const hasSession = cookies.some(
        (c) => c.name === "ddsid" || c.name === "credential_token"
      );
      if (hasSession) return true;

      await page.waitForTimeout(2000);
    }

    return false;
  }
}

// Export a singleton instance
export const browserManager = new BrowserManager();
