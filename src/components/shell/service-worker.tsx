"use client";
import { useEffect } from "react";

/** Registers /sw.js (install, offline page, web push). Renders nothing. */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Not on the client's review link (D24): a stranger who opens one piece of work is not
    // installing our product. A worker registered there would outlive the link on their device.
    if (window.location.pathname === "/preview" || window.location.pathname.startsWith("/preview/")) return;
    // `updateViaCache: "none"`: the browser always asks the server for a newer worker.
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => undefined);
  }, []);
  return null;
}
