import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('original coach reference exports', () => {
  it('preserves the original SVG bytes and root geometry for every reference slot', () => {
    const folder = resolve('docs/design/figma-20261008')
    const spec = JSON.parse(readFileSync(resolve(folder, 'source-context.json'), 'utf8')) as {
      assets: Array<{ file: string; width: number; height: number; sha256: string }>
    }
    expect(spec.assets).toHaveLength(6)
    for (const asset of spec.assets) {
      const bytes = readFileSync(resolve(folder, asset.file))
      expect(bytes.byteLength).toBeGreaterThan(0)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256)
      const svg = new DOMParser().parseFromString(bytes.toString('utf8'), 'image/svg+xml').documentElement
      expect(svg.nodeName).toBe('svg')
      expect(Number(svg.getAttribute('width'))).toBe(asset.width)
      expect(Number(svg.getAttribute('height'))).toBe(asset.height)
    }
  })
})
