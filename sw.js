/* Zähler – Service Worker
   - Seite/Navigation (index.html): network-first ohne HTTP-Cache, 3 s Timeout, offline aus dem Cache.
   - Statische Assets (Icons, Manifest): cache-first mit Hintergrund-Aktualisierung.
   - Löscht nur eigene alte Caches (zaehler-*), nie die anderer Apps auf derselben Domain. */
const CACHE = 'zaehler-v6';
const FILES = ['./', './index.html', './manifest.webmanifest', './apple-touch-icon.png', './icon-192.png', './icon-512.png'];
const NAV_TIMEOUT = 3000;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  let fromOld = false;
  const ready = (async () => {
    const keys = await caches.keys();
    const old = keys.filter(k => k.startsWith('zaehler-') && k !== CACHE);
    fromOld = old.some(k => /^zaehler-v[1-4]$/.test(k));
    await Promise.all(old.map(k => caches.delete(k)));
    await self.clients.claim();
  })();
  e.waitUntil(ready);
  // Upgrade von v1–v4: deren Seite kennt kein automatisches Neuladen -> offene Fenster einmal neu laden.
  // Bewusst NICHT in waitUntil: die Navigation braucht den fertig aktivierten Worker (sonst Deadlock).
  ready.then(() => {
    if (!fromOld) return;
    setTimeout(() => self.clients.matchAll({ type: 'window' })
      .then(ws => ws.forEach(w => { if (w.navigate) w.navigate(w.url).catch(() => {}); })), 0);
  });
});

const isPage = (req, url) => req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
const scopePath = () => new URL(self.registration.scope).pathname;

async function pageNetworkFirst(e, req, url) {
  const cache = await caches.open(CACHE);
  const key = new URL('./index.html', self.registration.scope).href; // eine Kopie der Seite, egal ob ./ , ./index.html oder ?query
  const net = fetch(url.origin + url.pathname, { cache: 'no-store', credentials: 'same-origin' }).then(res => {
    if (res && res.ok && res.type === 'basic') cache.put(key, res.clone());
    return res;
  });
  e.waitUntil(net.catch(() => {})); // läuft nach Timeout weiter und aktualisiert den Cache
  const timeout = new Promise(res => setTimeout(() => res(null), NAV_TIMEOUT));
  try {
    const res = await Promise.race([net, timeout]);
    if (res && res.ok) return res;
  } catch (e) {}
  const hit = await cache.match(key) || await caches.match(req, { ignoreSearch: true }) || await caches.match(new URL('./', self.registration.scope).href);
  if (hit) return hit;
  return net; // weder Netz (rechtzeitig) noch Cache: auf Netz warten
}

async function assetCacheFirst(e) {
  const hit = await caches.match(e.request, { ignoreSearch: true });
  const net = fetch(e.request).then(res => {
    if (res && res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  });
  if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
  return net;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || !url.pathname.startsWith(scopePath())) return;
  if (url.pathname.endsWith('/sw.js')) return;
  e.respondWith(isPage(req, url) ? pageNetworkFirst(e, req, url) : assetCacheFirst(e));
});
