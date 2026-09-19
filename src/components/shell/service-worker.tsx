"use client";
import { useEffect } from "react";

/** Registers /sw.js (install, offline page, web push). Renders nothing. */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // `updateViaCache: "none"`: the browser always asks the server for a newer worker.
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => undefined);
  }, []);
  return null;
}
