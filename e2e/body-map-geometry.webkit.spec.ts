import { expect, test } from '@playwright/test'

type Shape = { zone: string; index: number; path: string; cx: number; cy: number }

test('photo body-map contours stay inside the source image and specific zones remain clickable', async ({ page }) => {
  test.setTimeout(90_000)
  const forbidden: string[] = []
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || /functions|\/api\//.test(url.pathname)) {
      forbidden.push(url.pathname)
      return route.abort('blockedbyclient')
    }
    return route.continue()
  })
  let checkedAnchors = 0
  for (const variant of ['male', 'female'] as const) {
    for (const side of ['front', 'back'] as const) {
      await page.goto(`/e2e/fixtures/body-map.html?variant=${variant}&side=${side}`)
      await expect(page.locator('.body-progress-overlay')).toBeVisible()
      const shapes = JSON.parse((await page.locator('#body-map-test-shapes').textContent())!) as Shape[]
      const containment = await page.evaluate(async ({ shapes, variant }) => {
        const image = new Image()
        image.src = variant === 'male' ? '/illustrations/body-progress-athlete.png' : '/illustrations/body-progress-athlete-female.png'
        await image.decode()
        const width = 952, height = 1000
        const source = document.createElement('canvas')
        source.width = width
        source.height = height
        const sourceContext = source.getContext('2d')!
        sourceContext.drawImage(image, 0, 0, width, height)
        const pixels = sourceContext.getImageData(0, 0, width, height).data
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')!
        return shapes.map((shape) => {
          context.clearRect(0, 0, width, height)
          context.fill(new Path2D(shape.path))
          const fill = context.getImageData(0, 0, width, height).data
          let total = 0, inside = 0
          for (let i = 3; i < fill.length; i += 4) {
            if (fill[i]! <= 127) continue
            total += 1
            if (pixels[i]! > 127) inside += 1
          }
          return { zone: shape.zone, index: shape.index, total, ratio: inside / total }
        })
      }, { shapes, variant })
      for (const shape of containment) {
        expect(shape.total, `${variant}/${side}/${shape.zone}[${shape.index}] has an area`).toBeGreaterThan(0)
        expect(shape.ratio, `${variant}/${side}/${shape.zone}[${shape.index}] within PNG alpha`).toBeGreaterThanOrEqual(0.99)
      }
      for (const shape of shapes.filter(({ zone }) => !['arms', 'legs', 'back'].includes(zone))) {
        const broad = ['biceps', 'triceps', 'forearms'].includes(shape.zone) ? 'Руки'
          : ['quadriceps', 'hamstrings', 'calves', 'inner_thigh', 'outer_thigh'].includes(shape.zone) ? 'Ноги'
          : ['upper_back', 'lower_back'].includes(shape.zone) ? 'Спина' : null
        if (broad) {
          await page.locator('.body-progress-zone-picker > summary').click()
          await page.locator('.body-progress-zone-picker').getByRole('button', { name: new RegExp(`^${broad}\\.`) }).click()
          await page.locator('.body-progress-zone-picker > summary').click()
        }
        const overlay = page.locator('.body-progress-overlay')
        await overlay.scrollIntoViewIfNeeded()
        const point = await overlay.evaluate((element, shape) => {
          const point = new DOMPoint(shape.cx, shape.cy).matrixTransform((element as SVGGraphicsElement).getScreenCTM()!)
          return { x: point.x, y: point.y }
        }, shape)
        await page.mouse.click(point.x, point.y)
        await expect(page.locator(`svg [data-body-zone="${shape.zone}"]`), `${variant}/${side}/${shape.zone}[${shape.index}] pointer hit`)
          .toHaveAttribute('aria-pressed', 'true')
        checkedAnchors += 1
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
  }
  expect(checkedAnchors).toBe(64)
  expect(forbidden).toEqual([])
})
