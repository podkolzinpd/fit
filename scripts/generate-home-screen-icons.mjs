import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'
import { PNG } from 'pngjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = resolve(root, 'assets/home-screen-logo.png')
const source = PNG.sync.read(await readFile(sourcePath))
const lime = Array.from(source.data.subarray(0, 3))

if (source.width !== 1024 || source.height !== 1024 || source.data[3] !== 255) {
  throw new Error('Home-screen logo source must be an opaque 1024×1024 PNG')
}

// The supplied image has a one-pixel gray export artifact along its bottom edge.
// Correct only that edge; keep the supplied symbol, gradient and lime background intact.
for (let x = 0; x < source.width; x += 1) {
  const offset = ((source.height - 1) * source.width + x) * 4
  source.data.set([...lime, 255], offset)
}

const encoded = PNG.sync.write(source).toString('base64')
const assets = [
  { path: 'public/apple-touch-icon-b4.png', size: 180, scale: 1 },
  { path: 'public/home-icon-b4-192.png', size: 192, scale: 1 },
  { path: 'public/home-icon-b4-512.png', size: 512, scale: 1 },
  { path: 'public/home-icon-maskable-b4-192.png', size: 192, scale: 1 },
  { path: 'public/home-icon-maskable-b4-512.png', size: 512, scale: 1 },
]

const browser = await chromium.launch({ headless: true })

try {
  for (const asset of assets) {
    const page = await browser.newPage({
      deviceScaleFactor: 1,
      viewport: { width: asset.size, height: asset.size },
    })
    await page.setContent(`
      <style>
        html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: rgb(${lime.join(',')}); }
        img { position: absolute; top: 50%; left: 50%; display: block; width: ${asset.scale * 100}%; height: auto; transform: translate(-50%, -50%); }
      </style>
      <img src="data:image/png;base64,${encoded}" alt="">
    `)
    await page.locator('img').evaluate((image) => image.decode())
    await page.screenshot({ path: resolve(root, asset.path) })
    await page.close()
  }
} finally {
  await browser.close()
}
