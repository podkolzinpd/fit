import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

const publicRoot = new URL('../public/', import.meta.url)
const pages = ['for-trainers', 'for-athletes']
const analytics = await readFile(new URL('for-trainers/analytics.js', publicRoot), 'utf8')
const motion = await readFile(new URL('for-trainers/landing.js', publicRoot), 'utf8')

test('each audience has distinct indexable HTML without requiring JavaScript', async () => {
  const titles = new Set()
  const descriptions = new Set()
  for (const page of pages) {
    const html = await readFile(new URL(`${page}/index.html`, publicRoot), 'utf8')
    assert.match(html, new RegExp(`<link rel="canonical" href="https://fit-training.ru/${page}/">`))
    assert.match(html, /<meta name="robots" content="index,follow">/)
    assert.equal([...html.matchAll(/<h1\b/g)].length, 1)
    assert.doesNotMatch(html, /<template\b/)
    assert.equal([...html.matchAll(/<details>/g)].length, 3)
    const role = page === 'for-athletes' ? 'athlete' : 'trainer'
    assert.match(html, new RegExp(`<body[^>]*data-audience="${role}"`))
    assert.match(html, new RegExp(`data-audience="${role}" aria-current="page"`))
    for (const other of pages) assert.ok(html.includes(`href="/${other}/#top"`))
    titles.add(html.match(/<title>(.*?)<\/title>/)[1])
    descriptions.add(html.match(/<meta name="description" content="([^"]+)"/)[1])
    const schema = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1])
    assert.equal(schema.url, `https://fit-training.ru/${page}/`)
    if (role === 'athlete') {
      assert.match(html, /дневник тренировок/)
      assert.match(html, /data-screen="technique"/)
      assert.match(html, /athlete-home.webp/)
      assert.doesNotMatch(html, /data-placement="trainer-page"|motion-schedule-day.webp/)
    }
  }
  assert.equal(titles.size, 2)
  assert.equal(descriptions.size, 2)
})

test('both static pages resolve all media, scripts and styles to existing public files', async () => {
  for (const page of pages) {
    const html = await readFile(new URL(`${page}/index.html`, publicRoot), 'utf8')
    for (const [, path] of html.matchAll(/(?:src|href|poster)="([^"#?]+)"/g)) {
      if (!path.startsWith('/') || path.startsWith('//') || pages.some(p => path === `/${p}/`)) continue
      await access(new URL(path.slice(1), publicRoot))
    }
  }
  const sitemap = await readFile(new URL('sitemap.xml', publicRoot), 'utf8')
  for (const page of pages) assert.ok(sitemap.includes(`<loc>https://fit-training.ru/${page}/</loc>`))
})

test('old audience links redirect within the same site and preserve campaign, motion and fragment', () => {
  for (const [current, requested, destination] of [['trainer','athlete','for-athletes'], ['athlete','trainer','for-trainers']]) {
    let redirected
    runInNewContext(motion, {
      document: { documentElement: {}, body: { dataset: { audience: current } } },
      location: { origin: 'https://fit-training.ru', search: `?audience=${requested}&motion=off&utm_source=partner`, hash: '#top', replace: value => { redirected = value } },
      URL, URLSearchParams,
    })
    const url = new URL(redirected)
    assert.equal(url.origin, 'https://fit-training.ru')
    assert.equal(url.pathname, `/${destination}/`)
    assert.equal(url.searchParams.has('audience'), false)
    assert.equal(url.searchParams.get('motion'), 'off')
    assert.equal(url.searchParams.get('utm_source'), 'partner')
    assert.equal(url.hash, '#top')
  }
})

function collectAnalytics(pathname, { hostname='fit-training.ru', protocol='https:', search='' } = {}) {
  const calls = [], scripts = [], listeners = new Map()
  const context = {
    window: { location: { hostname, protocol, pathname, search, origin: `${protocol}//${hostname}` }, ym: (...args) => calls.push(args) },
    document: { referrer: 'https://example.org/private/path?token=secret', createElement: () => ({}), head: { appendChild: script => scripts.push(script) }, addEventListener: (name, callback) => listeners.set(name, callback) },
    URL, URLSearchParams, Element: class {},
  }
  runInNewContext(analytics, context)
  return { calls, scripts, listeners, context }
}

test('each public audience page initializes only the owner counter with a clean URL', () => {
  for (const page of pages) {
    for (const ending of ['/', '', '/index.html']) {
      const { calls, scripts } = collectAnalytics(`/${page}${ending}`, { search:'?token=secret&utm_source=partner' })
      assert.equal(calls.length, 1)
      assert.equal(calls[0][0], 114123380)
      assert.equal(calls[0][1], 'init')
      assert.equal(calls[0][2].url, `https://fit-training.ru/${page}`)
      assert.equal(calls[0][2].referrer, 'https://example.org/')
      assert.equal(calls[0][2].webvisor, false)
      assert.equal(scripts.length, 1)
    }
  }
})

test('preview, unrelated routes and legacy redirect entries do not initialize acquisition analytics', () => {
  for (const [path, options] of [
    ['/for-athletes/', { hostname:'localhost' }],
    ['/for-athletes/', { hostname:'preview.example.org' }],
    ['/for-athletes/', { protocol:'http:' }],
    ['/me', {}], ['/for-athletes/private', {}],
    ['/for-trainers/', { search:'?audience=athlete' }],
    ['/for-athletes/', { search:'?audience=trainer' }],
  ]) assert.equal(collectAnalytics(path, options).calls.length, 0)
})

test('snippet exclusions contain only the startup UI and preserve its established controller contract', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8')
  const excluded = html.match(/<!--noindex-->(.*?)<!--\/noindex-->/s)?.[1]
  assert.ok(excluded)
  assert.match(excluded, /<div id="fit-startup-shell"[^>]+data-nosnippet>/)
  assert.match(excluded, /id="fit-startup-title"/)
  assert.doesNotMatch(excluded, /id="root"|id="fit-app-entry"/)
  assert.ok(html.includes('<title>ФИТ — приложение для тренеров и спортсменов</title>'))
  assert.ok(html.includes('<meta name="description"'))
})
