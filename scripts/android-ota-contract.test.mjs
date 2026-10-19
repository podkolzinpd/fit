import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, verify } from 'node:crypto'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { androidOtaPolicy } from './android-ota-contract.mjs'
import { signAndroidOtaManifest } from './package-android-ota.mjs'

test('OTA is default-off; ABI is stable across generated sync outputs but changes for a native source', () => {
  const root = mkdtempSync(join(tmpdir(), 'fit-ota-abi-'))
  try {
    mkdirSync(join(root, 'android/app/src/main/assets'), { recursive: true }); mkdirSync(join(root, 'config'))
    writeFileSync(join(root, 'config/android-ota-public-key.pem'), readFileSync(new URL('../config/android-ota-public-key.pem', import.meta.url)))
    writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/@capacitor/core': { version: '8.4.2', integrity: 'locked' } } }))
    writeFileSync(join(root, 'capacitor.config.ts'), 'native config'); writeFileSync(join(root, 'android/native.java'), 'original')
    const initial = androidOtaPolicy(root, {})
    assert.equal(initial.enabled, false); assert.equal(androidOtaPolicy(root, { FIT_ANDROID_OTA_ENABLED: 'true' }).enabled, true)
    mkdirSync(join(root, 'android/app/src/main/res/xml'), { recursive: true })
    writeFileSync(join(root, 'android/app/src/main/res/xml/config.xml'), 'generated config')
    writeFileSync(join(root, 'android/local.properties'), 'machine specific'); writeFileSync(join(root, 'android/app/src/main/assets/capacitor.config.json'), 'generated')
    assert.equal(androidOtaPolicy(root, {}).abi, initial.abi)
    writeFileSync(join(root, 'android/native.java'), 'changed'); assert.notEqual(androidOtaPolicy(root, {}).abi, initial.abi)
    writeFileSync(join(root, 'android/native.java'), 'original')
    writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/@capacitor/core': { version: '8.5.0', integrity: 'changed' } } }))
    assert.notEqual(androidOtaPolicy(root, {}).abi, initial.abi)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('publisher signs the exact JSON bytes using standard RSA-SHA256, not a checksum string', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const envelope = signAndroidOtaManifest({ sequence: 7, release: null }, privateKey)
  const payload = Buffer.from(envelope.payload, 'base64')
  assert.equal(verify('sha256', payload, publicKey, Buffer.from(envelope.signature, 'base64')), true)
  assert.equal(verify('sha256', Buffer.from('{"sequence":8}'), publicKey, Buffer.from(envelope.signature, 'base64')), false)
})
