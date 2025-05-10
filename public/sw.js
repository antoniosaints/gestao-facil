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
  const data = event.data.json();
  self.registration.showNotification(data.title, {
    body: data.body,
  });
});
