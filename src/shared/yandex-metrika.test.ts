import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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
