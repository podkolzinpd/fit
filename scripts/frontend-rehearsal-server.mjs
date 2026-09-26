import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyRelease } from './frontend-release.mjs'

// Local adapter for the hosting contract, not a production Cloud Function.
// Validate and capture the complete release before accepting any request.
export function frontendHandler(active, retained = []) {
  const toFiles = (bundle) => new Map(verifyRelease(bundle).files.map((file) => [
    file.key, { ...file, bytes: Buffer.from(file.content, 'base64') },
  ]))
  const files = toFiles(active)
  for (const bundle of retained) {
    for (const [key, file] of toFiles(bundle)) {
      // Retain only content-addressed assets, never old HTML, SW or public files.
      if (!key.startsWith('assets/') || file.cacheControl !== 'public, max-age=31536000, immutable') continue
      const existing = files.get(key)
      if (existing && (existing.sha256 !== file.sha256 || existing.contentType !== file.contentType)) {
        throw new Error('Conflicting immutable asset across releases')
      }
      if (!existing) files.set(key, file)
    }
  }
  return (request, response) => {
    const fail = (status, extra = {}) => {
      response.writeHead(status, { 'Cache-Control': 'no-store', ...extra })
      response.end()
    }
    if (!['GET', 'HEAD'].includes(request.method)) return fail(405, { Allow: 'GET, HEAD' })
    let path
    try {
      const raw = (request.url ?? '').split(/[?#]/, 1)[0]
      if (!raw.startsWith('/') || raw.startsWith('//')) return fail(400)
      path = decodeURIComponent(raw).slice(1)
      if (/[\\\x00-\x1f\x7f%]/.test(path) || path.split('/').some((part) => part.startsWith('.'))) {
        return fail(400)
      }
    } catch { return fail(400) }
    let file = files.get(path)
    let recovery = false
    if (!file && path.startsWith('assets/')) {
      if (!path.endsWith('.js')) return fail(404)
      file = files.get('asset-recovery.js')
      recovery = true
    }
    file ??= files.get('index.html')
    const headers = {
      'Content-Type': file.contentType,
      'Cache-Control': recovery ? 'no-store' : file.cacheControl,
      'X-Content-Type-Options': 'nosniff',
      ETag: `"${file.sha256}"`,
    }
    if (!recovery && request.headers['if-none-match'] === headers.ETag) {
      response.writeHead(304, headers)
      return response.end()
    }
    response.writeHead(200, { ...headers, 'Content-Length': file.bytes.length })
    response.end(request.method === 'HEAD' ? undefined : file.bytes)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [activePath, ...retainedPaths] = process.argv.slice(2)
  if (!activePath) throw new Error('Usage: frontend-rehearsal-server.mjs ACTIVE [RETAINED...]')
  const bundles = await Promise.all([activePath, ...retainedPaths].map(async (path) =>
    JSON.parse(await readFile(path, 'utf8'))))
  const server = createServer(frontendHandler(bundles[0], bundles.slice(1)))
  server.listen(0, '127.0.0.1', () => {
    console.log(`Offline rehearsal: http://127.0.0.1:${server.address().port}; no cloud deployment`)
  })
}
