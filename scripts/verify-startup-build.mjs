import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8')
const controllerIndex = html.indexOf('id="fit-startup-controller"')
const moduleIndex = html.search(/<script[^>]+type="module"[^>]*>/)
const stylesheetIndex = html.search(/<link[^>]+rel="stylesheet"[^>]*>/)

assert.notEqual(controllerIndex, -1, 'Production HTML must contain the startup controller')
assert.notEqual(moduleIndex, -1, 'Production HTML must contain the application module')
assert.notEqual(stylesheetIndex, -1, 'Production HTML must contain the application stylesheet')
assert.ok(
  controllerIndex < moduleIndex,
  'The startup controller must run before the application module',
)
assert.ok(
  controllerIndex < stylesheetIndex,
  'The startup controller must run before a blocking application stylesheet',
)

const photoPath = '/assets/startup-photo-983c93dc4df8.jpg'
const photo = readFileSync(new URL(`../dist${photoPath}`, import.meta.url))
assert.ok(photo.length < 160_000, 'Startup photograph must stay below 160 KB')
assert.equal(createHash('sha256').update(photo).digest('hex').slice(0, 12), '983c93dc4df8')
assert.ok(html.includes(`rel="preload" as="image" href="${photoPath}"`), 'Preload the same photograph used by React')
assert.match(html, /id="fit-startup-photo-styles"/, 'Photo styles must be available before application CSS')
assert.ok(html.includes(`src="${photoPath}"`), 'Static shell must use the supplied photograph')
const component = readFileSync(new URL('../src/shared/StartupSplash.tsx', import.meta.url), 'utf8')
assert.ok(component.includes(`src="${photoPath}"`), 'HTML and React must share one cached photograph')
const stylesheets = [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*>/g)]
assert.ok(stylesheets.length > 0)
for (const [link] of stylesheets) {
  assert.ok(link.includes('media="print"') && link.includes('data-fit-app-styles'),
    'Production CSS must not block the first photo paint; the startup controller applies it before revealing React')
  const href = link.match(/href="([^"]+)"/)?.[1]
  assert.ok(href && [...html.matchAll(/<link\b[^>]*\brel="preload"[^>]*>/g)]
    .some(([preload]) => preload.includes('as="style"') && preload.includes(`href="${href}"`)),
  'Nonblocking CSS must retain critical loading priority through a matching preload')
}
process.stdout.write('Startup controller precedes production module and stylesheet; shared photo verified.\n')
