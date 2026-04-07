import path from "path";
import os from "os";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const CONFIG_DIR = path.join(os.homedir(), ".config", "doordash-helper");
const SESSION_FILE = path.join(CONFIG_DIR, "session.json");

// Path to curl-impersonate-chrome binary (downloaded by scripts/setup.sh)
const CURL_IMPERSONATE_PATH = path.join(
  process.cwd(),
  "bin",
  "curl-impersonate-chrome"
);

// Chrome TLS flags for curl-impersonate
const CHROME_TLS_FLAGS = [
  "--ciphers",
  "TLS_AES_128_GCM_SHA256,TLS_AES_256_GCM_SHA384,TLS_CHACHA20_POLY1305_SHA256,ECDHE-ECDSA-AES128-GCM-SHA256,ECDHE-RSA-AES128-GCM-SHA256,ECDHE-ECDSA-AES256-GCM-SHA384,ECDHE-RSA-AES256-GCM-SHA384,ECDHE-ECDSA-CHACHA20-POLY1305,ECDHE-RSA-CHACHA20-POLY1305,ECDHE-RSA-AES128-SHA,ECDHE-RSA-AES256-SHA,AES128-GCM-SHA256,AES256-GCM-SHA384,AES128-SHA,AES256-SHA",
  "--http2",
  "--http2-no-server-push",
  "--compressed",
  "--tlsv1.2",
  "--alps",
  "--tls-permute-extensions",
  "--cert-compression", "brotli",
];

interface StoredSession {
  cookies: string;
  userAgent: string;
  /** All -H headers extracted from the cURL command (original casing) */
  allHeaders: Array<[string, string]>;
  savedAt: string;
}

/**
 * Session manager for DoorDash.
 *
 * Cloudflare's cf_clearance cookie is bound to the browser's TLS fingerprint
 * (JA3/JA4). Neither Node.js fetch nor a headless browser can replay it.
 *
 * Solution: shell out to the `curl` CLI with the exact same headers that
 * the user's real browser sent. This preserves the correct TLS behavior
 * and lets Cloudflare's challenge token pass through.
 */
class SessionManager {
  private cookies: string = "";
  private userAgent: string = "";
  /** All headers from the original cURL (preserving original case) */
  private allHeaders: Array<[string, string]> = [];

  constructor() {
    this.loadSession();
  }

  /**
   * Import session from a cURL command or cookie string.
   * Stores ALL headers from the cURL to replay them exactly.
   */
  importFromCurl(raw: string): { success: boolean; cookieCount: number; error?: string } {
    const trimmed = raw.trim();

    let cookieStr = "";
    let userAgent = "";
    const allHeaders: Array<[string, string]> = [];

    if (trimmed.startsWith("curl ") || trimmed.includes("curl '") || trimmed.includes('curl "')) {
      // Extract all -H headers (preserve original casing)
      const headerRegex = /-H\s+['"]([^'"]+)['"]/g;
      let m;
      while ((m = headerRegex.exec(trimmed)) !== null) {
        const headerLine = m[1];
        const colonIdx = headerLine.indexOf(":");
        if (colonIdx === -1) continue;
        const name = headerLine.slice(0, colonIdx).trim();
        const value = headerLine.slice(colonIdx + 1).trim();

        if (name.toLowerCase() === "cookie") {
          cookieStr = value;
        } else if (name.toLowerCase() === "user-agent") {
          userAgent = value;
        }

        allHeaders.push([name, value]);
      }

      // Also check for -b / --cookie flags
      if (!cookieStr) {
        const bMatch = trimmed.match(/(?:-b|--cookie)\s+['"]([^'"]+)['"]/);
        if (bMatch) cookieStr = bMatch[1];
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
      return { success: false, cookieCount: 0, error: "No cookies found in input. Make sure to copy as cURL from Chrome DevTools." };
    }

    const cookieCount = cookieStr.split(";").filter(s => s.trim().includes("=")).length;

    this.cookies = cookieStr;
    this.userAgent = userAgent;
    this.allHeaders = allHeaders;
    this.saveSession();

    return { success: true, cookieCount };
  }

  /**
   * Check if we have a valid session by curling a DoorDash page.
   */
  async checkAuth(): Promise<{ loggedIn: boolean; userName: string | null; cookieInfo?: string }> {
    if (!this.cookies) {
      return { loggedIn: false, userName: null, cookieInfo: "No cookies stored. Paste a cURL command to log in." };
    }

    try {
      const result = await this.curlFetch("https://www.doordash.com/consumer/account/");

      const cookieCount = this.cookies.split(";").filter(s => s.includes("=")).length;
      const hasCfClearance = this.cookies.includes("cf_clearance");

      const usingImpersonate = fs.existsSync(CURL_IMPERSONATE_PATH);

      // Check for Cloudflare challenge
      if (result.status === 403 && (result.body.includes("Just a moment") || result.body.includes("security verification"))) {
        const hint = usingImpersonate
          ? "cf_clearance may be expired — paste a fresh cURL."
          : "Run 'bash scripts/setup.sh' to install curl-impersonate (needed to bypass Cloudflare TLS check).";
        return {
          loggedIn: false,
          userName: null,
          cookieInfo: `Cloudflare challenge (403). ${cookieCount} cookies${hasCfClearance ? " (has cf_clearance)" : " (NO cf_clearance!)"}. ${hint}`,
        };
      }

      // Check for redirect to login
      if (result.redirectUrl) {
        const isLoginRedirect =
          result.redirectUrl.includes("/consumer/login") ||
          result.redirectUrl.includes("/identity/login") ||
          result.redirectUrl.includes("/consumer/auth");

        if (isLoginRedirect) {
          return {
            loggedIn: false,
            userName: null,
            cookieInfo: `Redirected to login. Cookies may be expired — paste a fresh cURL.`,
          };
        }
      }

      // Success
      return {
        loggedIn: result.status === 200 || (result.status >= 300 && result.status < 400 && !result.redirectUrl?.includes("login")),
        userName: null,
        cookieInfo: `${cookieCount} cookies${hasCfClearance ? " (has cf_clearance)" : ""}, status=${result.status}`,
      };
    } catch (err) {
      return { loggedIn: false, userName: null, cookieInfo: `Error: ${err}` };
    }
  }

  /**
   * Fetch a URL using curl-impersonate-chrome with the stored session headers.
   * curl-impersonate mimics Chrome's TLS fingerprint (JA3/JA4), which lets
   * Cloudflare's cf_clearance cookie pass validation.
   *
   * Falls back to regular curl if curl-impersonate is not installed.
   */
  async curlFetch(
    url: string,
    extraHeaders: Record<string, string> = {}
  ): Promise<{ body: string; status: number; contentType: string; redirectUrl: string | null }> {
    const curlBin = this.getCurlBinary();
    const args = this.buildCurlArgs(url, extraHeaders, curlBin === CURL_IMPERSONATE_PATH);

    try {
      const { stdout, stderr } = await execFileAsync(curlBin, args, {
        maxBuffer: 10 * 1024 * 1024, // 10MB
        timeout: 30_000,
      });

      // Parse the status code and headers from stderr (curl -w output)
      // We use -w to append status info
      const statusMatch = stderr.match(/HTTP\/[\d.]+\s+(\d+)/);
      const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;

      // Parse redirect location from stderr
      const locationMatch = stderr.match(/[Ll]ocation:\s*(\S+)/);
      const redirectUrl = locationMatch ? locationMatch[1] : null;

      // Content-type from stderr
      const ctMatch = stderr.match(/[Cc]ontent-[Tt]ype:\s*([^\r\n]+)/);
      const contentType = ctMatch ? ctMatch[1].trim() : "unknown";

      return { body: stdout, status, contentType, redirectUrl };
    } catch (error: unknown) {
      const err = error as { stdout?: string; stderr?: string; message?: string };
      // curl might exit non-zero but still have useful output
      if (err.stdout) {
        const statusMatch = err.stderr?.match(/HTTP\/[\d.]+\s+(\d+)/);
        const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;
        return { body: err.stdout, status, contentType: "unknown", redirectUrl: null };
      }
      // Check if curl-impersonate is missing
      if (err.message?.includes("ENOENT")) {
        throw new Error(
          `curl-impersonate-chrome not found. Run: bash scripts/setup.sh`
        );
      }
      throw new Error(`curl failed: ${err.message || error}`);
    }
  }

  /**
   * Convenience: fetch a URL and return text + metadata (used by doordash-api).
   */
  async fetchText(
    url: string,
    extraHeaders: Record<string, string> = {}
  ): Promise<{ text: string; status: number; contentType: string }> {
    const result = await this.curlFetch(url, extraHeaders);
    return { text: result.body, status: result.status, contentType: result.contentType };
  }

  get hasCookies(): boolean {
    return this.cookies.length > 0;
  }

  // -- Private --

  /**
   * Find the best available curl binary.
   * Prefers curl-impersonate-chrome (mimics Chrome TLS) over regular curl.
   */
  private getCurlBinary(): string {
    if (fs.existsSync(CURL_IMPERSONATE_PATH)) {
      return CURL_IMPERSONATE_PATH;
    }
    return "curl"; // fallback
  }

  /**
   * Build curl command args that replay the user's original browser headers.
   */
  private buildCurlArgs(
    url: string,
    extraHeaders: Record<string, string> = {},
    isImpersonate: boolean = false
  ): string[] {
    const args: string[] = [
      "-s",           // silent (no progress)
      "-S",           // show errors
      "-v",           // verbose (headers to stderr for parsing)
      "-L",           // follow redirects
      "--max-redirs", "3",
      "--max-time", "25",
      "-o", "-",      // output body to stdout
    ];

    // Add Chrome TLS flags when using curl-impersonate
    if (isImpersonate) {
      args.push(...CHROME_TLS_FLAGS);
    }

    // Replay ALL original headers from the cURL (except cookie, which we handle separately)
    for (const [name, value] of this.allHeaders) {
      if (name.toLowerCase() === "cookie") continue; // handled below
      args.push("-H", `${name}: ${value}`);
    }

    // Add any extra headers (like RSC headers)
    for (const [name, value] of Object.entries(extraHeaders)) {
      args.push("-H", `${name}: ${value}`);
    }

    // Always send cookies
    args.push("-H", `cookie: ${this.cookies}`);

    args.push(url);

    return args;
  }

  // -- Persistence --

  private saveSession(): void {
    try {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      const data: StoredSession = {
        cookies: this.cookies,
        userAgent: this.userAgent,
        allHeaders: this.allHeaders,
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
        this.allHeaders = data.allHeaders || [];
      }
    } catch {
      // ignore
    }
  }
}

export const sessionManager = new SessionManager();
