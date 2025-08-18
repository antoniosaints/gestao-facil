const CACHE_NAME = "pwa-cache-v1";
const ASSETS = [
  "/",
  "/css/",
  "/js/"
];

// Arquivo básico para PWA
self.addEventListener("install", (event) => {
  console.log("[SW] Instalado");
});

self.addEventListener("activate", (event) => {
  console.log("[SW] Ativado");
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.map((key) => key !== CACHE_NAME && caches.delete(key)))
      )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Para comportamento online-first
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
self.addEventListener("push", function (event) {
  const data = event.data?.json() || {};
  const options = {
    body: data.body || "Você tem uma nova notificação.",
    icon: "/icons/logo.png",
    badge: "/icons/logo.png",
  };
  event.waitUntil(
    self.registration.showNotification(data.title || "Notificação", options)
  );
});
