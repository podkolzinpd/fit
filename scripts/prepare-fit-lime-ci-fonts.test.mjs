import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareFitLimeCiFonts } from './prepare-fit-lime-ci-fonts.mjs'
import { publishedFontEnvironment, selectPublishedFrontendRun } from './prepare-fit-lime-published-fonts.mjs'
import { supportedRouting } from './frontend-release.mjs'
import { frontendFileMetadata } from './prepare-yandex-frontend.mjs'
import { createHash } from 'node:crypto'

test('failed public downloads cannot silently produce a fontless acceptance build', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fit-ci-font-http-'))
  try {
    let calls = 0
    await assert.rejects(prepareFitLimeCiFonts({ directory, wait: async () => {}, fetchAsset: async () => {
      calls++; return new Response('', { status: 503 })
    } }), /download failed/)
    assert.equal(calls, 6)
    assert.deepEqual(readdirSync(directory), [])
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('transient timeouts are retried at the same public URL with fresh deadlines; invalid bytes remain rejected', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fit-ci-font-retry-'))
  const calls = new Map()
  const signals = new Set()
  const waits = []
  try {
    await assert.rejects(prepareFitLimeCiFonts({ directory, wait: async ms => { waits.push(ms) }, fetchAsset: async (url, options) => {
      assert.ok(url.startsWith('https://fit-training.ru/fonts/ys-geo-'))
      assert.equal(options.redirect, 'error')
      signals.add(options.signal)
      const count = (calls.get(url) ?? 0) + 1
      calls.set(url, count)
      if (count === 1) throw new DOMException('network timeout', 'TimeoutError')
      return new Response('<html>not a font</html>')
    } }), /checksum mismatch/)
    assert.deepEqual([...calls.values()], [2, 2])
    assert.equal(signals.size, 4)
    assert.deepEqual(waits, [1000, 1000])
    assert.deepEqual(readdirSync(directory), [])
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('persistent network failures stop after three attempts per font and write nothing', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fit-ci-font-network-'))
  const calls = new Map()
  try {
    await assert.rejects(prepareFitLimeCiFonts({ directory, wait: async () => {}, fetchAsset: async url => {
      calls.set(url, (calls.get(url) ?? 0) + 1)
      throw new TypeError('network unavailable')
    } }), /network unavailable/)
    assert.deepEqual([...calls.values()], [3, 3])
    assert.deepEqual(readdirSync(directory), [])
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('permanent HTTP failures are not retried or replaced with fallback fonts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fit-ci-font-missing-'))
  let calls = 0
  try {
    await assert.rejects(prepareFitLimeCiFonts({ directory, wait: async () => { assert.fail('unexpected retry') }, fetchAsset: async () => {
      calls++; return new Response('', { status: 404 })
    } }), /download failed.*404/)
    assert.equal(calls, 2)
    assert.deepEqual(readdirSync(directory), [])
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
test('a successful SPA response at a font URL is rejected before any file is written', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fit-ci-font-spa-'))
  const calls = []
  try {
    await assert.rejects(prepareFitLimeCiFonts({ directory, fetchAsset: async (url, options) => {
      calls.push({ url, options }); return new Response('<!doctype html><html>Not a font</html>')
    } }), /checksum mismatch/)
    assert.equal(calls.length, 2)
    assert.ok(calls.every(({ url, options }) => url.startsWith('https://fit-training.ru/fonts/ys-geo-') && options.redirect === 'error'))
    assert.deepEqual(readdirSync(directory), [])
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

const sourceRun = { id: 123, path: '.github/workflows/deploy-yandex-frontend.yml', head_branch: 'main',
  head_repository: { full_name: 'podkolzinpd/fit' }, status: 'completed', conclusion: 'success', head_sha: 'a'.repeat(40) }
test('artifact font source accepts only a completed published official main release', () => {
  assert.equal(selectPublishedFrontendRun([sourceRun]), sourceRun)
  for (const changed of [{ conclusion: 'failure' }, { status: 'in_progress' }, { head_branch: 'feature' },
    { path: '.github/workflows/ci.yml' }, { head_repository: { full_name: 'other/fit' } }, { head_sha: 'invalid' }]) {
    assert.throws(() => selectPublishedFrontendRun([{ ...sourceRun, ...changed }]), /No verified published/)
  }
})

function fontRelease() {
  const sha = bytes => createHash('sha256').update(bytes).digest('hex')
  const font = { name: 'ys-geo-regular-916b7f4a.woff2', env: 'SYNTHETIC_TEST_FONT', sha256: sha('wOF2 fixture') }
  const files = ['index.html', 'sw.js', 'asset-recovery.js', 'site.webmanifest', `fonts/${font.name}`]
    .map(key => { const bytes = Buffer.from(key.startsWith('fonts/') ? 'wOF2 fixture' : 'fixture')
      return { key, ...frontendFileMetadata(key), size: bytes.length, sha256: sha(bytes), content: bytes.toString('base64') } })
  const bundle = { schemaVersion: 1, deployable: false, commit: sourceRun.head_sha, routing: supportedRouting, files }
  bundle.release = `${bundle.commit}-${sha(JSON.stringify({ routing: bundle.routing, files }))}`
  return { bundle, font }
}
test('published artifact is fully verified and only selected font bytes are exposed to the preparer', () => {
  const { bundle, font } = fontRelease()
  assert.deepEqual(publishedFontEnvironment(bundle, sourceRun.head_sha, [font]), {
    FIT_LIME_FONTS_REQUIRED: 'true', SYNTHETIC_TEST_FONT_PART1: Buffer.from('wOF2 fixture').toString('base64') })
  assert.throws(() => publishedFontEnvironment(bundle, sourceRun.head_sha), /Approved published font/)
  assert.throws(() => publishedFontEnvironment(bundle, 'b'.repeat(40), [font]), /commit mismatch/)
  assert.throws(() => publishedFontEnvironment(bundle, sourceRun.head_sha, [{ ...font, sha256: 'b'.repeat(64) }]), /Approved published font/)
  bundle.files[0].content = Buffer.from('changed').toString('base64')
  assert.throws(() => publishedFontEnvironment(bundle, sourceRun.head_sha, [font]), /checksum mismatch/)
})
