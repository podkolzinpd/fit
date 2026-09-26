import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { PNG } from 'pngjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

async function inspectPng(path, transparent = false) {
  const image = PNG.sync.read(await readFile(resolve(root, path)))
  const background = transparent ? [0, 0, 0, 0] : [251, 250, 247, 255]
  let minX = image.width
  let maxX = -1
  let minY = image.height
  let maxY = -1
  let hasPureBlack = false

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4
      const pixel = Array.from(image.data.subarray(offset, offset + 4))
      if (pixel.some((value, index) => value !== background[index])) {
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
        hasPureBlack ||= pixel[0] === 0 && pixel[1] === 0 && pixel[2] === 0 && pixel[3] === 255
      }
    }
  }

  return {
    background: Array.from(image.data.subarray(0, 4)),
    height: image.height,
    hasPureBlack,
    logoHeightRatio: (maxY - minY + 1) / image.height,
    logoWidthRatio: (maxX - minX + 1) / image.width,
    width: image.width,
  }
}

test('home-screen icons use the large centered Fit wordmark', async () => {
  for (const [path, size] of [
    ['public/apple-touch-icon-b2.png', 180],
    ['public/icon-192.png', 192],
    ['public/icon-512.png', 512],
    ['ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', 1024],
  ]) {
    const icon = await inspectPng(path)
    assert.equal(icon.width, size)
    assert.equal(icon.height, size)
    assert.deepEqual(icon.background, [251, 250, 247, 255])
    assert.equal(icon.hasPureBlack, true)
    assert.ok(icon.logoWidthRatio >= 0.918 && icon.logoWidthRatio <= 0.925)
    assert.ok(icon.logoHeightRatio >= 0.55 && icon.logoHeightRatio <= 0.57)
  }
})

test('alternate iOS icons keep the same large transparent wordmark', async () => {
  for (const path of [
    'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x-dark.png',
    'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x-tinted.png',
  ]) {
    const icon = await inspectPng(path, true)
    assert.deepEqual(icon.background, [0, 0, 0, 0])
    assert.ok(icon.logoWidthRatio >= 0.918 && icon.logoWidthRatio <= 0.925)
  }
})

test('maskable icons retain safe margins', async () => {
  for (const path of ['public/icon-maskable-192.png', 'public/icon-maskable-512.png']) {
    const icon = await inspectPng(path)
    assert.ok(icon.logoWidthRatio >= 0.697 && icon.logoWidthRatio <= 0.701)
  }
})
