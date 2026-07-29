const CACHE_NAME = "bloom-v2";
const SHELL = ["/", "/favicon.svg", "/icon-192x192.png", "/icon-512x512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;

  // Never cache API calls
  if (isSameOrigin && url.pathname.startsWith("/api/")) return;

  // Home / shell: serve cached shell if offline
  if (isSameOrigin && url.pathname === "/") {
    event.respondWith(
      caches.match("/").then((cached) => cached || fetch(request))
    );
    return;
  }

  // Static assets: stale-while-revalidate
  if (
    isSameOrigin &&
    /\.(js|css|svg|png|jpg|jpeg|gif|webp|woff|woff2|ttf|otf|ico)$/i.test(url.pathname)
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetched = fetch(request)
          .then((networkRes) => {
            if (networkRes && networkRes.status === 200 && networkRes.type === "basic") {
              const clone = networkRes.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
            return networkRes;
          })
          .catch(() => cached);
        return cached || fetched;
      })
    );
    return;
  }

  // Everything else: try network, fall back to cached shell
  event.respondWith(
    fetch(request)
      .catch(() => caches.match(request).then((cached) => cached || caches.match("/")))
  );
});
