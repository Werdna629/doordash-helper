"use client";

import { useState, useEffect } from "react";

export default function AuthStatus() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  const checkAuth = async () => {
    setChecking(true);
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

  const handleLogin = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/auth", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setLoggedIn(true);
      }
    } catch {
      // ignore
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
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full bg-red-500" />
            <span className="text-red-700">Not logged in</span>
          </div>
          <button
            onClick={handleLogin}
            disabled={loading}
            className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {loading
              ? "Opening browser... Log in and come back here"
              : "Log in to DoorDash"}
          </button>
          <p className="text-xs text-gray-500">
            This opens a browser window where you log in manually. Your session
            is saved locally.
          </p>
        </div>
      )}
    </div>
  );
}
