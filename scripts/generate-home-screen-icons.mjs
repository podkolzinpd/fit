import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
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
const icons = new Map()
await mkdir(resolve(root, 'public/assets'), { recursive: true })

const browser = await chromium.launch({ headless: true })

try {
  for (const size of [180, 192, 512]) {
    const page = await browser.newPage({
      deviceScaleFactor: 1,
      viewport: { width: size, height: size },
    })
    await page.setContent(`
      <style>
        html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: rgb(${lime.join(',')}); }
        img { position: absolute; top: 50%; left: 50%; display: block; width: 100%; height: auto; transform: translate(-50%, -50%); }
      </style>
      <img src="data:image/png;base64,${encoded}" alt="">
    `)
    await page.locator('img').evaluate((image) => image.decode())
    const bytes = await page.screenshot()
    // Use the existing hashed-asset hosting contract: cacheable, retained across
    // releases, and a new URL whenever the approved artwork changes.
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12)
    const path = `/assets/home-icon-${size}-${hash}.png`
    await writeFile(resolve(root, `public${path}`), bytes)
    icons.set(size, path)
    if (size === 180) {
      for (const alias of ['apple-touch-icon.png', 'apple-touch-icon-precomposed.png', 'apple-touch-icon-180x180.png']) {
        await writeFile(resolve(root, 'public', alias), bytes)
      }
    }
    await page.close()
  }
} finally {
  await browser.close()
}

const htmlPath = resolve(root, 'index.html')
const html = await readFile(htmlPath, 'utf8')
await writeFile(htmlPath, html
  .replace(/    <link rel="preload"[^>]*data-home-screen-icon[^>]*>\n/g, '')
  .replace(/<link rel="apple-touch-icon"[^>]*>/,
    `<link rel="apple-touch-icon" href="${icons.get(180)}" sizes="180x180" />\n    <link rel="preload" as="image" href="${icons.get(180)}" data-home-screen-icon />`)
  .replace(/site\.webmanifest\?v=\d+/, 'site.webmanifest?v=5'))
const manifestPath = resolve(root, 'public/site.webmanifest')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
for (const icon of manifest.icons) icon.src = icons.get(Number(icon.sizes.split('x')[0]))
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
