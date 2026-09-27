"use client";

import * as React from "react";

/**
 * Registers `public/sw.js` in production, which with the manifest makes the
 * app installable. In development it stays off, so a cached file never
 * hides a change.
 */
export function ServiceWorker() {
  React.useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Installing is a convenience; the app works the same without it.
    });
  }, []);
  return null;
}
