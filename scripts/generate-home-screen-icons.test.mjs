import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { PNG } from 'pngjs'
import { createHash } from 'node:crypto'
import { frontendFileMetadata } from './prepare-yandex-frontend.mjs'
import { packageRelease, supportedRouting } from './frontend-release.mjs'
import { gatewayPlan } from './frontend-gateway-plan.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pixel = (image, x, y) => {
  const offset = (y * image.width + x) * 4
  return Array.from(image.data.subarray(offset, offset + 4))
}

test('only home-screen references point to the new logo', async () => {
  const html = await readFile(resolve(root, 'index.html'), 'utf8')
  const manifest = JSON.parse(await readFile(resolve(root, 'public/site.webmanifest'), 'utf8'))
  const appLogo = await readFile(resolve(root, 'src/shared/FitLogo.tsx'), 'utf8')

  const touchIcon = html.match(/rel="apple-touch-icon" href="([^"]+)"/)[1]
  assert.match(touchIcon, /^\/assets\/home-icon-180-[a-f0-9]{12}\.png$/)
  assert.ok(html.includes(`rel="preload" as="image" href="${touchIcon}"`))
  assert.match(html, /site\.webmanifest\?v=5/)
  assert.match(html, /rel="icon" href="\/favicon\.svg"/)
  assert.match(appLogo, /src="\/fit-logo\.svg"/)
  assert.deepEqual(manifest.icons.map(({ sizes, purpose }) => [sizes, purpose]), [
    ['192x192', 'any'], ['512x512', 'any'], ['192x192', 'maskable'], ['512x512', 'maskable'],
  ])
  for (const url of [touchIcon, ...manifest.icons.map((icon) => icon.src)]) {
    assert.match(url, /^\/assets\/home-icon-(180|192|512)-[a-f0-9]{12}\.png$/)
    const bytes = await readFile(resolve(root, `public${url}`))
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12)
    assert.ok(url.endsWith(`-${hash}.png`), 'icon URL must match its bytes')
    assert.equal(frontendFileMetadata(url.slice(1)).cacheControl, 'public, max-age=31536000, immutable')
  }
  const expected = await readFile(resolve(root, `public${touchIcon}`))
  for (const alias of ['apple-touch-icon.png', 'apple-touch-icon-precomposed.png', 'apple-touch-icon-180x180.png']) {
    assert.deepEqual(await readFile(resolve(root, 'public', alias)), expected, `${alias}: stale Apple fallback`)
  }
})

test('published GET and HEAD routes serve PNGs, with cacheable versioned icons and current Apple fallbacks', async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'fit-home-icon-delivery-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(resolve(directory, 'assets'))
  const html = await readFile(resolve(root, 'index.html'), 'utf8')
  const manifestBytes = await readFile(resolve(root, 'public/site.webmanifest'))
  const manifest = JSON.parse(manifestBytes)
  const touchIcon = html.match(/rel="apple-touch-icon" href="([^"]+)"/)[1]
  const aliases = ['apple-touch-icon.png', 'apple-touch-icon-precomposed.png', 'apple-touch-icon-180x180.png']
  const keys = [...new Set([touchIcon, ...manifest.icons.map((icon) => icon.src)].map((url) => url.slice(1))), ...aliases]
  for (const [key, bytes] of Object.entries({
    'index.html': html, 'site.webmanifest': manifestBytes, 'sw.js': '// fixture',
    'asset-recovery.js': '// fixture', 'assets/app-12345678.js': '// fixture',
  })) await writeFile(resolve(directory, key), bytes)
  for (const key of keys) await writeFile(resolve(directory, key), await readFile(resolve(root, 'public', key)))
  const bundle = await packageRelease(directory, 'a'.repeat(40), supportedRouting)
  const plan = gatewayPlan(bundle, [], { bucket: 'fit-icon-fixture', reader: 'a'.repeat(20) })
  for (const key of keys) {
    const file = plan.objects.find((item) => item.key === key)
    const route = plan.specification.paths[`/${key}`]
    assert.deepEqual(route.get, route.head)
    assert.equal(route.get['x-yc-apigateway-integration'].object, file.object)
    assert.equal(file.contentType, 'image/png')
    assert.equal(file.delivery, 'private-gateway')
    assert.equal(file.cacheControl, key.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-store')
    assert.ok(PNG.sync.read(Buffer.from(file.content, 'base64')).width >= 180)
  }
  for (const key of ['index.html', 'site.webmanifest']) {
    assert.equal(plan.objects.find((item) => item.key === key).cacheControl, 'no-store')
  }
})

test('home-screen icons preserve the bright lime and purple mark at every size', async () => {
  const html = await readFile(resolve(root, 'index.html'), 'utf8')
  const manifest = JSON.parse(await readFile(resolve(root, 'public/site.webmanifest'), 'utf8'))
  const touchIcon = html.match(/rel="apple-touch-icon" href="([^"]+)"/)[1]
  for (const [path, size, maskable] of [
    [`public${touchIcon}`, 180, false],
    ...manifest.icons.map(({ src, sizes, purpose }) => [`public${src}`, Number(sizes.split('x')[0]), purpose === 'maskable']),
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
