// Arquivo básico para PWA
self.addEventListener("install", (event) => {
  console.log("[SW] Instalado");
});

self.addEventListener("activate", (event) => {
  console.log("[SW] Ativado");
});

self.addEventListener("fetch", (event) => {
  // Para comportamento online-first
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
