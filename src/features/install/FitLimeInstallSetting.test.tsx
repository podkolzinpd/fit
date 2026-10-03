import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FitLimeInstallSetting } from './FitLimeInstallSetting'

const native = vi.hoisted(() => vi.fn(() => false))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: native } }))
afterEach(() => { native.mockReturnValue(false); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Fit Lime installation state', () => {
  it('does not claim an app is missing just because this tab is in the browser', () => {
    render(<FitLimeInstallSetting />)
    expect(screen.getByRole('status')).toHaveTextContent('Fit открыт в браузере')
    fireEvent.click(screen.getByRole('button', { name: 'Как установить Fit' }))
    expect(screen.getByRole('button', { name: 'Закрыть' })).toBeVisible()
  })
  it('has no install invitation for a native app', () => {
    native.mockReturnValue(true)
    render(<FitLimeInstallSetting />)
    expect(screen.getByRole('status')).toHaveTextContent('Fit открыт как приложение')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
  it('updates when standalone mode changes', () => {
    const media = new EventTarget()
    const mode = { matches: false, addEventListener: media.addEventListener.bind(media), removeEventListener: media.removeEventListener.bind(media) } as MediaQueryList
    vi.stubGlobal('matchMedia', vi.fn(() => mode))
    render(<FitLimeInstallSetting />)
    Object.assign(mode, { matches: true })
    act(() => { media.dispatchEvent(new Event('change')) })
    expect(screen.getByRole('status')).toHaveTextContent('Fit открыт как приложение')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
