import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppViewportProvider, appViewportMetrics, useAppViewport } from './app-viewport'

type ViewportListener = () => void

function installMobileViewport(height = 844) {
  let innerHeight = height
  const listeners = new Map<string, Set<ViewportListener>>()
  const viewport = {
    height,
    addEventListener: (name: string, listener: ViewportListener) => {
      const group = listeners.get(name) ?? new Set<ViewportListener>()
      group.add(listener)
      listeners.set(name, group)
    },
    removeEventListener: (name: string, listener: ViewportListener) => listeners.get(name)?.delete(listener),
  }

  Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => innerHeight })
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })))
  const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)

  return {
    viewport,
    scrollTo,
    setInnerHeight: (value: number) => { innerHeight = value },
    emit: (name: string) => listeners.get(name)?.forEach((listener) => listener()),
  }
}

function Probe() {
  const { keyboardOpen } = useAppViewport()
  return <><output>{keyboardOpen ? 'keyboard' : 'full'}</output><textarea aria-label="Ответ" /></>
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.documentElement.classList.remove('app-keyboard-open')
  document.documentElement.style.removeProperty('--app-viewport-height')
  document.documentElement.style.removeProperty('--app-visible-height')
})

describe('AppViewportProvider', () => {
  it('не принимает уменьшившийся innerHeight за новую постоянную высоту', () => {
    expect(appViewportMetrics(508, 508, 844)).toEqual({
      height: 844,
      visibleHeight: 508,
      keyboardOpen: true,
    })
  })

  it('возвращает мобильную оболочку к опорной высоте после blur даже при запоздавшем viewport', () => {
    vi.useFakeTimers()
    const mobileViewport = installMobileViewport()
    render(<AppViewportProvider><Probe /></AppViewportProvider>)

    expect(document.documentElement.style.getPropertyValue('--app-viewport-height')).toBe('844px')
    const input = screen.getByRole('textbox', { name: 'Ответ' })
    act(() => input.focus())
    mobileViewport.viewport.height = 508
    mobileViewport.setInnerHeight(508)
    act(() => mobileViewport.emit('resize'))

    expect(screen.getByText('keyboard')).toBeInTheDocument()
    expect(document.documentElement).toHaveClass('app-keyboard-open')
    expect(document.documentElement.style.getPropertyValue('--app-visible-height')).toBe('508px')

    act(() => input.blur())
    // Самый неприятный порядок WebKit: после blur приходит ещё один resize с
    // обеими уменьшенными высотами. Он не должен перезаписать опорные 844 px.
    act(() => mobileViewport.emit('resize'))
    act(() => vi.advanceTimersByTime(400))

    expect(screen.getByText('full')).toBeInTheDocument()
    expect(document.documentElement).not.toHaveClass('app-keyboard-open')
    expect(document.documentElement.style.getPropertyValue('--app-viewport-height')).toBe('844px')
    expect(document.documentElement.style.getPropertyValue('--app-visible-height')).toBe('844px')
    expect(mobileViewport.scrollTo).toHaveBeenCalledWith(0, 0)
  })
})
