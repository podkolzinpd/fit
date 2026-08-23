import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppInstallPrompt } from './AppInstallPrompt'

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
  })

  it('shows short iPhone steps without leaving the current screen', () => {
    render(<AppInstallPrompt userId="client-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Как добавить' }))
    expect(screen.getByText(/Нажмите «Поделиться»/)).toBeVisible()
    expect(screen.getByText(/На экран „Домой“/)).toBeVisible()
  })

  it('can be dismissed on this device', () => {
    const { unmount } = render(<AppInstallPrompt userId="client-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Не сейчас' }))
    expect(screen.queryByText('Добавьте Fit на экран «Домой»')).not.toBeInTheDocument()
    unmount()
    render(<AppInstallPrompt userId="client-1" />)
    expect(screen.queryByText('Добавьте Fit на экран «Домой»')).not.toBeInTheDocument()
  })
})
