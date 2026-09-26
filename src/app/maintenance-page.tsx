import { FitLogo } from '../shared/FitLogo'
import { StatePanel } from '../shared/ui'

export function MaintenancePage({ reload = () => window.location.reload() }: {
  reload?: () => void
}) {
  return <main className="maintenance-screen auth-screen auth-entry ui-identity auth-flow-identity">
    <header className="auth-entry-head maintenance-head">
      <FitLogo />
      <p className="eyebrow">ТЕХНИЧЕСКИЕ РАБОТЫ</p>
      <h1>Скоро вернёмся</h1>
      <p className="muted">Обновляем систему хранения данных, чтобы Fit продолжал работать надёжно и безопасно.</p>
    </header>
    <StatePanel
      tone="info"
      title="Доступ временно закрыт"
      description="Пока идут работы, нельзя просматривать или изменять данные. Откроем приложение после проверки переноса."
    />
    <button className="primary maintenance-reload" type="button" onClick={reload}>
      Проверить снова
    </button>
  </main>
}
