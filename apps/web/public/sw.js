// Service Worker cho quanly.store (apps/web).
// - App shell + tài sản tĩnh cùng origin: cache-first (offline vẫn mở được giao diện).
// - Mọi request /api/*: network-only, KHÔNG cache (dữ liệu nghiệp vụ luôn tươi,
//   tránh rò rỉ dữ liệu tenant này sang lần mở sau / tenant khác).
// - Tăng CACHE_VERSION khi đổi asset để cache cũ bị dọn.
const CACHE_VERSION = "quanly-store-v1";
const APP_SHELL = ["/", "/index.html", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Chỉ xử lý request cùng origin, GET.
  if (url.origin !== self.location.origin || event.request.method !== "GET") return;
  // API: luôn đi mạng, không cache.
  if (url.pathname.startsWith("/api/")) return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copy));
        }
        return res;
      });
    }),
  );
});
