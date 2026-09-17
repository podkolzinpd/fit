import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionActor } from '../shared/domain'
import { AuthenticatedMetrika } from './authenticated-metrika'

const state = vi.hoisted(() => ({ actor: null as SessionActor | null }))
const trackAuthenticatedOpen = vi.hoisted(() => vi.fn())

vi.mock('./auth-context', () => ({ useAuth: () => ({ actor: state.actor }) }))
vi.mock('../shared/yandex-metrika', () => ({ trackAuthenticatedOpen }))

const trainer: SessionActor = {
  kind: 'trainer', role: 'trainer', userId: 'trainer-id', email: null,
  firstName: null, lastName: null, timezone: 'Europe/Moscow',
}
const client: SessionActor = {
  kind: 'client', role: 'client', userId: 'client-id', email: null,
  firstName: null, lastName: null, timezone: 'Europe/Moscow',
  clientId: 'client-profile-id', trainerId: 'trainer-id', fullName: 'Клиент',
}

describe('AuthenticatedMetrika', () => {
  beforeEach(() => {
    state.actor = null
    trackAuthenticatedOpen.mockReset()
  })

  it('tracks each authenticated account once and resets after logout', () => {
    const view = render(<AuthenticatedMetrika />)
    expect(trackAuthenticatedOpen).not.toHaveBeenCalled()

    state.actor = trainer
    view.rerender(<AuthenticatedMetrika />)
    view.rerender(<AuthenticatedMetrika />)
    expect(trackAuthenticatedOpen).toHaveBeenCalledTimes(1)
    expect(trackAuthenticatedOpen).toHaveBeenLastCalledWith('trainer-id', 'trainer')

    state.actor = client
    view.rerender(<AuthenticatedMetrika />)
    expect(trackAuthenticatedOpen).toHaveBeenLastCalledWith('client-id', 'client')

    state.actor = null
    view.rerender(<AuthenticatedMetrika />)
    state.actor = client
    view.rerender(<AuthenticatedMetrika />)
    expect(trackAuthenticatedOpen).toHaveBeenCalledTimes(3)
  })
})
