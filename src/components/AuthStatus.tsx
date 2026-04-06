"use client";

import { useState, useEffect } from "react";

export default function AuthStatus() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [cookieText, setCookieText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<string | null>(null);

  const checkAuth = async () => {
    setChecking(true);
    setError(null);
    try {
      const res = await fetch("/api/auth");
      const data = await res.json();
      setLoggedIn(data.loggedIn);
      setDebugInfo(data.cookieInfo || null);
    } catch {
      setLoggedIn(false);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  const handleCookieSubmit = async () => {
    if (!cookieText.trim()) return;
    setLoading(true);
    setError(null);
    setDebugInfo(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookies: cookieText.trim() }),
      });
      const data = await res.json();
      setDebugInfo(
        data.cookieInfo
          ? `${data.cookieCount ?? "?"} cookies imported. ${data.cookieInfo}`
          : null
      );
      if (data.success) {
        setLoggedIn(true);
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
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full bg-green-500" />
            <span className="text-green-700">Logged in</span>
            <button
              onClick={() => {
                setLoggedIn(null);
                setCookieText("");
              }}
              className="ml-auto text-sm text-gray-500 underline hover:text-gray-700"
            >
              Update cookies
            </button>
            <button
              onClick={checkAuth}
              className="text-sm text-gray-500 underline hover:text-gray-700"
            >
              Refresh
            </button>
          </div>
          {debugInfo && (
            <p className="text-xs text-gray-400">{debugInfo}</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full bg-red-500" />
            <span className="text-red-700">Not logged in</span>
          </div>

          <div className="space-y-2">
            <p className="text-sm text-gray-600">
              Paste a <strong>cURL command</strong> copied from your browser to log in.
            </p>
            <textarea
              value={cookieText}
              onChange={(e) => setCookieText(e.target.value)}
              placeholder="curl 'https://www.doordash.com/...' -H 'cookie: ...' ..."
              rows={4}
              className="w-full rounded border border-gray-300 px-3 py-2 font-mono text-xs focus:border-blue-500 focus:outline-none"
            />
            <button
              onClick={handleCookieSubmit}
              disabled={loading || !cookieText.trim()}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "Importing..." : "Import Session"}
            </button>
          </div>

          {/* Instructions */}
          <details className="rounded border border-gray-100 bg-gray-50 p-3 text-xs text-gray-600">
            <summary className="cursor-pointer font-medium text-gray-700">
              How to get your DoorDash session
            </summary>
            <ol className="mt-2 list-inside list-decimal space-y-2">
              <li>
                Open{" "}
                <strong>doordash.com</strong>{" "}
                in Chrome and <strong>log in normally</strong>.
              </li>
              <li>
                Open DevTools with{" "}
                <kbd className="rounded border border-gray-300 bg-gray-200 px-1">F12</kbd>.
              </li>
              <li>
                Go to the <strong>Network</strong> tab.
              </li>
              <li>
                Refresh the page, then click on <strong>any request</strong> to{" "}
                <code className="rounded bg-gray-200 px-1">doordash.com</code>{" "}
                in the list.
              </li>
              <li>
                Right-click the request &rarr; <strong>Copy</strong> &rarr;{" "}
                <strong>Copy as cURL</strong>.
              </li>
              <li>
                Paste the entire cURL command above. Cookies, user-agent, and
                other headers are extracted automatically.
              </li>
            </ol>
            <p className="mt-2 text-amber-600 font-medium">
              Important: The cURL must include the <code>cf_clearance</code> cookie
              (set by Cloudflare). If your session doesn&apos;t work, try copying
              a cURL from a freshly loaded DoorDash page.
            </p>
            <p className="mt-2 text-gray-500">
              Your cookies are stored locally and never sent anywhere except to
              DoorDash.
            </p>
          </details>

          {/* Debug info */}
          {debugInfo && (
            <p className="rounded bg-gray-100 p-2 font-mono text-xs text-gray-500">
              {debugInfo}
            </p>
          )}

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}
        </div>
      )}
    </div>
  );
}
