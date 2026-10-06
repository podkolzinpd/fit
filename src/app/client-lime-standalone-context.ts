import { createContext } from 'react'
import type { AppTheme } from './theme'

// Presentation context; only the layout with a server-confirmed actor sets it.
export const ClientLimeStandaloneThemeContext = createContext<AppTheme | null>(null)
