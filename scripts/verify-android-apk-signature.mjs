import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function verifyAndroidApkCertificate(report, expected) {
  if (!/^[a-f0-9]{64}$/i.test(expected)) throw new Error('Invalid expected APK certificate')
  // Build Tools report either "Signer #1" or "V3.0 Signer". The certificate
  // fingerprint is the contract; the display label and public-key hash are not.
  const certificates = [...report.matchAll(/certificate SHA-256 digest: ([a-f0-9]{64})\s*$/gim)]
    .map(match => match[1].toLowerCase())
  if (!certificates.length || certificates.some(hash => hash !== expected.toLowerCase())) {
    throw new Error('APK signing certificate does not match the released app')
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [report, expected] = process.argv.slice(2)
  if (!report || !expected) throw new Error('Usage: verify-android-apk-signature.mjs REPORT EXPECTED_SHA256')
  verifyAndroidApkCertificate(readFileSync(report, 'utf8'), expected)
  console.log('APK certificate matches the released app')
}
