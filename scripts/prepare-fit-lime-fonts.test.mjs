import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareFitLimeFonts, limeFonts } from './prepare-fit-lime-fonts.mjs'

test('untrusted/local builds may omit proprietary assets; production cannot', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fit-font-contract-'))
  try {
    assert.deepEqual(prepareFitLimeFonts({ directory, env: {} }), [])
    assert.throws(() => prepareFitLimeFonts({ directory, env: { FIT_LIME_FONTS_REQUIRED: 'true' } }), /missing/)
    assert.throws(() => prepareFitLimeFonts({ directory, env: { [limeFonts[0].env + '_PART1']: Buffer.from('not a font').toString('base64') } }), /checksum/)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
test('production build requires and injects both licensed assets before packaging', () => {
  const workflow = readFileSync('.github/workflows/deploy-yandex-frontend.yml', 'utf8')
  assert.match(workflow, /FIT_LIME_FONTS_REQUIRED: 'true'/)
  for (const font of limeFonts) assert.ok(workflow.includes('secrets.' + font.env))
})
