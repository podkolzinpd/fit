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
    assert.equal([...html.matchAll(/<details>/g)].length, 4)
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
      assert.match(html, /data-screen="trainer"/)
      assert.match(html, /Можно ли найти тренера в ФИТ/)
      assert.equal([...html.matchAll(/data-copy=/g)].length, 5)
      assert.equal([...html.matchAll(/data-step=/g)].length, 5)
      assert.match(html, /athlete-trainer-search.png/)
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

const appHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8')
const appMetrika = appHtml.split('<!-- Yandex.Metrika counter -->')[1].match(/<script[^>]*>(.*?)<\/script>/s)[1]

function collectAppMetrika({ hostname='fit-training.ru', protocol='https:', pathname='/me', search='', existingScripts=[] } = {}) {
  const scripts = existingScripts.map(src => ({ src }))
  const inserted = []
  const parentNode = { insertBefore: script => { scripts.push(script); inserted.push(script) } }
  const anchor = { src: '', parentNode }
  scripts.unshift(anchor)
  const window = { location: { hostname, protocol, pathname, href: `${protocol}//${hostname}${pathname}${search}`, origin: `${protocol}//${hostname}` } }
  Object.assign(window, {
    window,
    document: { scripts, referrer: 'https://example.org/?token=secret', createElement: () => ({}), getElementsByTagName: () => [anchor] },
    URL, URLSearchParams,
  })
  runInNewContext(appMetrika, window)
  return { scripts: inserted, calls: Array.from(window.ym?.a ?? [], args => Array.from(args)) }
}

test('every SSR application counter has its own matching loader, including the legacy counter', () => {
  for (const options of [{}, { hostname:'localhost', protocol:'capacitor:' }]) {
    const { scripts, calls } = collectAppMetrika(options)
    const loaderIds = scripts.map(script => Number(new URL(script.src).searchParams.get('id'))).sort()
    const initIds = calls.filter(call => call[1] === 'init').map(call => call[0]).sort()
    assert.deepEqual(initIds, [111074543, 113121193, 114123380])
    // An id-specific SSR tag ignores initialization of a different counter.
    // Presence of all IDs in HTML alone does not prove that they collect data.
    assert.deepEqual(loaderIds, initIds)
    for (const call of calls) assert.equal(call[2].ssr, true)
    const repeated = collectAppMetrika({ ...options, existingScripts:scripts.map(script => script.src) })
    assert.equal(repeated.scripts.length, 0)
  }
})

test('parallel app counters preserve privacy settings and excluded entry routes', () => {
  const { calls } = collectAppMetrika({ pathname:'/invite', search:'?token=secret&source=private&utm_source=partner' })
  const replay = calls.filter(call => call[2].webvisor).map(call => call[0])
  assert.deepEqual(replay, [111074543])
  const owner = calls.find(call => call[0] === 114123380)[2]
  assert.equal(owner.clickmap, false)
  assert.equal(owner.trackLinks, false)
  assert.equal(owner.url, 'https://fit-training.ru/invite?utm_source=partner')
  assert.equal(owner.referrer, 'https://example.org/')
  for (const call of calls) assert.doesNotMatch(call[2].url, /secret|private/)
  for (const options of [
    { hostname:'localhost' }, { hostname:'preview.example.org' },
    { pathname:'/corporate-invite' }, { pathname:'/CORPORATE-INVITE/' }, { pathname:'/%63orporate-invite//' },
  ]) {
    const result = collectAppMetrika(options)
    assert.equal(result.scripts.length, 0)
    assert.equal(result.calls.length, 0)
  }
})
