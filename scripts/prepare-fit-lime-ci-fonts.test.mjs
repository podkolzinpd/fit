import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareFitLimeCiFonts } from './prepare-fit-lime-ci-fonts.mjs'

test('failed public downloads cannot silently produce a fontless acceptance build', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fit-ci-font-http-'))
  try {
    await assert.rejects(prepareFitLimeCiFonts({ directory, fetchAsset: async () => new Response('', { status: 503 }) }), /download failed/)
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
