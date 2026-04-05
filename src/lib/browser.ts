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

  /** Check if the current session is authenticated. */
  async checkAuth(): Promise<{ loggedIn: boolean; userName: string | null }> {
    const page = await this.getPage();

    try {
      // Navigate to DoorDash home and check for auth indicators
      const response = await page.goto("https://www.doordash.com/home/", {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      });

      if (!response || response.status() >= 400) {
        return { loggedIn: false, userName: null };
      }

      // Check for login-gated elements — if we see the account icon or user name, we're logged in
      const isLoggedIn = await page.evaluate(() => {
        // DoorDash shows different UI for logged-in vs logged-out users
        // Check cookies for session indicators
        return document.cookie.includes("ddsid") ||
               document.cookie.includes("credential_token");
      });

      return { loggedIn: isLoggedIn, userName: null };
    } catch {
      return { loggedIn: false, userName: null };
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

  /** Close the browser. */
  async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
      this.page = null;
    }
  }

  // -- Private helpers --

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
