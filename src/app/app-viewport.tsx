import { createContext, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react'

const KEYBOARD_THRESHOLD = 160

function isKeyboardInput(element: Element | null): element is HTMLElement {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true
  if (element instanceof HTMLElement && element.isContentEditable) return true
  if (!(element instanceof HTMLInputElement)) return false
  return !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(element.type)
}

export function appViewportMetrics(innerHeight: number, visualHeight: number, stableHeight = innerHeight) {
  const visibleHeight = Math.round(visualHeight)
  const layoutHeight = Math.round(Math.max(stableHeight, innerHeight, visualHeight))
  return {
    height: layoutHeight,
    visibleHeight,
    keyboardOpen: layoutHeight - visibleHeight > KEYBOARD_THRESHOLD,
  }
}

type AppViewportContextValue = {
  keyboardOpen: boolean
}

const AppViewportContext = createContext<AppViewportContextValue>({ keyboardOpen: false })

function resetRootScroll() {
  window.scrollTo(0, 0)
  document.documentElement.scrollTop = 0
  document.body.scrollTop = 0
}

export function AppViewportProvider({ children }: PropsWithChildren) {
  const initialHeight = typeof window === 'undefined' ? 0 : Math.round(window.innerHeight)
  const stableHeightRef = useRef(initialHeight)
  const recoveryTimersRef = useRef<number[]>([])
  const [keyboardOpen, setKeyboardOpen] = useState(false)

  useEffect(() => {
    const root = document.documentElement
    const viewport = window.visualViewport
    const mobile = window.matchMedia('(max-width: 480px)')

    const clearRecoveryTimers = () => {
      for (const timer of recoveryTimersRef.current) window.clearTimeout(timer)
      recoveryTimersRef.current = []
    }

    const applyDimensions = (height: number, visibleHeight: number, offsetTop = 0) => {
      root.style.setProperty('--app-viewport-height', `${height}px`)
      root.style.setProperty('--app-visible-height', `${visibleHeight}px`)
      root.style.setProperty('--app-viewport-offset-top', `${offsetTop}px`)
    }

    const recover = () => {
      if (!mobile.matches || isKeyboardInput(document.activeElement)) return
      setKeyboardOpen(false)
      root.classList.remove('app-keyboard-open')
      applyDimensions(stableHeightRef.current, stableHeightRef.current)
      resetRootScroll()
    }

    const scheduleRecovery = () => {
      clearRecoveryTimers()
      // WebKit может прислать последний resize уже после focusout. Несколько
      // коротких проходов возвращают оболочку без скачка и не трогают scroll
      // внутреннего .content.
      recoveryTimersRef.current = [0, 120, 360].map((delay) => window.setTimeout(recover, delay))
    }

    const update = () => {
      if (!mobile.matches) {
        setKeyboardOpen(false)
        root.classList.remove('app-keyboard-open')
        root.style.removeProperty('--app-viewport-height')
        root.style.removeProperty('--app-visible-height')
        root.style.removeProperty('--app-viewport-offset-top')
        return
      }

      const visualHeight = viewport?.height ?? window.innerHeight
      const metrics = appViewportMetrics(window.innerHeight, visualHeight, stableHeightRef.current)
      const activeInput = isKeyboardInput(document.activeElement)
      const nextKeyboardOpen = metrics.keyboardOpen && activeInput

      if (!metrics.keyboardOpen) {
        // Обновляем опорную высоту только вне клавиатуры. Так временно
        // уменьшившийся WKWebView не становится новой постоянной высотой.
        stableHeightRef.current = Math.round(Math.max(window.innerHeight, visualHeight))
      }

      applyDimensions(
        stableHeightRef.current,
        nextKeyboardOpen ? metrics.visibleHeight : stableHeightRef.current,
        nextKeyboardOpen ? Math.round(viewport?.offsetTop ?? 0) : 0,
      )
      setKeyboardOpen(nextKeyboardOpen)
      root.classList.toggle('app-keyboard-open', nextKeyboardOpen)
      if (!nextKeyboardOpen) resetRootScroll()
    }

    const onFocusOut = (event: FocusEvent) => {
      const target = event.target instanceof Element ? event.target : null
      const relatedTarget = event.relatedTarget instanceof Element ? event.relatedTarget : null
      if (!isKeyboardInput(target)) return
      if (isKeyboardInput(relatedTarget)) return
      scheduleRecovery()
    }

    const onOrientationChange = () => {
      clearRecoveryTimers()
      recoveryTimersRef.current = [360].map((delay) => window.setTimeout(() => {
        stableHeightRef.current = Math.round(Math.max(window.innerHeight, viewport?.height ?? 0))
        update()
      }, delay))
    }

    update()
    viewport?.addEventListener('resize', update)
    viewport?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', onOrientationChange)
    document.addEventListener('focusin', update)
    document.addEventListener('focusout', onFocusOut)
    mobile.addEventListener('change', update)
    return () => {
      clearRecoveryTimers()
      viewport?.removeEventListener('resize', update)
      viewport?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', onOrientationChange)
      document.removeEventListener('focusin', update)
      document.removeEventListener('focusout', onFocusOut)
      mobile.removeEventListener('change', update)
      root.classList.remove('app-keyboard-open')
      root.style.removeProperty('--app-viewport-height')
      root.style.removeProperty('--app-visible-height')
      root.style.removeProperty('--app-viewport-offset-top')
    }
  }, [])

  const value = useMemo(() => ({ keyboardOpen }), [keyboardOpen])
  return <AppViewportContext.Provider value={value}>{children}</AppViewportContext.Provider>
}

export function useAppViewport() {
  return useContext(AppViewportContext)
}
