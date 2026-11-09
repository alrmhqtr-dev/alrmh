// Serves the exported PWA (`pnpm build` → dist/) on a host that runs a
// process rather than a static CDN — Railway. No dependencies: Node's own
// http server is enough for a static site.
//
// Rules, matching apps/mobile/vercel.json:
// - a path with no file of its own (a deep link such as /orders/<id>) gets
//   index.html, and the router takes it from there;
// - the service worker and the HTML are never cached, so a deploy reaches
//   every phone; hashed bundles under /_expo/static are cached for a year;
// - /healthz answers 200 for the platform's health check.

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(process.env.STATIC_ROOT ?? join(fileURLToPath(import.meta.url), '../../dist'))
const PORT = Number(process.env.PORT ?? 8080)
const HOST = process.env.HOST ?? '0.0.0.0'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

async function fileFor(pathname) {
  const safe = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '')
  const full = resolve(ROOT, safe)
  if (full !== ROOT && !full.startsWith(ROOT + sep)) return null
  try {
    const s = await stat(full)
    if (s.isFile()) return full
  } catch {}
  return null
}

function cacheControl(pathname) {
  if (pathname.startsWith('/_expo/static/')) return 'public, max-age=31536000, immutable'
  if (pathname === '/sw.js' || pathname.endsWith('.html') || pathname === '/') return 'no-cache'
  return 'public, max-age=3600'
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://local')
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    return res.end('ok')
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405)
    return res.end()
  }
  const file = (await fileFor(url.pathname)) ?? (extname(url.pathname) ? null : join(ROOT, 'index.html'))
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    return res.end('Not found')
  }
  const name = file === join(ROOT, 'index.html') ? '/index.html' : url.pathname
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': cacheControl(name),
    'X-Content-Type-Options': 'nosniff',
  })
  if (req.method === 'HEAD') return res.end()
  createReadStream(file).pipe(res)
}).listen(PORT, HOST, () => console.log(`AlRmh web app on :${PORT}, serving ${ROOT}`))
