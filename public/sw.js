// SuZu One service worker. Deliberately small:
//  - caches only what is public and immutable: the build's hashed static files and the icons —
//    and only the most recent of them: every deploy brings new hashed files and the old ones are
//    never asked for again, so the cache keeps the last STATIC_LIMIT stored and drops the oldest;
//  - never caches a page, an RSC payload, a server action or an API response — all of those are
//    per person and permission-checked on the server, and a stale copy would be a leak or a lie;
//  - when a page cannot be reached it shows /offline.html;
//  - shows web-push notifications and opens their link.
// v3: the static cache is bounded; moving to it drops what v2 gathered over every deploy since.
const VERSION = "v3";
/** The offline page and the icon, stored at install and never pruned. */
const SHELL_CACHE = `suzu-shell-${VERSION}`;
/** Hashed build files as they are fetched, oldest dropped first. */
const STATIC_CACHE = `suzu-static-${VERSION}`;
const SHELL = ["/offline.html", "/icons/icon-192.png"];
/** Hashed files kept at most — a few deploys' worth of the screens a person opens. */
const STATIC_LIMIT = 400;
// The dev server's files are not content-hashed; caching them would serve stale code.
const DEV = self.location.hostname === "localhost" || self.location.hostname === "127.0.0.1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("suzu-") && key !== SHELL_CACHE && key !== STATIC_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    // Pages always come from the network; offline, say so instead of the browser's error page.
    event.respondWith(fetch(request).catch(() => caches.match("/offline.html")));
    return;
  }

  const immutable = url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");
  if (!immutable || DEV) return;
  event.respondWith(
    caches.open(STATIC_CACHE).then(async (cache) => {
      const hit = await cache.match(request);
      if (hit) return hit;
      const response = await fetch(request);
      if (response.ok && response.type === "basic") event.waitUntil(cache.put(request, response.clone()).then(() => prune(cache)));
      return response;
    }),
  );
});

/** Drops the oldest entries beyond STATIC_LIMIT (`keys()` lists them in the order they were stored). */
async function prune(cache) {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - STATIC_LIMIT)).map((key) => cache.delete(key)));
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || "SuZu One", {
      body: payload.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      tag: payload.tag,
      // Replacing a notice with the same tag is silent unless this is set; each push is news.
      renotify: Boolean(payload.tag),
      data: { link: payload.link || "/notifications" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Same-origin paths only: a push payload must not be able to send people elsewhere.
  const link = new URL((event.notification.data && event.notification.data.link) || "/notifications", self.location.origin);
  const target = link.origin === self.location.origin ? link.href : self.location.origin + "/notifications";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => "focus" in client);
      if (open) return open.navigate(target).then((client) => (client || open).focus());
      return self.clients.openWindow(target);
    }),
  );
});
