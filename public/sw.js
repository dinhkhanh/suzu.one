// SuZu One service worker. Deliberately small:
//  - caches only what is public and immutable: the build's hashed static files and the icons;
//  - never caches a page, an RSC payload, a server action or an API response — all of those are
//    per person and permission-checked on the server, and a stale copy would be a leak or a lie;
//  - when a page cannot be reached it shows /offline.html;
//  - shows web-push notifications and opens their link.
const VERSION = "v1";
const STATIC_CACHE = `suzu-static-${VERSION}`;
const SHELL = ["/offline.html", "/icons/icon-192.png"];
// The dev server's files are not content-hashed; caching them would serve stale code.
const DEV = self.location.hostname === "localhost" || self.location.hostname === "127.0.0.1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("suzu-") && key !== STATIC_CACHE).map((key) => caches.delete(key))))
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
      if (response.ok && response.type === "basic") cache.put(request, response.clone());
      return response;
    }),
  );
});

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
