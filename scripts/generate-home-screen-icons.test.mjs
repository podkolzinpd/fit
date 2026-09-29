import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { PNG } from 'pngjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pixel = (image, x, y) => {
  const offset = (y * image.width + x) * 4
  return Array.from(image.data.subarray(offset, offset + 4))
}

test('only home-screen references point to the new logo', async () => {
  const html = await readFile(resolve(root, 'index.html'), 'utf8')
  const manifest = JSON.parse(await readFile(resolve(root, 'public/site.webmanifest'), 'utf8'))
  const appLogo = await readFile(resolve(root, 'src/shared/FitLogo.tsx'), 'utf8')

  assert.match(html, /apple-touch-icon-b4\.png/)
  assert.match(html, /site\.webmanifest\?v=4/)
  assert.match(html, /rel="icon" href="\/favicon\.svg"/)
  assert.match(appLogo, /src="\/fit-logo\.svg"/)
  assert.deepEqual(manifest.icons.map((icon) => icon.src), [
    '/home-icon-b4-192.png',
    '/home-icon-b4-512.png',
    '/home-icon-maskable-b4-192.png',
    '/home-icon-maskable-b4-512.png',
  ])
})

test('home-screen icons preserve the bright lime and purple mark at every size', async () => {
  for (const [path, size, maskable] of [
    ['public/apple-touch-icon-b4.png', 180, false],
    ['public/home-icon-b4-192.png', 192, false],
    ['public/home-icon-b4-512.png', 512, false],
    ['public/home-icon-maskable-b4-192.png', 192, true],
    ['public/home-icon-maskable-b4-512.png', 512, true],
  ]) {
    const image = PNG.sync.read(await readFile(resolve(root, path)))
    assert.equal(image.width, size)
    assert.equal(image.height, size)
    assert.deepEqual(pixel(image, 0, 0), [209, 253, 45, 255])
    assert.deepEqual(pixel(image, size - 1, size - 1), [209, 253, 45, 255])
    const center = pixel(image, Math.floor(size / 2), Math.floor(size / 2))
    assert.ok(center[2] > 220 && center[1] < 130, `${path}: purple mark faded`)
    const sample = pixel(image, Math.floor(size * 0.5), Math.floor(size * 0.1))
    assert.deepEqual(sample, [209, 253, 45, 255])
    if (maskable) {
      assert.deepEqual(pixel(image, Math.floor(size * 0.1), Math.floor(size * 0.5)), [209, 253, 45, 255])
      let maxSymbolRadius = 0
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const color = pixel(image, x, y)
          if (color[2] > 220 && color[1] < 150) {
            maxSymbolRadius = Math.max(maxSymbolRadius, Math.hypot(
              (x + 0.5) / size - 0.5,
              (y + 0.5) / size - 0.5,
            ))
          }
        }
      }
      assert.ok(maxSymbolRadius <= 0.4, `${path}: symbol exceeds the maskable safe circle`)
    }
  }
})
