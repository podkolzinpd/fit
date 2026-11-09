import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { matchRoutes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ACQUISITION_COUNTER_ID, COUNTER_IDS, sanitizeAcquisitionUrl, sanitizeMetrikaUrl, trackAcquisitionGoal, trackAuthenticatedOpen, trackGoal, trackPageView } from './yandex-metrika'

afterEach(() => {
  delete window.ym
})

describe('Metrika counters', () => {
  it('initializes exactly the counters that receive events', () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
    const script = html.match(/<!-- Yandex\.Metrika counter -->\s*<script[^>]*>([\s\S]*?)<\/script>/)?.[1]
    const ym = vi.fn<(id: number, action: string, ...args: unknown[]) => void>()
    const location = new URL('https://fit-training.ru/auth/yandex/callback?code=private-code&state=private-state&utm_source=club#private-fragment')
    const document = { scripts: [], referrer: 'https://oauth.yandex.ru/authorize?code=private-code', createElement: () => ({}), getElementsByTagName: () => [{ parentNode: { insertBefore: vi.fn() } }] }
    runInNewContext(script!, { window: { location, ym }, document, location, ym, URL, URLSearchParams })
    expect(ym.mock.calls.map(([id]) => id)).toEqual([...COUNTER_IDS])
    expect(ym).toHaveBeenCalledWith(ACQUISITION_COUNTER_ID, 'init', expect.objectContaining({
      webvisor: false, clickmap: false, trackLinks: false,
      url: 'https://fit-training.ru/auth/yandex/callback?utm_source=club',
      referrer: 'https://oauth.yandex.ru/authorize',
    }))
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
        expect(insertBefore).toHaveBeenCalledTimes(COUNTER_IDS.length)
        expect(insertBefore.mock.calls.map(([script]) => Number(new URL(script.src).searchParams.get('id')))).toEqual([...COUNTER_IDS])
        expect(ym).toHaveBeenCalledTimes(COUNTER_IDS.length)
        for (const id of COUNTER_IDS) expect(ym).toHaveBeenCalledWith(id, 'init', expect.objectContaining({ url: 'https://fit-training.ru/today', webvisor: id === 111074543 }))
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
      [114123380, 'hit', '/today'],
    ])
  })

  it('removes invitation credentials from analytics URLs', () => {
    const token = `ABCDEF123456.${'a'.repeat(64)}`
    expect(sanitizeMetrikaUrl(`/invite?token=${token}&source=yandex`)).toBe('/invite')
    expect(sanitizeMetrikaUrl(`/invite#token=${token}&source=yandex`)).toBe('/invite')
    expect(sanitizeMetrikaUrl(`/corporate-invite#token=${token}`)).toBe('/corporate-invite')
  })

  it('retains campaign attribution but excludes arbitrary query and hash data in the new counter', () => {
    expect(sanitizeAcquisitionUrl('/auth/yandex/callback?code=private&state=secret&token=secret&utm_campaign=launch#token=secret')).toBe('/auth/yandex/callback?utm_campaign=launch')
    expect(sanitizeAcquisitionUrl('https://fit-training.ru/invite?token=secret&source=yandex')).toBe('https://fit-training.ru/invite')
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
      [114123380, 'reachGoal', 'today_opened'],
    ])
  })

  it('does nothing when Metrika is unavailable', () => {
    expect(() => trackGoal('today_opened')).not.toThrow()
  })

  it('keeps the new counter and the app working when an old counter throws', () => {
    const ym = vi.fn((id: number) => { if (id === 111074543) throw new Error('blocked') })
    window.ym = ym
    expect(() => trackGoal('today_opened')).not.toThrow()
    expect(ym).toHaveBeenLastCalledWith(ACQUISITION_COUNTER_ID, 'reachGoal', 'today_opened')
    expect(() => trackPageView('/today')).not.toThrow()
    expect(ym).toHaveBeenLastCalledWith(ACQUISITION_COUNTER_ID, 'hit', '/today')
  })
})

describe('acquisition success events', () => {
  it.each(['trainer', 'client'] as const)('sends only the success event and %s role to the new counter', (role) => {
    const ym = vi.fn()
    window.ym = ym
    trackAcquisitionGoal('registration_completed', role)
    trackAcquisitionGoal('workout_result_saved', role)
    expect(ym.mock.calls).toEqual([
      [ACQUISITION_COUNTER_ID, 'reachGoal', 'registration_completed', { role }],
      [ACQUISITION_COUNTER_ID, 'reachGoal', 'workout_result_saved', { role }],
    ])
  })

  it('never interrupts a successful user action when analytics fails', () => {
    window.ym = vi.fn(() => { throw new Error('blocked') })
    expect(() => trackAcquisitionGoal('registration_completed', 'client')).not.toThrow()
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
      [114123380, 'setUserID', `${role}-user-id`],
      [114123380, 'reachGoal', 'authenticated_open', { role }],
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


it.each(['/private-analytics','/Private-Analytics/','/%70rivate-analytics'])('strips private analytics filters from telemetry: %s', path => {
  expect(sanitizeMetrikaUrl(`${path}?person=synthetic-id&search=private#details`)).toBe('/private-analytics')
})
