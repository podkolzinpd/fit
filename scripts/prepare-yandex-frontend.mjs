import { createHash } from 'node:crypto'
import { lstat, readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, relative, extname, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.mp4': 'video/mp4', '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg',
}

export function frontendFileMetadata(key) {
  const contentType = contentTypes[extname(key)]
  if (!contentType) throw new Error('Unsupported frontend artifact file')
  return {
    contentType,
    cacheControl: /^assets\/.+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(key)
      ? 'public, max-age=31536000, immutable' : 'no-cache',
  }
}

export async function prepareFrontend(directory, releaseId, routes) {
  if (!/^[a-f0-9]{40}$/.test(releaseId)) throw new Error('Expected a full commit SHA')
  const root = resolve(directory)
  if (!(await lstat(root)).isDirectory()) throw new Error('Expected a build directory')
  const files = []
  async function visit(path) {
    for (const name of (await readdir(path)).sort()) {
      const fullPath = resolve(path, name)
      const info = await lstat(fullPath)
      if (info.isSymbolicLink()) throw new Error('Symlinks are forbidden in frontend artifacts')
      if (name.startsWith('.')) throw new Error('Hidden files are forbidden in frontend artifacts')
      if (info.isDirectory()) { await visit(fullPath); continue }
      if (!info.isFile()) throw new Error('Unsupported frontend artifact file')
      const key = relative(root, fullPath).split('\\').join('/')
      const bytes = await readFile(fullPath)
      files.push({
        key, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
        ...frontendFileMetadata(key),
      })
    }
  }
  await visit(root)
  for (const required of ['index.html', 'sw.js', 'asset-recovery.js', 'site.webmanifest']) {
    if (!files.some((file) => file.key === required)) throw new Error(`Missing required artifact: ${required}`)
  }
  if (!files.some((file) => file.key.startsWith('assets/') && file.key.endsWith('.js'))) {
    throw new Error('Missing compiled application JavaScript')
  }
  return {
    schemaVersion: 1, releaseId, deployable: false,
    purpose: 'offline-hosting-rehearsal',
    // Preserve the source hosting contract, not a claimed Object Storage implementation.
    requiredRouting: routes,
    files,
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [directory, releaseId, output] = process.argv.slice(2)
  if (!directory || !releaseId || !output) throw new Error('Usage: prepare-yandex-frontend.mjs DIST SHA OUTPUT')
  const target = resolve(output)
  const root = resolve(directory)
  if (target === root || relative(root, target).split('/')[0] !== '..') {
    throw new Error('Manifest must be outside the build directory')
  }
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const { routes } = JSON.parse(await readFile(resolve(repo, 'vercel.json'), 'utf8'))
  const manifest = await prepareFrontend(root, releaseId, routes)
  await writeFile(target, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
  console.log(`Prepared ${manifest.files.length} files; manifest ${basename(target)}; deployment disabled`)
}
