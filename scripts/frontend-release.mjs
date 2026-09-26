import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { prepareFrontend, frontendFileMetadata } from './prepare-yandex-frontend.mjs'

// Deliberately fail closed when the source hosting contract changes.
export const supportedRouting = [
  { handle: 'filesystem' },
  { src: '/assets/.*\\.js', dest: '/asset-recovery.js' },
  { src: '/assets/.*', status: 404 },
  { src: '/(.*)', dest: '/index.html' },
]
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const safeKey = (key) => typeof key === 'string' && /^[a-zA-Z0-9_./-]+$/.test(key)
  && key.split('/').every((part) => part.length > 0 && !part.startsWith('.'))

export function verifyRelease(bundle) {
  if (bundle?.schemaVersion !== 1 || bundle.deployable !== false
      || !/^[a-f0-9]{40}$/.test(bundle.commit ?? '')
      || !isDeepStrictEqual(bundle.routing, supportedRouting)
      || !Array.isArray(bundle.files) || bundle.files.length === 0) {
    throw new Error('Unsupported rehearsal release')
  }
  const keys = new Set()
  for (const file of bundle.files) {
    if (!safeKey(file.key) || keys.has(file.key)
        || typeof file.content !== 'string'
        || typeof file.contentType !== 'string' || /[\r\n]/.test(file.contentType)
        || !['no-cache', 'public, max-age=31536000, immutable'].includes(file.cacheControl)) {
      throw new Error('Invalid release entry')
    }
    const expected = frontendFileMetadata(file.key)
    if (file.contentType !== expected.contentType || file.cacheControl !== expected.cacheControl) {
      throw new Error('Invalid release metadata')
    }
    keys.add(file.key)
    const bytes = Buffer.from(file.content, 'base64')
    if (bytes.toString('base64') !== file.content || bytes.length !== file.size
        || sha256(bytes) !== file.sha256) throw new Error('Release checksum mismatch')
  }
  for (const key of ['index.html', 'asset-recovery.js', 'sw.js', 'site.webmanifest']) {
    if (!keys.has(key)) throw new Error('Incomplete release')
  }
  const fingerprint = sha256(JSON.stringify({ routing: bundle.routing, files: bundle.files }))
  if (bundle.release !== `${bundle.commit}-${fingerprint}`) throw new Error('Release identity mismatch')
  return bundle
}

export async function packageRelease(directory, commit, routing) {
  const manifest = await prepareFrontend(directory, commit, routing)
  const files = []
  for (const file of manifest.files) {
    const content = (await readFile(resolve(directory, file.key))).toString('base64')
    files.push({ ...file, content })
  }
  const fingerprint = sha256(JSON.stringify({ routing, files }))
  return verifyRelease({
    schemaVersion: 1, deployable: false, commit,
    release: `${commit}-${fingerprint}`, routing, files,
  })
}

// Upload instructions only: no credentials, network, writes or activation.
export function planRelease(bundle) {
  verifyRelease(bundle)
  return {
    schemaVersion: 1, deployable: false, release: bundle.release,
    activation: 'not-implemented',
    objects: bundle.files.map(({ content: _content, key, ...metadata }) => ({
      ...metadata, key: `releases/${bundle.release}/${key}`, overwrite: false,
    })),
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory, commit, output] = process.argv.slice(2)
  if (!directory || !commit || !output) throw new Error('Usage: frontend-release.mjs DIST COMMIT OUTPUT')
  const destination = relative(resolve(directory), resolve(output))
  if (destination === '' || destination.split(sep)[0] !== '..') {
    throw new Error('Release package must be outside the build directory')
  }
  const { routes } = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'))
  const bundle = await packageRelease(directory, commit, routes)
  await writeFile(output, JSON.stringify(bundle) + '\n', { flag: 'wx' })
  console.log(`Verified ${bundle.files.length} files; offline release only, no deployment`)
}
