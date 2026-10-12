/* sw.js — Guarda la app en el celular para que abra sin internet. Subir la versión al cambiar archivos. */
const VERSION = "viaticoya-v3";
const ARCHIVOS = [
  "./", "index.html", "manifest.webmanifest", "css/estilos.css",
  "js/config.js", "js/logica.js", "js/xlsx.js", "js/almacen.js", "js/ui.js", "js/datos.js", "js/app.js",
  "fonts/barlow-latin-400-normal.woff2", "fonts/barlow-latin-600-normal.woff2", "fonts/barlow-latin-700-normal.woff2",
  "fonts/barlow-condensed-latin-600-normal.woff2", "fonts/barlow-condensed-latin-700-normal.woff2",
  "iconos/icono-192.png", "iconos/icono-512.png", "iconos/icono-maskable-512.png", "iconos/apple-touch-icon.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((claves) => Promise.all(claves.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Archivos de la app: primero la copia guardada (rápido y sin internet), y se refresca en segundo plano.
// Todo lo demás (servidor, fotos, datos) va directo a la red: nunca se guarda aquí.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  // La configuración se pide siempre primero a la red: así un cambio de claves se ve de inmediato (y sin internet usa la copia).
  if (url.pathname.endsWith("/js/config.js")) {
    e.respondWith(fetch(req).then((r) => { if (r.ok) { const copia = r.clone(); caches.open(VERSION).then((c) => c.put(req, copia)); } return r; }).catch(() => caches.match(req, { ignoreSearch: true })));
    return;
  }
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((guardado) => {
      const red = fetch(req).then((r) => {
        if (r.ok) { const copia = r.clone(); caches.open(VERSION).then((c) => c.put(req, copia)); }
        return r;
      }).catch(() => guardado || (req.mode === "navigate" ? caches.match("index.html") : Response.error()));
      return guardado || red;
    })
  );
});
