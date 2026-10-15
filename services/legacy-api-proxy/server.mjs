import { createServer } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { pathToFileURL } from 'node:url'

const origins = ['https://fit-training.ru', 'https://www.fit-training.ru',
  'https://fit-drab.vercel.app', 'capacitor://localhost', 'https://localhost', 'http://localhost']
const forwarded = ['origin', 'authorization', 'content-type', 'accept', 'x-fit-session',
  'x-fit-pilot-session', 'x-fit-request-id', 'x-supabase-authorization']
const hopHeaders = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade'])

// No SDK, credentials, database connection, retries, body parsing or logging.
// Proxying keeps the original CORS origin; a cross-origin redirect taints it.
export function createLegacyApiProxy({ connect = httpsRequest, allowedOrigins = origins } = {}) {
  return (request, response) => {
    const origin = request.headers.origin
    response.setHeader('cache-control', 'no-store')
    response.setHeader('vary', 'Origin')
    if (origin && !allowedOrigins.includes(origin)) { response.writeHead(403); response.end(); return }
    if (origin) {
      response.setHeader('access-control-allow-origin', origin)
      response.setHeader('access-control-allow-methods', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS')
      response.setHeader('access-control-allow-headers', forwarded.filter(name => name !== 'origin').join(', '))
    }
    if (request.method === 'OPTIONS') { response.writeHead(origin ? 204 : 403); response.end(); return }
    const path = request.url
    if (!path?.startsWith('/') || /[\r\n]/.test(path)) { response.writeHead(400); response.end(); return }
    const headers = { host: 'api.fit-training.ru' }
    for (const name of forwarded) if (typeof request.headers[name] === 'string') headers[name] = request.headers[name]
    // Node does not automatically choose chunked encoding for DELETE bodies.
    if (request.headers['content-length'] !== undefined) {
      const length = Number(request.headers['content-length'])
      if (!Number.isSafeInteger(length) || length < 0 || length > 32 * 1024 * 1024) {
        response.writeHead(413); response.end(); return
      }
      headers['content-length'] = String(length)
    } else if (!['GET', 'HEAD'].includes(request.method)) headers['transfer-encoding'] = 'chunked'
    const upstream = connect({ hostname: 'api.fit-training.ru', servername: 'api.fit-training.ru', port: 443,
      path, method: request.method, headers, rejectUnauthorized: true, timeout: 125_000,
      lookup: (_host, options, done) => done(null, options?.all ? [{ address: '87.242.117.210', family: 4 }] : '87.242.117.210', 4),
    }, incoming => {
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (!hopHeaders.has(name) && value !== undefined) response.setHeader(name, value)
      }
      response.setHeader('cache-control', 'no-store')
      response.writeHead(incoming.statusCode ?? 502)
      incoming.on('error', () => response.destroy())
      incoming.pipe(response)
    })
    upstream.on('timeout', () => upstream.destroy())
    upstream.on('error', () => {
      if (response.destroyed) return
      if (response.headersSent) response.destroy()
      else { response.writeHead(503, { 'content-type': 'application/json' }); response.end('{"error":"service_unavailable"}') }
    })
    let bytes = 0
    request.on('data', chunk => {
      bytes += chunk.length
      if (bytes > 32 * 1024 * 1024) { upstream.destroy(); response.destroy(); request.destroy() }
    })
    request.on('aborted', () => upstream.destroy())
    response.on('close', () => { if (!response.writableFinished) upstream.destroy() })
    request.pipe(upstream)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 8080)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid_port')
  const server = createServer(createLegacyApiProxy())
  server.requestTimeout = 130_000
  server.headersTimeout = 10_000
  server.listen(port, '0.0.0.0')
}
