import { z } from 'zod'

export interface AndroidOtaPolicy {
  enabled: boolean
  abi: string
  publicKey: string
  appId: string
  origin: string
  channel: string
}
const hex = z.string().regex(/^[a-f0-9]{64}$/)
const base64 = z.string().min(4).max(24000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
const releaseSchema = z.object({
  bundleId: hex,
  checksum: hex,
  signature: base64.max(1024),
  url: z.string().max(512),
  minNativeBuild: z.number().int().positive(),
  maxNativeBuild: z.number().int().positive(),
}).strict()
const manifestSchema = z.object({
  schema: z.literal(1), sourceCommit: z.string().regex(/^[a-f0-9]{40}$/), appId: z.string(), platform: z.literal('android'),
  abi: hex, channel: z.string(), sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  issuedAt: z.number().int().nonnegative(), expiresAt: z.number().int().positive(),
  release: releaseSchema.nullable(),
}).strict()
export type AndroidOtaManifest = z.infer<typeof manifestSchema>
export const manifestLimit = 32768
function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), c => c.charCodeAt(0))
}
export async function verifyAndroidOtaManifest(envelope: unknown, policy: AndroidOtaPolicy, nativeBuild: number,
  now = Date.now(), cryptoApi: Crypto = crypto): Promise<AndroidOtaManifest> {
  const signed = z.object({ payload: base64, signature: base64.max(1024) }).strict().parse(envelope)
  const keyData = policy.publicKey.replace(/-----[^-]+-----|\s/g, '')
  const key = await cryptoApi.subtle.importKey('spki', decode(keyData), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  const bytes = decode(signed.payload)
  if (!await cryptoApi.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(signed.signature), bytes)) throw new Error('OTA_MANIFEST_SIGNATURE')
  const manifest = manifestSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
  if (manifest.appId !== policy.appId || manifest.abi !== policy.abi || manifest.channel !== policy.channel) throw new Error('OTA_INCOMPATIBLE')
  if (manifest.issuedAt > now + 300000 || manifest.expiresAt <= now || manifest.expiresAt <= manifest.issuedAt
    || manifest.expiresAt - manifest.issuedAt > 30 * 86400000) throw new Error('OTA_EXPIRED')
  if (manifest.release) {
    const release = manifest.release
    const expectedUrl = `${policy.origin}/mobile-updates/android/bundles/${release.checksum}.zip`
    if (release.url !== expectedUrl || release.bundleId !== release.checksum || !Number.isSafeInteger(nativeBuild)
      || nativeBuild < release.minNativeBuild || nativeBuild > release.maxNativeBuild) throw new Error('OTA_INCOMPATIBLE')
  }
  return manifest
}

export async function readAndroidOtaEnvelope(response: Response): Promise<unknown> {
  if (!response.ok || !response.body) throw new Error('OTA_UNAVAILABLE')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.length
      if (length > manifestLimit) throw new Error('OTA_MANIFEST_SIZE')
      chunks.push(value)
    }
  } finally { await reader.cancel() }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
}
