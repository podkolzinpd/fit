import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = await readFile(resolve(root, 'public/fit-logo.svg'), 'utf8')

const appBackground = '#FBFAF7'
const primaryScale = 0.92
const maskableScale = 0.70
const opticalHeightScale = 1.12
const opticalStrokeWidth = 1.8

const assets = [
  { path: 'public/favicon-32x32.png', size: 32, scale: primaryScale },
  { path: 'public/apple-touch-icon-b2.png', size: 180, scale: primaryScale },
  { path: 'public/icon-192.png', size: 192, scale: primaryScale },
  { path: 'public/icon-512.png', size: 512, scale: primaryScale },
  { path: 'public/icon-maskable-192.png', size: 192, scale: maskableScale },
  { path: 'public/icon-maskable-512.png', size: 512, scale: maskableScale },
  {
    path: 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png',
    size: 1024,
    scale: primaryScale,
  },
  {
    path: 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x-dark.png',
    size: 1024,
    scale: primaryScale,
    foreground: '#FFFFFF',
    transparent: true,
  },
  {
    path: 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x-tinted.png',
    size: 1024,
    scale: primaryScale,
    foreground: '#FFFFFF',
    transparent: true,
  },
]

const browser = await chromium.launch({ headless: true })

try {
  for (const asset of assets) {
    const page = await browser.newPage({
      deviceScaleFactor: 1,
      viewport: { width: asset.size, height: asset.size },
    })
    const foreground = asset.foreground ?? '#000000'
    const logo = source.replaceAll(
      'fill="black"',
      `fill="${foreground}" stroke="${foreground}" stroke-width="${opticalStrokeWidth}" stroke-linejoin="round"`,
    )
    const encodedLogo = Buffer.from(logo).toString('base64')

    await page.setContent(`
      <style>
        html, body {
          width: 100%;
          height: 100%;
          margin: 0;
          overflow: hidden;
          background: ${asset.transparent ? 'transparent' : appBackground};
        }

        img {
          position: absolute;
          top: 50%;
          left: 50%;
          display: block;
          width: ${asset.scale * 100}%;
          height: auto;
          transform: translate(-50%, -50%) scaleY(${opticalHeightScale});
        }
      </style>
      <img src="data:image/svg+xml;base64,${encodedLogo}" alt="">
    `)
    await page.locator('img').evaluate((image) => image.decode())
    await page.screenshot({
      path: resolve(root, asset.path),
      omitBackground: asset.transparent === true,
    })
    await page.close()
  }
} finally {
  await browser.close()
}
