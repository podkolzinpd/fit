import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { limeFonts, prepareFitLimeFonts } from './prepare-fit-lime-fonts.mjs'
import { setTimeout as delay } from 'node:timers/promises'
import { prepareFitLimePublishedFonts } from './prepare-fit-lime-published-fonts.mjs'

async function downloadFont(font, fetchAsset, wait) {
  const url = `https://fit-training.ru/fonts/${font.name}`
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetchAsset(url, {
        redirect: 'error', signal: AbortSignal.timeout(30000),
      })
      if (!response.ok) {
        if (attempt < 2 && (response.status === 429 || response.status >= 500)) {
          await wait((attempt + 1) * 1000)
          continue
        }
        throw new Error(`Fit Lime font download failed: ${font.name} (${response.status})`)
      }
      return { font, data: Buffer.from(await response.arrayBuffer()) }
    } catch (error) {
      if (attempt === 2 || !['TimeoutError', 'TypeError'].includes(error?.name)) throw error
      await wait((attempt + 1) * 1000)
    }
  }
}

// PR jobs have no production credentials. Use only already-public immutable
// web assets, then the same WOFF2/SHA256 validator used by the official build.
export async function prepareFitLimeCiFonts({ directory = 'public/fonts', fetchAsset = fetch, wait = delay } = {}) {
  const files = await Promise.all(limeFonts.map(font => downloadFont(font, fetchAsset, wait)))
  const env = { FIT_LIME_FONTS_REQUIRED: 'true' }
  for (const { font, data } of files) env[font.env + '_PART1'] = data.toString('base64')
  return prepareFitLimeFonts({ directory, env })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let names
  try { names = await prepareFitLimeCiFonts() }
  catch (error) {
    // A network outage is not permission to use fallback bytes. The exact
    // immutable hashes must still match a completed official public release.
    if (!['TimeoutError', 'TypeError'].includes(error?.name)
      && !/font download failed:.*\((429|5\d\d)\)/.test(error?.message ?? '')) throw error
    names = prepareFitLimePublishedFonts()
  }
  console.log(`Verified public Fit Lime webfonts: ${names.length}/${limeFonts.length}`)
}
