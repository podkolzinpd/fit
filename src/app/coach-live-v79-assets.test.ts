import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { z } from 'zod'

it('ships the five original designer resources without redrawing or changing bytes', () => {
  const directory = resolve(process.cwd(), 'src/assets/coach-live-v79')
  const manifest = z.object({ files: z.array(z.object({
    file: z.string(), sourceFile: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })) }).parse(JSON.parse(readFileSync(resolve(directory, 'provenance.json'), 'utf8')))
  expect(manifest.files.map(file => file.file).sort()).toEqual([
    'card-collapse.svg', 'card-expand.svg', 'glow-inner.png', 'glow-middle.svg', 'glow-outer.svg',
  ])
  for (const item of manifest.files) {
    expect(item.sourceFile.startsWith('public/assets/')).toBe(true)
    const bytes = readFileSync(resolve(directory, item.file))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(item.sha256)
  }
})
