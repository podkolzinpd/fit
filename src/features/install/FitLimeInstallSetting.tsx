import { Capacitor } from '@capacitor/core'
import { useEffect, useState } from 'react'
import { AppInstallPanel } from './AppInstallPrompt'
import { isAppInstalled, subscribeInstallState } from './app-install'

export function FitLimeInstallSetting() {
  const native = Capacitor.isNativePlatform()
  const [installed, setInstalled] = useState(isAppInstalled)
  const [instructions, setInstructions] = useState(false)
  useEffect(() => {
    const refresh = () => setInstalled(isAppInstalled())
    const unsubscribe = subscribeInstallState(refresh)
    const media = window.matchMedia?.('(display-mode: standalone)')
    media?.addEventListener('change', refresh)
    window.addEventListener('focus', refresh)
    return () => { unsubscribe(); media?.removeEventListener('change', refresh); window.removeEventListener('focus', refresh) }
  }, [])
  return <>
    <p role="status">{native || installed ? 'Fit открыт как приложение' : 'Fit открыт в браузере'}</p>
    {!native && !installed && <>
      <p className="muted">Если Fit уже добавлен на экран «Домой», откройте его оттуда. Установка и разрешение уведомлений — разные настройки.</p>
      <button type="button" className="secondary" aria-expanded={instructions} onClick={() => setInstructions((value) => !value)}>Как установить Fit</button>
      {instructions && <AppInstallPanel onClose={() => setInstructions(false)} />}
    </>}
  </>
}
