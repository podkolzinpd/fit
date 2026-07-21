import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { AuthProvider } from './app/auth-context'
import { QueryProvider } from './app/query-provider'
import './styles.css'

createRoot(document.getElementById('root')!).render(<StrictMode><QueryProvider><AuthProvider><App /></AuthProvider></QueryProvider></StrictMode>)
