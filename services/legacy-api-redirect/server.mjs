import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

const origins = new Set(['https://fit-training.ru', 'https://www.fit-training.ru',
  'https://fit-drab.vercel.app', 'capacitor://localhost', 'https://localhost', 'http://localhost'])

// No SDK, credentials, database connection, body parsing or request logging.
// Temporary redirects preserve POST/PATCH bodies and remain reversible.
export function legacyRedirect(request, response) {
  const origin = request.headers.origin
  response.setHeader('cache-control', 'no-store')
  response.setHeader('vary', 'Origin')
  if (origin && !origins.has(origin)) { response.writeHead(403); response.end(); return }
  if (origin) {
    response.setHeader('access-control-allow-origin', origin)
    response.setHeader('access-control-allow-methods', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS')
    response.setHeader('access-control-allow-headers', 'authorization, content-type, x-fit-pilot-session, x-fit-session, x-fit-request-id, x-supabase-authorization')
  }
  if (request.method === 'OPTIONS') { response.writeHead(origin ? 204 : 403); response.end(); return }
  const path = request.url
  if (!path?.startsWith('/') || /[\r\n]/.test(path)) { response.writeHead(400); response.end(); return }
  response.writeHead(307, { location: `https://api.fit-training.ru${path}` })
  response.end()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 8080)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid_port')
  const server = createServer(legacyRedirect)
  server.requestTimeout = 15_000
  server.headersTimeout = 10_000
  server.listen(port, '0.0.0.0')
}
