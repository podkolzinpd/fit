import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppInstallPanel, AppInstallPrompt } from './AppInstallPrompt'

describe('AppInstallPrompt', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    } })
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) })
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })
    window.dispatchEvent(new Event('appinstalled'))
  })

  it('shows the iPhone-specific route through Safari', () => {
    render(<AppInstallPrompt userId="client-1" />)
    expect(screen.getByRole('heading', { name: 'Установите Fit на iPhone' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Как установить на iPhone' }))
    expect(screen.getByText('Откройте эту страницу в Safari.')).toBeVisible()
    expect(screen.getByText(/Нажмите «Поделиться»/)).toBeVisible()
    expect(screen.getByText(/На экран „Домой“/)).toBeVisible()
  })

  it('shows a separate Android route through Chrome', () => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (Linux; Android 15; Pixel 9)' })
    render(<AppInstallPrompt userId="client-1" />)
    expect(screen.getByRole('heading', { name: 'Установите Fit на Android' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Как установить на Android' }))
    expect(screen.getByText('Откройте эту страницу в Chrome.')).toBeVisible()
    expect(screen.getByText(/Нажмите меню ⋮/)).toBeVisible()
    expect(screen.getByText(/Установить приложение/)).toBeVisible()
  })

  it('opens the native Android install prompt when the browser provides it', () => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (Linux; Android 15; Pixel 9)' })
    const prompt = vi.fn().mockResolvedValue(undefined)
    const installEvent = new Event('beforeinstallprompt')
    Object.assign(installEvent, {
      prompt,
      userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
    })
    window.dispatchEvent(installEvent)

    render(<AppInstallPrompt userId="client-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Установить на Android' }))
    expect(prompt).toHaveBeenCalledOnce()
  })

  it('uses the same platform-specific copy in the profile panel', () => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (Linux; Android 15; Pixel 9)' })
    render(<AppInstallPanel onClose={() => undefined} />)
    expect(screen.getByRole('heading', { name: 'Установите Fit на Android' })).toBeVisible()
    expect(screen.getByText('Откройте эту страницу в Chrome.')).toBeVisible()
  })

  it('can be dismissed on this device', () => {
    const { unmount } = render(<AppInstallPrompt userId="client-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Не сейчас' }))
    expect(screen.queryByText('Установите Fit на iPhone')).not.toBeInTheDocument()
    unmount()
    render(<AppInstallPrompt userId="client-1" />)
    expect(screen.queryByText('Установите Fit на iPhone')).not.toBeInTheDocument()
  })
})
