import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { matchRoutes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { COUNTER_IDS, sanitizeMetrikaUrl, trackAuthenticatedOpen, trackGoal, trackPageView } from './yandex-metrika'

afterEach(() => {
  delete window.ym
})

describe('Metrika counters', () => {
  it('initializes exactly the counters that receive events', () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
    const initList = html.match(/\[([\d,\s]+)\]\.forEach\(function \(id\) \{\s*ym\(id, 'init'/)?.[1] ?? ''

    expect(initList.split(',').map((id) => Number(id.trim()))).toEqual([...COUNTER_IDS])
    expect(html).toContain('id="fit-invitation-link-bootstrap"')
    expect(html).toContain("referrerPolicy.content = 'no-referrer'")
    expect(html).toContain('url: fitMetrikaSafeUrl(location.href)')
  })
})

describe('private corporate invitation entry', () => {
  const privatePaths = ['/corporate-invite', '/corporate-invite/', '/Corporate-Invite', '/%63orporate-invite', '/CORPORATE-invite///']
  it.each(privatePaths)('keeps router-supported secret entry %s out of analytics', (path) => {
    expect(matchRoutes([{ path: '/corporate-invite' }], path)).not.toBeNull()
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
    const script = html.match(/<!-- Yandex\.Metrika counter -->\s*<script[^>]*>([\s\S]*?)<\/script>/)?.[1]
    expect(script).toBeTruthy()
    const ym = vi.fn(), insertBefore = vi.fn()
    const location = new URL(`${path}#token=${'a'.repeat(43)}`, 'https://fit-training.ru')
    const document = { scripts: [], referrer: '', createElement: () => ({}), getElementsByTagName: () => [{ parentNode: { insertBefore } }] }
    runInNewContext(script!, { window: { location, ym }, document, location, ym, URL, URLSearchParams })
    expect(insertBefore).not.toHaveBeenCalled()
    expect(ym).not.toHaveBeenCalled()
    expect(sanitizeMetrikaUrl(`${path}?token=synthetic-secret&source=synthetic#token=synthetic-secret`)).toBe(path)
    const normalLocation = new URL('/today', location.origin)
    runInNewContext(script!, { window: { location: normalLocation, ym }, document: { ...document, referrer: location.href }, location: normalLocation, ym, URL, URLSearchParams })
    for (const id of COUNTER_IDS) expect(ym).toHaveBeenCalledWith(id, 'init', expect.objectContaining({ referrer: `${location.origin}${path}`, url: normalLocation.href }))
  })
  it('does not load analytics for a direct secret link while keeping normal counters', () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
    const script = html.match(/<!-- Yandex\.Metrika counter -->\s*<script[^>]*>([\s\S]*?)<\/script>/)?.[1]
    expect(script).toBeTruthy()
    for (const path of ['/today', `/corporate-invite#token=${'a'.repeat(43)}`]) {
      const ym = vi.fn(), insertBefore = vi.fn()
      const location = new URL(path, 'https://fit-training.ru')
      const document = {
        scripts: [], referrer: '',
        createElement: () => ({}),
        getElementsByTagName: () => [{ parentNode: { insertBefore } }],
      }
      runInNewContext(script!, { window: { location, ym }, document, location, ym, URL, URLSearchParams })
      if (location.pathname === '/corporate-invite') {
        expect(insertBefore).not.toHaveBeenCalled()
        expect(ym).not.toHaveBeenCalled()
      } else {
        expect(insertBefore).toHaveBeenCalledOnce()
        expect(ym).toHaveBeenCalledTimes(COUNTER_IDS.length)
        for (const id of COUNTER_IDS) expect(ym).toHaveBeenCalledWith(id, 'init', expect.objectContaining({ url: 'https://fit-training.ru/today', webvisor: true }))
      }
    }
  })
})

describe('trackPageView', () => {
  it('sends the hit to every counter', () => {
    const ym = vi.fn()
    window.ym = ym

    trackPageView('/today?view=compose')

    expect(ym.mock.calls).toEqual([
      [111074543, 'hit', '/today?view=compose'],
      [113121193, 'hit', '/today?view=compose'],
    ])
  })

  it('removes invitation credentials from analytics URLs', () => {
    const token = `ABCDEF123456.${'a'.repeat(64)}`
    expect(sanitizeMetrikaUrl(`/invite?token=${token}&source=yandex`)).toBe('/invite')
    expect(sanitizeMetrikaUrl(`/invite#token=${token}&source=yandex`)).toBe('/invite')
    expect(sanitizeMetrikaUrl(`/corporate-invite#token=${token}`)).toBe('/corporate-invite')
  })
})

describe('trackGoal', () => {
  it('sends the goal to every counter', () => {
    const ym = vi.fn()
    window.ym = ym

    trackGoal('today_opened')

    expect(ym.mock.calls).toEqual([
      [111074543, 'reachGoal', 'today_opened'],
      [113121193, 'reachGoal', 'today_opened'],
    ])
  })

  it('does nothing when Metrika is unavailable', () => {
    expect(() => trackGoal('today_opened')).not.toThrow()
  })
})

describe('trackAuthenticatedOpen', () => {
  it.each(['trainer', 'client'] as const)('identifies a %s and sends the role to every counter', (role) => {
    const ym = vi.fn()
    window.ym = ym

    trackAuthenticatedOpen(`${role}-user-id`, role)

    expect(ym.mock.calls).toEqual([
      [111074543, 'setUserID', `${role}-user-id`],
      [111074543, 'reachGoal', 'authenticated_open', { role }],
      [113121193, 'setUserID', `${role}-user-id`],
      [113121193, 'reachGoal', 'authenticated_open', { role }],
    ])
  })

  it('does nothing when Metrika is unavailable', () => {
    expect(() => trackAuthenticatedOpen('user-id', 'client')).not.toThrow()
  })

  it('does not break the app when Metrika throws', () => {
    window.ym = vi.fn(() => { throw new Error('Metrika unavailable') })

    expect(() => trackAuthenticatedOpen('user-id', 'trainer')).not.toThrow()
  })
})
