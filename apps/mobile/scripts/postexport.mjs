import { copyFileSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const base = (process.env.EXPO_BASE_URL ?? '').replace(/\/$/, '');
const version = new Date().toISOString().replace(/\D/g, '').slice(0, 14);

const manifest = {
  name: 'AlRmh — Tailored thobes',
  short_name: 'AlRmh',
  description: 'Design your thobe, book a measurement and track your order.',
  start_url: `${base}/`,
  scope: `${base}/`,
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#0B0B0B',
  theme_color: '#0B0B0B',
  lang: 'en',
  dir: 'auto',
  icons: [
    { src: `${base}/icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: `${base}/icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: `${base}/icons/maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};
writeFileSync(join(dist, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));

const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
const precache = walk(dist)
  .map((f) => '/' + relative(dist, f).split('\\').join('/'))
  .filter((p) => p.startsWith('/_expo/') || p.startsWith('/icons/') || /\.(ttf|png|ico)$/.test(p))
  .map((p) => base + p);

const sw = `const CACHE = 'alrmh-${version}';
const BASE = ${JSON.stringify(base)};
const PRECACHE = ${JSON.stringify([`${base}/`, ...precache])};
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('alrmh-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(BASE + '/', copy)); return res; }).catch(() => caches.match(BASE + '/')));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })));
});
`;
writeFileSync(join(dist, 'sw.js'), sw);

const head = `
    <link rel="manifest" href="${base}/manifest.webmanifest" />
    <link rel="apple-touch-icon" href="${base}/icons/apple-touch-icon.png" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="apple-mobile-web-app-title" content="AlRmh" />
    <meta name="description" content="Design your thobe, book a measurement and track your order." />
    <style>html,body{background:#EDEAE4;overscroll-behavior:none}</style>
    <script>if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('${base}/sw.js',{scope:'${base}/'}).catch(function(){})})}</script>
  </head>`;

const index = join(dist, 'index.html');
let html = readFileSync(index, 'utf8');
html = html.replace(/<meta name="viewport"[^>]*>/, '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />');
html = html.replace('httpEquiv=', 'http-equiv=');
html = html.replace('</head>', head);
writeFileSync(index, html);
copyFileSync(index, join(dist, '404.html'));
writeFileSync(join(dist, '.nojekyll'), '');
console.log(`postexport: PWA manifest, sw.js (${precache.length} files), 404.html, base="${base}"`);
