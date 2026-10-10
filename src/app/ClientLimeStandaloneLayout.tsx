import { useContext, useLayoutEffect, type PropsWithChildren } from 'react'
import { Outlet } from 'react-router-dom'
import { useAuth } from './auth-context'
import { isClientLimeEnabled } from './client-lime'
import { useClientLimeTheme } from './client-lime-theme'
import { applyAppTheme, applyThemeVariant, themeVariantClass, useAppTheme } from './theme'
import { FitLimeIconsContext } from '../shared/fit-lime-icons'
import { ClientLimeStandaloneThemeContext } from './client-lime-standalone-context'

// Public routes stay public. Visual scope is assigned only after the same
// server-confirmed client gate used by AppLayout; no email/storage inference.
export function ClientLimeStandaloneLayout({ children, registration = false }: PropsWithChildren<{ registration?: boolean }>) {
  const { actor } = useAuth()
  const inherited = useContext(ClientLimeStandaloneThemeContext) !== null
  // The approved new-account screen precedes the actor/experiment response.
  // Other public routes continue to require the server-confirmed client gate.
  const enabled = registration || isClientLimeEnabled(actor)
  const baseTheme = useAppTheme()
  const { theme } = useClientLimeTheme(actor?.userId ?? '')

  useLayoutEffect(() => {
    if (!enabled || inherited) return
    applyThemeVariant(theme)
    const root = document.documentElement
    root.classList.add('ui-identity', 'fit-lime-document', 'fit-client-lime-document')
    const statusBar = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-status-bar-style"]')
    const previousStatusBar = statusBar?.content ?? 'default'
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f6f7f2' : '#000000')
    statusBar?.setAttribute('content', theme === 'light' ? 'default' : 'black-translucent')
    return () => {
      root.classList.remove('fit-lime-document', 'fit-client-lime-document')
      statusBar?.setAttribute('content', previousStatusBar)
      applyAppTheme(baseTheme)
    }
  }, [enabled, inherited, theme, baseTheme])

  const content = children ?? <Outlet />
  if (!enabled || inherited) return content
  return <ClientLimeStandaloneThemeContext.Provider value={theme}>
    <FitLimeIconsContext.Provider value>
      <div className={`phone-frame ui-identity fit-lime-shell fit-lime fit-client-lime fit-client-lime-public ${themeVariantClass(theme)}`}>
        <div className="content content-immersive">{content}</div>
      </div>
    </FitLimeIconsContext.Provider>
  </ClientLimeStandaloneThemeContext.Provider>
}
