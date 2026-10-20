import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { mkdir, readFile, writeFile, mkdtemp, rm, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { androidOtaPolicy } from './android-ota-contract.mjs'
import { packageRelease, supportedRouting } from './frontend-release.mjs'

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
export function signAndroidOtaManifest(payload, privateKey) {
  const bytes = Buffer.from(JSON.stringify(payload))
  return { payload: bytes.toString('base64'), signature: sign('sha256', bytes, privateKey).toString('base64') }
}
export async function packageAndroidOta({ directory, output, privateKeyPath, commit, sequence = Date.now(), now = Date.now(), reset = false }) {
  if (!/^[a-f0-9]{40}$/.test(commit) || !Number.isSafeInteger(sequence) || sequence <= 0) throw new Error('Invalid OTA release identity')
  const destination = resolve(output)
  const source = resolve(directory)
  if (destination === source || destination.startsWith(source + '/')) throw new Error('OTA output must be outside the build')
  const policy = androidOtaPolicy()
  if ((await stat(privateKeyPath)).mode & 0o077) throw new Error('OTA private key must have mode 0600')
  const privateKey = createPrivateKey(await readFile(privateKeyPath))
  const publicKey = createPublicKey(privateKey).export({ format: 'pem', type: 'spki' }).toString()
  if (publicKey !== policy.publicKey) throw new Error('OTA signing key does not match the native trust root')
  const marker = JSON.parse(await readFile(resolve(directory, 'android-ota-build.json'), 'utf8'))
  if (marker.abi !== policy.abi || marker.enabled !== true || marker.sourceCommit !== commit
      || marker.apiBaseUrl !== 'https://api.fit-training.ru') throw new Error('OTA requires the matching enabled native build and Cloud.ru API')
  const buildGradle = await readFile(new URL('../android/app/build.gradle', import.meta.url), 'utf8')
  const nativeBuild = Number(buildGradle.match(/\bversionCode (\d+)/)?.[1])
  if (!Number.isSafeInteger(nativeBuild) || nativeBuild < 4) throw new Error('Invalid OTA native build')
  const release = await packageRelease(directory, commit, supportedRouting)
  if (release.files.reduce((total, file) => total + file.size, 0) > 100 * 1024 * 1024) throw new Error('OTA release is too large')
  await mkdir(resolve(output), { recursive: false })
  const temporary = await mkdtemp(resolve(tmpdir(), 'fit-ota-package-'))
  let update = null
  try {
    if (!reset) {
      for (const file of release.files) {
        const path = resolve(temporary, file.key)
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, Buffer.from(file.content, 'base64'), { flag: 'wx' })
      }
      const zipPath = resolve(output, 'bundle.zip')
      execFileSync('zip', ['-q', '-r', zipPath, '.'], { cwd: temporary })
      const bytes = await readFile(zipPath)
      const checksum = sha256(bytes)
      const signature = sign('sha256', bytes, privateKey).toString('base64')
      if (!verify('sha256', bytes, policy.publicKey, Buffer.from(signature, 'base64'))) throw new Error('OTA signature readback failed')
      const target = resolve(output, `android/bundles/${checksum}.zip`)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, bytes, { flag: 'wx' })
      await rm(zipPath)
      update = { bundleId: checksum, checksum, signature, url: `${policy.origin}/mobile-updates/android/bundles/${checksum}.zip`,
        minNativeBuild: nativeBuild, maxNativeBuild: nativeBuild }
    }
    const payload = { schema: 1, appId: policy.appId, platform: 'android', abi: policy.abi, channel: policy.channel,
      sourceCommit: commit, sequence, issuedAt: now, expiresAt: now + 30 * 86400000, release: update }
    const manifest = resolve(output, `android/${policy.channel}/${policy.abi}/latest.json`)
    await mkdir(dirname(manifest), { recursive: true })
    await writeFile(manifest, JSON.stringify(signAndroidOtaManifest(payload, privateKey)) + '\n', { flag: 'wx' })
    await writeFile(resolve(output, 'provenance.json'), JSON.stringify({ commit, abi: policy.abi, nativeBuild, bundleId: update?.bundleId ?? null, sequence }) + '\n', { flag: 'wx' })
    return payload
  } finally { await rm(temporary, { recursive: true, force: true }) }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory, output, commit] = process.argv.slice(2)
  const privateKeyPath = process.env.FIT_ANDROID_OTA_PRIVATE_KEY_PATH
  if (!directory || !output || !commit || !privateKeyPath) throw new Error('Usage: FIT_ANDROID_OTA_PRIVATE_KEY_PATH=... node scripts/package-android-ota.mjs DIST NEW_OUTPUT SHA [--reset]')
  const result = await packageAndroidOta({ directory, output, commit, privateKeyPath, reset: process.argv.includes('--reset') })
  console.log(`Signed Android OTA sequence ${result.sequence}; native ABI ${result.abi}; offline artifact only, not published`)
}
