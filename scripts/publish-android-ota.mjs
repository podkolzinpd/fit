import { createHash, verify } from 'node:crypto'
import { readFile, writeFile, mkdir, lstat, rename, unlink, statfs } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { androidOtaPolicy } from './android-ota-contract.mjs'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const nativeBuild = Number((await readFile(new URL('../android/app/build.gradle', import.meta.url), 'utf8')).match(/\bversionCode (\d+)/)?.[1])

export function decodeSignedManifest(bytes, publicKey) {
  const envelope = JSON.parse(bytes.toString())
  if (typeof envelope.payload !== 'string' || typeof envelope.signature !== 'string'
      || !verify('sha256', Buffer.from(envelope.payload, 'base64'), publicKey, Buffer.from(envelope.signature, 'base64'))) {
    throw new Error('OTA_MANIFEST_SIGNATURE')
  }
  return JSON.parse(Buffer.from(envelope.payload, 'base64').toString())
}

export async function verifyOtaDirectory(directory, commit, policy = androidOtaPolicy(), build = nativeBuild) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('OTA_SOURCE_INVALID')
  const manifestPath = `android/alpha/${policy.abi}/latest.json`
  const manifest = await readFile(resolve(directory, manifestPath))
  const payload = decodeSignedManifest(manifest, policy.publicKey)
  const now = Date.now()
  if (payload.schema !== 1 || payload.appId !== policy.appId || payload.platform !== 'android'
      || payload.channel !== 'alpha' || payload.abi !== policy.abi || payload.sourceCommit !== commit
      || !Number.isSafeInteger(payload.sequence) || payload.sequence <= 0
      || !Number.isSafeInteger(payload.issuedAt) || payload.issuedAt > now + 300000
      || !Number.isSafeInteger(payload.expiresAt) || payload.expiresAt <= now
      || payload.expiresAt > payload.issuedAt + 30 * 86400000) throw new Error('OTA_MANIFEST_CONTRACT')
  const provenance = JSON.parse(await readFile(resolve(directory, 'provenance.json'), 'utf8'))
  if (provenance.commit !== commit || provenance.abi !== policy.abi || provenance.nativeBuild !== build
      || provenance.sequence !== payload.sequence || provenance.bundleId !== (payload.release?.bundleId ?? null)) {
    throw new Error('OTA_PROVENANCE_MISMATCH')
  }
  let archive
  let archivePath
  if (payload.release !== null) {
    const release = payload.release
    if (!release || !hash(release.checksum) || release.bundleId !== release.checksum
        || release.url !== `${policy.origin}/mobile-updates/android/bundles/${release.checksum}.zip`
        || release.minNativeBuild !== build || release.maxNativeBuild !== build
        || typeof release.signature !== 'string') throw new Error('OTA_ARCHIVE_CONTRACT')
    archivePath = `android/bundles/${release.checksum}.zip`
    archive = await readFile(resolve(directory, archivePath))
    if (archive.length > 100 * 1024 * 1024 || digest(archive) !== release.checksum
        || !verify('sha256', archive, policy.publicKey, Buffer.from(release.signature, 'base64'))) {
      throw new Error('OTA_ARCHIVE_SIGNATURE')
    }
  }
  return { manifest, manifestPath, payload, archive, archivePath, policy }
}

async function safeDirectory(path) {
  // Check each existing ancestor, including /var/lib. Never follow a symlink.
  const absolute = resolve(path)
  if (absolute !== '/') await safeDirectory(dirname(absolute))
  await mkdir(absolute).catch(error => { if (error.code !== 'EEXIST') throw error })
  const info = await lstat(absolute)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('OTA_UNSAFE_DIRECTORY')
}

export async function installOtaArchive(verified, root) {
  await safeDirectory(root)
  if (!verified.archive) return
  const path = resolve(root, verified.archivePath)
  await safeDirectory(dirname(path))
  try { await writeFile(path, verified.archive, { flag: 'wx', mode: 0o644 }) }
  catch (error) {
    if (error.code !== 'EEXIST') throw error
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || digest(await readFile(path)) !== digest(verified.archive)) {
      throw new Error('OTA_IMMUTABLE_ARCHIVE_MISMATCH')
    }
  }
}

export async function activateOtaManifest(verified, root) {
  const path = resolve(root, verified.manifestPath)
  await safeDirectory(dirname(path))
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('OTA_UNSAFE_MANIFEST')
    const previousBytes = await readFile(path)
    const previous = decodeSignedManifest(previousBytes, verified.policy.publicKey)
    if (previous.abi !== verified.payload.abi || previous.sequence > verified.payload.sequence
        || (previous.sequence === verified.payload.sequence && !previousBytes.equals(verified.manifest))) {
      throw new Error('OTA_SEQUENCE_NOT_NEWER')
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  const temporary = `${path}.${process.pid}.next`
  try {
    await writeFile(temporary, verified.manifest, { flag: 'wx', mode: 0o644 })
    await rename(temporary, path)
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
}

export function withOtaLocation(configuration, fragment) {
  if (configuration.includes('# Fit Android OTA begin')) {
    return configuration.replace(/    # Fit Android OTA begin\n[\s\S]*?    # Fit Android OTA end\n/, `    # Fit Android OTA begin\n${fragment}\n    # Fit Android OTA end\n`)
  }
  const anchor = '    location / {\n        proxy_pass http://127.0.0.1:18081;'
  if (configuration.split(anchor).length !== 2) throw new Error('OTA_NGINX_ANCHOR_MISSING')
  return configuration.replace(anchor, `    # Fit Android OTA begin\n${fragment}\n    # Fit Android OTA end\n\n${anchor}`)
}

async function verifyPublicArchive(verified) {
  if (!verified.archive) return
  const response = await fetch(verified.payload.release.url, { redirect: 'error', signal: AbortSignal.timeout(60000) })
  if (!response.ok || digest(Buffer.from(await response.arrayBuffer())) !== verified.payload.release.checksum) {
    throw new Error('OTA_PUBLIC_ARCHIVE_MISMATCH')
  }
}

export async function readbackOta(verified) {
  const url = `${verified.policy.origin}/mobile-updates/${verified.manifestPath}`
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) })
  if (!response.ok || response.headers.get('access-control-allow-origin') !== 'https://localhost'
      || response.headers.get('cache-control') !== 'no-store'
      || !Buffer.from(await response.arrayBuffer()).equals(verified.manifest)) throw new Error('OTA_PUBLIC_MANIFEST_MISMATCH')
  await verifyPublicArchive(verified)
  const unknown = await fetch(`${verified.policy.origin}/mobile-updates/android/not-a-release`, { signal: AbortSignal.timeout(15000) })
  if (unknown.status !== 404) throw new Error('OTA_PUBLIC_UNKNOWN_PATH')
}

export async function requireKnownNativeShell(verified, root, newNativeApk = false) {
  try {
    const path = resolve(root, verified.manifestPath)
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('OTA_UNSAFE_MANIFEST')
    const existing = decodeSignedManifest(await readFile(path), verified.policy.publicKey)
    if (existing.abi !== verified.payload.abi) throw new Error('OTA_NATIVE_ABI_MISMATCH')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    if (!newNativeApk) throw new Error('OTA_NATIVE_APK_REQUIRED: build a signed APK for the changed native ABI')
  }
}

export async function requirePublishedApi(commit, fetcher = fetch) {
  const response = await fetcher('https://api.fit-training.ru/health', {
    redirect: 'error', signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error('OTA_PRODUCTION_API_NOT_READY')
  const health = await response.json()
  if (health.status !== 'ok' || health.releaseId !== commit) throw new Error('OTA_PRODUCTION_API_REVISION_MISMATCH')
}

async function publish(verified, newNativeApk) {
  const root = '/var/lib/fit-mobile-updates'
  await requirePublishedApi(verified.payload.sourceCommit)
  await requireKnownNativeShell(verified, root, newNativeApk)
  const disk = await statfs('/var/lib')
  if (disk.bavail * disk.bsize < 2 * 1024 ** 3 + (verified.archive?.length ?? 0) * 2) {
    throw new Error('OTA_DISK_RESERVE_REQUIRED')
  }
  const site = '/etc/nginx/sites-available/fit-public-web'
  const info = await lstat(site)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('OTA_NGINX_SITE_UNSAFE')
  const previous = await readFile(site, 'utf8')
  const fragment = await readFile(new URL('../infra/cloudru/mobile-updates/location.conf', import.meta.url), 'utf8')
  const next = withOtaLocation(previous, fragment)
  await installOtaArchive(verified, root)
  const backup = `${site}.ota-${Date.now()}.backup`
  await writeFile(backup, previous, { flag: 'wx', mode: 0o600 })
  try {
    await writeFile(site, next, { mode: 0o644 })
    execFileSync('nginx', ['-t'], { stdio: 'inherit' })
    execFileSync('systemctl', ['reload', 'nginx'])
    // No metadata changes until the public immutable object can be downloaded.
    await verifyPublicArchive(verified)
  } catch (error) {
    await writeFile(site, previous)
    execFileSync('nginx', ['-t'], { stdio: 'inherit' })
    execFileSync('systemctl', ['reload', 'nginx'])
    throw error
  }
  await activateOtaManifest(verified, root)
  await readbackOta(verified)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, directory, commit] = process.argv.slice(2)
  if (!['verify', 'publish', 'readback'].includes(mode) || !directory || !commit) throw new Error('Invalid OTA publisher invocation')
  const verified = await verifyOtaDirectory(directory, commit)
  if (mode === 'publish') await publish(verified, process.argv.includes('--new-native-apk'))
  if (mode === 'readback') await readbackOta(verified)
  console.log(`OTA ${mode} passed: source ${commit}; ABI ${verified.payload.abi}; sequence ${verified.payload.sequence}`)
}
