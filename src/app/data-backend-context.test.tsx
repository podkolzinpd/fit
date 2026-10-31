import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DataBackendProvider, useDataBackend, useOptionalDataBackend } from './data-backend-context'

const id = 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b'
const state = vi.hoisted(() => ({ actor: true, session: true, profileId: 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b' }))
const create = vi.hoisted(() => vi.fn(() => ({ source: 'yandex' as const })))
vi.mock('../data/repositories/yandex-main.repository', () => ({ createYandexMainRepository: create }))
vi.mock('./auth-context', () => ({ useAuth: () => ({ actor: state.actor ? { kind: 'trainer', role: 'trainer', userId: 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b' } : null }) }))
vi.mock('./yandex-app-session-context', () => ({ useYandexAppSession: () => ({ session: state.session ? { accessMode: 'read_write', profile: { id: state.profileId }, session: { token: 'a'.repeat(43) } } : null }) }))
function Probe() { return <p>{useDataBackend().source}</p> }
function Optional() { return <p>{useOptionalDataBackend() === null ? 'public' : 'authenticated'}</p> }
beforeEach(() => {
  Object.assign(state, { actor: true, session: true, profileId: id })
  create.mockClear()
  vi.stubEnv('VITE_YANDEX_MAIN_ROUTING_ENABLED', 'true')
  vi.stubEnv('VITE_YANDEX_APP_SESSION_ENABLED', 'true')
  vi.stubEnv('VITE_YANDEX_NATIVE_REGISTRATION_ENABLED', 'true')
  vi.stubEnv('VITE_YANDEX_ONLY_AUTH_ENABLED', 'true')
  vi.stubEnv('VITE_YANDEX_OAUTH_CLIENT_ID', 'fixture-client-id')
  vi.stubEnv('VITE_YANDEX_API_BASE_URL', 'http://127.0.0.1:4100')
})
afterEach(() => vi.unstubAllEnvs())
it('selects the native repository for the matching read-write actor', () => {
  render(<DataBackendProvider><Probe /></DataBackendProvider>)
  expect(screen.getByText('yandex')).toBeVisible()
  expect(create).toHaveBeenCalledWith('http://127.0.0.1:4100', 'a'.repeat(43), expect.objectContaining({ userId: id }))
})
it.each(['missing-session', 'missing-actor', 'mismatched-profile', 'missing-config'] as const)('fails closed for %s', reason => {
  if (reason === 'missing-session') state.session = false
  if (reason === 'missing-actor') state.actor = false
  if (reason === 'mismatched-profile') state.profileId = '73c868ff-0dd4-4f76-a890-57846b302a92'
  if (reason === 'missing-config') vi.stubEnv('VITE_YANDEX_API_BASE_URL', '')
  expect(() => render(<DataBackendProvider><Probe /></DataBackendProvider>)).toThrow('Сессия Yandex ID недоступна')
  expect(create).not.toHaveBeenCalled()
})
it('requires an explicit provider for protected features', () => {
  expect(() => render(<Probe />)).toThrow('useDataBackend должен использоваться внутри DataBackendProvider')
})
it('allows public invitation preview without an authenticated backend', () => {
  render(<Optional />)
  expect(screen.getByText('public')).toBeVisible()
  expect(create).not.toHaveBeenCalled()
})
