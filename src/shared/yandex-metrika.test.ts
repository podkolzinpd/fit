import { afterEach, describe, expect, it, vi } from 'vitest'
import { trackAuthenticatedOpen } from './yandex-metrika'

describe('trackAuthenticatedOpen', () => {
  afterEach(() => {
    delete window.ym
  })

  it.each(['trainer', 'client'] as const)('identifies a %s and sends the role', (role) => {
    const ym = vi.fn()
    window.ym = ym

    trackAuthenticatedOpen(`${role}-user-id`, role)

    expect(ym.mock.calls).toEqual([
      [111074543, 'setUserID', `${role}-user-id`],
      [111074543, 'reachGoal', 'authenticated_open', { role }],
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
