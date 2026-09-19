import type { PropsWithChildren } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const providers = vi.hoisted(() => ({
  app: vi.fn(),
  auth: vi.fn(),
  backend: vi.fn(),
  errorBoundary: vi.fn(),
  query: vi.fn(),
  yandexSession: vi.fn(),
}))

function passThrough(spy: () => void) {
  return function Provider({ children }: PropsWithChildren) {
    spy()
    return children
  }
}

vi.mock('./App', () => ({ App: () => { providers.app(); return <p>Основное приложение</p> } }))
vi.mock('./auth-context', () => ({ AuthProvider: passThrough(providers.auth) }))
vi.mock('./data-backend-context', () => ({ DataBackendProvider: passThrough(providers.backend) }))
vi.mock('./error-boundary', () => ({ AppErrorBoundary: passThrough(providers.errorBoundary) }))
vi.mock('./query-provider', () => ({ QueryProvider: passThrough(providers.query) }))
vi.mock('./yandex-app-session-context', () => ({ YandexAppSessionProvider: passThrough(providers.yandexSession) }))

import { AppRoot } from './AppRoot'
import { MaintenancePage } from './maintenance-page'

describe('maintenance mode', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.unstubAllEnvs())

  it('is default-off and mounts the normal application providers', () => {
    vi.stubEnv('VITE_MAINTENANCE_MODE', '')
    render(<AppRoot />)

    expect(screen.getByText('Основное приложение')).toBeVisible()
    expect(providers.auth).toHaveBeenCalledOnce()
    expect(providers.backend).toHaveBeenCalledOnce()
    expect(providers.errorBoundary).toHaveBeenCalledOnce()
    expect(providers.query).toHaveBeenCalledOnce()
    expect(providers.yandexSession).toHaveBeenCalledOnce()
  })

  it.each(['TRUE', '1', 'yes'])('does not enable for %s', (value) => {
    vi.stubEnv('VITE_MAINTENANCE_MODE', value)
    render(<AppRoot />)
    expect(screen.getByText('Основное приложение')).toBeVisible()
  })

  it('replaces the complete runtime before auth and data providers mount', () => {
    vi.stubEnv('VITE_MAINTENANCE_MODE', 'true')
    render(<AppRoot />)

    expect(screen.getByRole('heading', { name: 'Скоро вернёмся' })).toBeVisible()
    expect(screen.getByText('Доступ временно закрыт')).toBeVisible()
    expect(providers.app).not.toHaveBeenCalled()
    expect(providers.auth).not.toHaveBeenCalled()
    expect(providers.backend).not.toHaveBeenCalled()
    expect(providers.errorBoundary).not.toHaveBeenCalled()
    expect(providers.query).not.toHaveBeenCalled()
    expect(providers.yandexSession).not.toHaveBeenCalled()
  })

  it('offers one explicit reload action', () => {
    const reload = vi.fn()
    render(<MaintenancePage reload={reload} />)
    fireEvent.click(screen.getByRole('button', { name: 'Проверить снова' }))
    expect(reload).toHaveBeenCalledOnce()
  })
})
