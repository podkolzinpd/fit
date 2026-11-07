import { Capacitor } from '@capacitor/core'
import { useState } from 'react'
import { AppInstallPanel } from './AppInstallPrompt'
import { useAppInstalled } from './use-app-installed'

export function FitLimeInstallSetting({ initiallyExpanded = false, onClose }: { initiallyExpanded?: boolean; onClose?: () => void }) {
  const native = Capacitor.isNativePlatform()
  const installed = useAppInstalled()
  const [instructions, setInstructions] = useState(initiallyExpanded)
  return <>
    <p role="status">{native || installed ? 'Fit открыт как приложение' : 'Fit открыт в браузере'}</p>
    {!native && !installed && <>
      <p className="muted">Если Fit уже добавлен на экран «Домой», откройте его оттуда. Установка и разрешение уведомлений — разные настройки.</p>
      {!initiallyExpanded && <button type="button" className="secondary" aria-expanded={instructions} onClick={() => setInstructions((value) => !value)}>Как установить Fit</button>}
      {instructions && <AppInstallPanel onClose={() => { setInstructions(false); onClose?.() }} />}
    </>}
  </>
}
