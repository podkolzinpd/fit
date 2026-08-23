import { useEffect, useState } from 'react'
import { trackGoal } from '../../shared/yandex-metrika'
import {
  detectInstallPlatform,
  dismissInstallPrompt,
  getInstallSnapshot,
  installPromptDismissed,
  requestAppInstall,
  subscribeInstallState,
} from './app-install'

function InstallInstructions({ platform }: { platform: ReturnType<typeof detectInstallPlatform> }) {
  if (platform === 'ios') return <ol className="app-install-steps">
    <li>Нажмите «Поделиться» внизу Safari.</li>
    <li>Выберите «На экран „Домой“», затем «Добавить».</li>
  </ol>
  if (platform === 'android') return <ol className="app-install-steps">
    <li>Откройте меню браузера ⋮.</li>
    <li>Выберите «Установить приложение» или «Добавить на главный экран».</li>
  </ol>
  return <ol className="app-install-steps">
    <li>Откройте меню браузера.</li>
    <li>Выберите установку приложения или добавление на главный экран.</li>
  </ol>
}

function useInstallState() {
  const [snapshot, setSnapshot] = useState(getInstallSnapshot)
  useEffect(() => subscribeInstallState(() => setSnapshot(getInstallSnapshot())), [])
  return snapshot
}

export function AppInstallPrompt({ userId }: { userId: string }) {
  const { installed, promptAvailable } = useInstallState()
  const [dismissed, setDismissed] = useState(() => installPromptDismissed(userId))
  const [instructionsOpen, setInstructionsOpen] = useState(false)
  if (installed || dismissed) return null

  async function install() {
    trackGoal('app_install_prompt_opened')
    if (!promptAvailable) {
      setInstructionsOpen(true)
      return
    }
    const outcome = await requestAppInstall()
    trackGoal(outcome === 'accepted' ? 'app_install_accepted' : 'app_install_dismissed')
  }

  function dismiss() {
    dismissInstallPrompt(userId)
    setDismissed(true)
    trackGoal('app_install_nudge_dismissed')
  }

  return <section className="app-install-card compact" aria-labelledby="app-install-prompt-title">
    <div><p className="eyebrow">FIT ПОД РУКОЙ</p><h2 id="app-install-prompt-title">Добавьте Fit на экран «Домой»</h2><p>Открывайте тренировки как обычное приложение.</p></div>
    {instructionsOpen && <InstallInstructions platform={detectInstallPlatform()} />}
    <div className="app-install-actions">
      <button type="button" className="secondary" onClick={() => instructionsOpen ? dismiss() : void install()}>{instructionsOpen ? 'Понятно' : promptAvailable ? 'Установить' : 'Как добавить'}</button>
      {!instructionsOpen && <button type="button" className="link muted" onClick={dismiss}>Не сейчас</button>}
    </div>
  </section>
}

export function AppInstallPanel({ onClose }: { onClose: () => void }) {
  const { installed, promptAvailable } = useInstallState()
  const [instructionsOpen, setInstructionsOpen] = useState(!promptAvailable)

  async function install() {
    if (!promptAvailable) {
      setInstructionsOpen(true)
      return
    }
    trackGoal('app_install_profile_started')
    const outcome = await requestAppInstall()
    trackGoal(outcome === 'accepted' ? 'app_install_accepted' : 'app_install_dismissed')
  }

  return <section className="app-install-card" aria-labelledby="app-install-panel-title">
    <div className="app-install-head"><div><p className="eyebrow">ПРИЛОЖЕНИЕ</p><h2 id="app-install-panel-title">Fit на экране «Домой»</h2></div><button type="button" className="link" onClick={onClose}>Закрыть</button></div>
    {installed ? <p className="app-install-success" role="status">Fit уже открывается как приложение.</p> : <>
      <p className="app-install-copy">Быстрый доступ без поиска ссылки в браузере.</p>
      {instructionsOpen && <InstallInstructions platform={detectInstallPlatform()} />}
      {promptAvailable && <button type="button" className="secondary wide" onClick={() => void install()}>Установить Fit</button>}
    </>}
  </section>
}
