"use client";

import { useState, useEffect } from "react";

export default function AuthStatus() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [showCookieInput, setShowCookieInput] = useState(false);
  const [cookieText, setCookieText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const checkAuth = async () => {
    setChecking(true);
    setError(null);
    try {
      const res = await fetch("/api/auth");
      const data = await res.json();
      setLoggedIn(data.loggedIn);
    } catch {
      setLoggedIn(false);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  const handleBrowserLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.success) {
        setLoggedIn(true);
      } else {
        setError(data.error || "Login failed");
      }
    } catch {
      setError("Failed to connect to server");
    } finally {
      setLoading(false);
    }
  };

  const handleCookieSubmit = async () => {
    if (!cookieText.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookies: cookieText.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setLoggedIn(true);
        setShowCookieInput(false);
        setCookieText("");
      } else {
        setError(data.error || "Cookie import failed");
      }
    } catch {
      setError("Failed to connect to server");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-2 text-lg font-semibold">DoorDash Session</h2>

      {checking ? (
        <p className="text-gray-500">Checking login status...</p>
      ) : loggedIn ? (
        <div className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-full bg-green-500" />
          <span className="text-green-700">Logged in</span>
          <button
            onClick={checkAuth}
            className="ml-auto text-sm text-gray-500 underline hover:text-gray-700"
          >
            Refresh
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full bg-red-500" />
            <span className="text-red-700">Not logged in</span>
          </div>

          {/* Option 1: Browser login */}
          <div>
            <button
              onClick={handleBrowserLogin}
              disabled={loading}
              className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {loading && !showCookieInput
                ? "Opening browser..."
                : "Log in via Browser"}
            </button>
            <p className="mt-1 text-xs text-gray-500">
              Opens a browser window for manual login. May be blocked by bot
              detection.
            </p>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-2">
            <div className="h-px flex-1 bg-gray-200" />
            <span className="text-xs text-gray-400">or</span>
            <div className="h-px flex-1 bg-gray-200" />
          </div>

          {/* Option 2: Paste cookies */}
          {!showCookieInput ? (
            <button
              onClick={() => setShowCookieInput(true)}
              className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Paste Cookies from Browser
            </button>
          ) : (
            <div className="space-y-2">
              <textarea
                value={cookieText}
                onChange={(e) => setCookieText(e.target.value)}
                placeholder="Paste your cookies here..."
                rows={4}
                className="w-full rounded border border-gray-300 px-3 py-2 font-mono text-xs focus:border-blue-500 focus:outline-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleCookieSubmit}
                  disabled={loading || !cookieText.trim()}
                  className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {loading ? "Importing..." : "Import Cookies"}
                </button>
                <button
                  onClick={() => {
                    setShowCookieInput(false);
                    setCookieText("");
                    setError(null);
                  }}
                  className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Instructions */}
          <details className="rounded border border-gray-100 bg-gray-50 p-3 text-xs text-gray-600">
            <summary className="cursor-pointer font-medium text-gray-700">
              How to get your DoorDash cookies
            </summary>
            <ol className="mt-2 list-inside list-decimal space-y-1.5">
              <li>
                Open{" "}
                <span className="font-mono text-blue-700">
                  doordash.com
                </span>{" "}
                in Chrome/Firefox and <strong>log in normally</strong>.
              </li>
              <li>
                Open DevTools (<kbd className="rounded border bg-gray-200 px-1">F12</kbd> or{" "}
                <kbd className="rounded border bg-gray-200 px-1">Cmd+Opt+I</kbd>).
              </li>
              <li>
                Go to the <strong>Application</strong> tab (Chrome) or{" "}
                <strong>Storage</strong> tab (Firefox).
              </li>
              <li>
                In the left sidebar, expand <strong>Cookies</strong> and click{" "}
                <strong>https://www.doordash.com</strong>.
              </li>
              <li>
                You need to copy all cookies. The easiest ways:
                <ul className="ml-4 mt-1 list-disc space-y-1">
                  <li>
                    <strong>Console method:</strong> In the Console tab, run{" "}
                    <code className="rounded bg-gray-200 px-1">document.cookie</code>{" "}
                    and copy the output.
                  </li>
                  <li>
                    <strong>Extension method:</strong> Use a cookie export
                    extension like &quot;EditThisCookie&quot; and export as JSON.
                  </li>
                  <li>
                    <strong>cURL method:</strong> In the Network tab, right-click
                    any request to doordash.com &rarr; Copy &rarr; Copy as cURL.
                    Paste it here — the cookie header will be extracted.
                  </li>
                </ul>
              </li>
              <li>
                Paste the result into the text box above and click{" "}
                <strong>Import Cookies</strong>.
              </li>
            </ol>
            <p className="mt-2 text-gray-500">
              Your cookies are stored locally in the browser profile and never
              sent anywhere except to DoorDash.
            </p>
          </details>

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}
        </div>
      )}
    </div>
  );
}
