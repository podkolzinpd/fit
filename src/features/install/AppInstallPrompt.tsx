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

type InstallPlatform = ReturnType<typeof detectInstallPlatform>

type InstallContent = {
  eyebrow: string
  title: string
  copy: string
  instructionsButton: string
  installButton: string
}

function getInstallContent(platform: InstallPlatform): InstallContent {
  if (platform === 'ios') return {
    eyebrow: 'ДЛЯ IPHONE',
    title: 'Установите Fit на iPhone',
    copy: 'Открывайте тренировки с экрана «Домой», как обычное приложение.',
    instructionsButton: 'Как установить на iPhone',
    installButton: 'Установить на iPhone',
  }
  if (platform === 'android') return {
    eyebrow: 'ДЛЯ ANDROID',
    title: 'Установите Fit на Android',
    copy: 'Запускайте тренировки с главного экрана без поиска ссылки в браузере.',
    instructionsButton: 'Как установить на Android',
    installButton: 'Установить на Android',
  }
  return {
    eyebrow: 'ПРИЛОЖЕНИЕ',
    title: 'Установите Fit',
    copy: 'Открывайте Fit с главного экрана, как обычное приложение.',
    instructionsButton: 'Как установить',
    installButton: 'Установить Fit',
  }
}

function InstallInstructions({ platform }: { platform: InstallPlatform }) {
  if (platform === 'ios') return <ol className="app-install-steps">
    <li>Откройте эту страницу в Safari.</li>
    <li>Нажмите «Поделиться» внизу экрана.</li>
    <li>Выберите «На экран „Домой“», затем «Добавить».</li>
  </ol>
  if (platform === 'android') return <ol className="app-install-steps">
    <li>Откройте эту страницу в Chrome.</li>
    <li>Нажмите меню ⋮ в правом верхнем углу.</li>
    <li>Выберите «Установить приложение» или «Добавить на главный экран» и подтвердите.</li>
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
  const platform = detectInstallPlatform()
  const content = getInstallContent(platform)
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
    <div><p className="eyebrow">{content.eyebrow}</p><h2 id="app-install-prompt-title">{content.title}</h2><p>{content.copy}</p></div>
    {instructionsOpen && <InstallInstructions platform={platform} />}
    <div className="app-install-actions">
      <button type="button" className="secondary" onClick={() => instructionsOpen ? dismiss() : void install()}>{instructionsOpen ? 'Понятно' : promptAvailable ? content.installButton : content.instructionsButton}</button>
      {!instructionsOpen && <button type="button" className="link muted" onClick={dismiss}>Не сейчас</button>}
    </div>
  </section>
}

export function AppInstallPanel({ onClose }: { onClose: () => void }) {
  const { installed, promptAvailable } = useInstallState()
  const [instructionsOpen, setInstructionsOpen] = useState(!promptAvailable)
  const platform = detectInstallPlatform()
  const content = getInstallContent(platform)

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
    <div className="app-install-head"><div><p className="eyebrow">{content.eyebrow}</p><h2 id="app-install-panel-title">{content.title}</h2></div><button type="button" className="link" onClick={onClose}>Закрыть</button></div>
    {installed ? <p className="app-install-success" role="status">Fit уже открывается как приложение.</p> : <>
      <p className="app-install-copy">{content.copy}</p>
      {instructionsOpen && <InstallInstructions platform={platform} />}
      {promptAvailable && <button type="button" className="secondary wide" onClick={() => void install()}>{content.installButton}</button>}
    </>}
  </section>
}
