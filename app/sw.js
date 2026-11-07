// Service worker de GyC: instalación como aplicación (M-12) y consulta sin conexión (M-13, lectura).
// La versión cambia en cada publicación para que los usuarios reciban la última versión.
const VERSION = 'gyc-v1.4.2';
const ARCHIVOS = [
  './',
  'index.html',
  'config.js',
  'manifest.webmanifest',
  'css/app.css',
  'css/admin.css',
  'js/main.js',
  'js/ui/grid.js',
  'js/ui/iconos.js',
  'js/ui/layout.js',
  'js/ui/ui.js',
  'js/services/columnas.js',
  'js/services/grupos-lps.js',
  'js/services/excel-listas.js',
  'js/services/importar.js',
  'js/services/indicadores.js',
  'js/services/pdf.js',
  'js/services/resumen.js',
  'js/views/actividad.js',
  'js/views/cartera.js',
  'js/views/config.js',
  'js/views/detalle.js',
  'js/views/login.js',
  'js/views/lookahead.js',
  'js/views/backlog.js',
  'js/views/en-blanco.js',
  'js/views/informacion-proyecto.js',
  'js/views/programa-arranque.js',
  'js/views/plan.js',
  'js/views/proyectos.js',
  'js/views/restricciones.js',
  'js/views/reunion.js',
  'js/views/tablero.js',
  'js/views/organigrama.js',
  'js/views/importar-proyectos.js',
  'js/views/reportes.js',
  'js/views/admin-console.js',
  'js/views/admin-plataforma.js',
  'js/views/admin-proyecto.js',
  'js/data/adapter-api.js',
  'js/data/api.js',
  'js/data/catalogos.js',
  'js/core/router.js',
  'js/core/store.js',
  'js/core/util.js',
  'js/core/monitoreo.js',
  'vendor/chart.umd.min.js',
  'vendor/tabulator.min.css',
  'vendor/tabulator.min.js',
  'vendor/xlsx.full.min.js',
  'img/icono-192.png',
  'img/icono-512.png',
  'img/icono.svg',
];

self.addEventListener('install', e => {
  // cache: 'reload' evita copiar al service worker archivos viejos de la caché HTTP del navegador
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ARCHIVOS.map(a => new Request(a, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION && k !== 'gyc-datos').map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Datos del API (Vercel): primero la red; sin conexión, la última respuesta guardada (solo lectura)
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(req).then(r => {
      if (r.ok) { const copia = r.clone(); caches.open('gyc-datos').then(c => c.put(req, copia)); }
      return r;
    }).catch(() => caches.match(req).then(r => r || new Response('[]', { headers: { 'Content-Type': 'application/json' } }))));
    return;
  }
  if (url.origin !== location.origin && !url.hostname.endsWith('fonts.googleapis.com') && !url.hostname.endsWith('fonts.gstatic.com')) return;
  // Aplicativo, librerías y fuentes: primero la caché de esta versión. Antes el código se confirmaba con el servidor
  // en cada carga (unas 45 consultas encadenadas a GitHub Pages). Cada publicación cambia VERSION: el navegador
  // detecta el sw.js nuevo, descarga todo de nuevo en segundo plano y la página se actualiza sola (main.js).
  const navegar = req.mode === 'navigate';
  e.respondWith(caches.open(VERSION).then(c => c.match(req, { ignoreSearch: navegar }).then(r => r || fetch(req).then(res => {
    if (res.ok) c.put(req, res.clone());
    return res;
  }))).catch(() => navegar ? caches.match('index.html') : Response.error()));
});
