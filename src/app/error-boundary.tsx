import { Component, type ReactNode } from 'react'
import { trackGoal } from '../shared/yandex-metrika'

interface Props { children: ReactNode; onReload?: () => void }
interface State { failed: boolean }

// Ловит только необработанные ошибки React-рендера. AsyncView продолжает
// отвечать за штатные loading/error состояния запросов и не дублируется здесь.
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State { return { failed: true } }

  componentDidCatch() {
    // Не передаём message, stack, маршрут или данные пользователя: в метрике
    // остаётся только обезличенный факт аварии корневого рендера.
    trackGoal('app_render_error')
  }

  private retry = () => this.setState({ failed: false })

  private reload = () => {
    if (this.props.onReload) this.props.onReload()
    else window.location.reload()
  }

  render() {
    if (!this.state.failed) return this.props.children
    return <main className="app-render-error ui-identity system-state-identity" role="alert">
      <span className="app-render-error-mark" aria-hidden="true">!</span>
      <h1>Не удалось открыть экран</h1>
      <p>Ваши данные сохранены. Попробуйте открыть экран ещё раз или обновите приложение.</p>
      <div className="app-render-error-actions">
        <button type="button" className="secondary" onClick={this.retry}>Попробовать снова</button>
        <button type="button" className="secondary" onClick={this.reload}>Обновить приложение</button>
      </div>
    </main>
  }
}
