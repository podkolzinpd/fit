import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const limeFonts = [
  { name: 'ys-geo-regular-916b7f4a.woff2', env: 'FIT_LIME_YS_GEO_REGULAR_BASE64', sha256: '916b7f4a2338c18c8feee66d249b5f12084a7fd58b71b6525fc7888da3b29685' },
  { name: 'ys-geo-medium-5d6c61ef.woff2', env: 'FIT_LIME_YS_GEO_MEDIUM_BASE64', sha256: '5d6c61ef6b322e4a75cbcb44e11f2a41c272aa1d06f4f986818fb80f46d995ca' },
]

export function prepareFitLimeFonts({ directory = 'public/fonts', env = process.env } = {}) {
  const required = env.FIT_LIME_FONTS_REQUIRED === 'true'
  const prepared = []
  for (const font of limeFonts) {
    const path = resolve(directory, font.name)
    const encoded = [env[font.env + '_PART1'], env[font.env + '_PART2']].filter(Boolean).join('')
    const data = encoded ? Buffer.from(encoded, 'base64')
      : existsSync(path) ? readFileSync(path) : null
    if (!data) {
      if (required) throw new Error('Required licensed Fit Lime webfont is missing: ' + font.name)
      continue
    }
    if (data.subarray(0, 4).toString() !== 'wOF2'
      || createHash('sha256').update(data).digest('hex') !== font.sha256) {
      throw new Error('Fit Lime webfont checksum mismatch: ' + font.name)
    }
    mkdirSync(directory, { recursive: true })
    writeFileSync(path, data)
    prepared.push(font.name)
  }
  return prepared
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const names = prepareFitLimeFonts()
  console.log('Verified Fit Lime webfonts: ' + names.length + '/' + limeFonts.length)
}
