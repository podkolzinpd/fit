import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'
import { PNG } from 'pngjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = await readFile(resolve(root, 'public/fit-logo.svg'), 'utf8')

const appBackground = '#FBFAF7'
const primaryScale = 0.92
const maskableScale = 0.70
const opticalHeightScale = 1.12
const opticalStrokeWidth = 1.8

const assets = [
  { path: 'public/favicon-32x32.png', size: 32, scale: primaryScale },
  {
    path: 'public/apple-touch-icon-b3.png',
    size: 180,
    scale: primaryScale,
    hardEdge: true,
  },
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

for (const [density, multiplier] of Object.entries({ mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 })) {
  const directory = `android/app/src/main/res/mipmap-${density}`
  for (const name of ['ic_launcher', 'ic_launcher_round']) {
    assets.push({ path: `${directory}/${name}.png`, size: 48 * multiplier, scale: primaryScale })
  }
  assets.push({
    path: `${directory}/ic_launcher_foreground.png`,
    size: 108 * multiplier,
    scale: 0.60,
    transparent: true,
  })
}

for (const directory of (await readdir(resolve(root, 'android/app/src/main/res'))).filter((name) => name === 'drawable' || name.startsWith('drawable-'))) {
  const path = `android/app/src/main/res/${directory}/splash.png`
  try {
    const image = PNG.sync.read(await readFile(resolve(root, path)))
    assets.push({ path, width: image.width, height: image.height, size: Math.min(image.width, image.height), scale: 0.70 })
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

async function hardenIconEdges(path, foreground) {
  const image = PNG.sync.read(await readFile(path))
  const background = [251, 250, 247]
  const mark = foreground === '#FFFFFF' ? [255, 255, 255] : [0, 0, 0]

  for (let offset = 0; offset < image.data.length; offset += 4) {
    const darkness = background.reduce(
      (sum, channel, index) => sum + (channel - image.data[offset + index]) / channel,
      0,
    ) / background.length
    const color = darkness >= 0.35 ? mark : background

    image.data[offset] = color[0]
    image.data[offset + 1] = color[1]
    image.data[offset + 2] = color[2]
    image.data[offset + 3] = 255
  }

  await writeFile(path, PNG.sync.write(image, { colorType: 2 }))
}

const browser = await chromium.launch({ headless: true })

try {
  for (const asset of assets) {
    const page = await browser.newPage({
      deviceScaleFactor: 1,
      viewport: { width: asset.width ?? asset.size, height: asset.height ?? asset.size },
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
          width: ${asset.scale * asset.size}px;
          height: auto;
          transform: translate(-50%, -50%) scaleY(${opticalHeightScale});
        }
      </style>
      <img src="data:image/svg+xml;base64,${encodedLogo}" alt="">
    `)
    await page.locator('img').evaluate((image) => image.decode())
    const outputPath = resolve(root, asset.path)
    await page.screenshot({
      path: outputPath,
      omitBackground: asset.transparent === true,
    })
    await page.close()

    if (asset.hardEdge === true) {
      await hardenIconEdges(outputPath, foreground)
    }
  }
} finally {
  await browser.close()
}
