// Arquivo básico para PWA
self.addEventListener('install', (event) => {
  console.log('[SW] Instalado');
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Ativado');
});

self.addEventListener('fetch', (event) => {
  // Para comportamento online-first
});
