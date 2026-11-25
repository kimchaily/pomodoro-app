"use strict";

// Network-first: Online – und in der Android-App, wo "Netzwerk" die in der APK
// gebündelten Dateien sind – kommt immer die aktuelle Version; der Cache ist nur
// der Offline-Fallback. Deshalb bleibt CACHE_NAME über Releases gleich: sw.js
// ändert sich nur, wenn sich die Worker-Logik ändert.
const CACHE_NAME = "pomodoro-offline";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  const activated = (async () => {
    const stale = (await caches.keys()).filter((k) => k !== CACHE_NAME);
    await Promise.all(stale.map((k) => caches.delete(k)));
    await self.clients.claim();
    return stale.length > 0;
  })();
  event.waitUntil(activated);
  // Ablösung des früheren Cache-first-Workers: offene Fenster zeigen noch die
  // alte Version aus dessen Cache – einmal neu laden, damit sie sofort aktuell
  // sind. Bewusst NICHT in waitUntil: die Navigation braucht einen aktivierten
  // Worker, darauf zu warten würde die Aktivierung (und jeden Seitenaufruf) blockieren.
  activated.then(async (upgraded) => {
    if (!upgraded) return;
    const windows = await self.clients.matchAll({ type: "window" });
    windows.forEach((c) => c.navigate(c.url).catch(() => {}));
  });
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      // Anfragen mit Query (z. B. version.json?t=…) nicht cachen – jede wäre ein neuer Eintrag.
      if (res.ok && !new URL(req.url).search) {
        const copy = res.clone();
        event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)));
      }
      return res;
    } catch {
      const cached = await caches.match(req, { ignoreSearch: req.mode === "navigate" });
      if (cached) return cached;
      if (req.mode === "navigate") return (await caches.match("./")) || Response.error();
      return Response.error();
    }
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const client = clients.find((c) => "focus" in c);
      return client ? client.focus() : self.clients.openWindow("./");
    })
  );
});
