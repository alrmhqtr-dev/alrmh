// Adds what `expo export` leaves out of the single-page build: the link to the
// web manifest in public/, the iOS install tags, a viewport that reaches the
// screen edges (safe areas), and the service worker registration. The
// manifest, sw.js and offline.html themselves are static files in public/.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const index = join(dist, 'index.html')

const head = `
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
    <meta name="theme-color" content="#0B0B0B" />
    <meta name="apple-mobile-web-app-title" content="AlRmh" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="description" content="Design your thobe, book a measurement and track your order." />
    <style>html,body{background:#EDEAE4;overscroll-behavior-y:none}body{-webkit-tap-highlight-color:transparent}</style>
    <script>if('serviceWorker' in navigator){addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})})}</script>
  </head>`;

let html = readFileSync(index, 'utf8');
if (!html.includes('rel="manifest"')) {
  html = html.replace(/<meta name="viewport"[^>]*>/, '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" />');
  html = html.replace('</head>', head);
  writeFileSync(index, html);
}
console.log('postexport: install tags and service worker added to index.html');
