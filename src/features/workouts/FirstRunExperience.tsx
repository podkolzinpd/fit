import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

export function ClientFirstRunIntro({ actions, afterActions, showConnection = true }: { actions?: ReactNode; afterActions?: ReactNode; showConnection?: boolean }) {
  return <section className="first-run first-run-client" aria-labelledby="client-first-run-title">
    <div className="first-run-copy">
      <p className="eyebrow">ВАШ ПРОГРЕСС</p>
      <h2 id="client-first-run-title">Тренируйтесь и следите за прогрессом</h2>
      <p>Записывайте результаты, наблюдайте за изменениями и занимайтесь самостоятельно или с тренером.</p>
    </div>
    {actions}
    {afterActions}
    <div className="first-run-benefits">
      <strong>Fit поможет увидеть</strong>
      <ul>
        <li>изменения в упражнениях</li>
        <li>регулярность тренировок</li>
        <li>личные результаты</li>
      </ul>
    </div>
    {showConnection && <div className="first-run-connection">
      <span><strong>Занимаетесь с тренером?</strong><small>Откройте приглашение или введите код.</small></span>
      <Link className="button secondary" to="/join">Подключиться по приглашению</Link>
    </div>}
  </section>
}

export function TrainerFirstRun() {
  return <section className="first-run first-run-trainer" aria-labelledby="trainer-first-run-title">
    <div className="first-run-copy">
      <p className="eyebrow">ПЕРВЫЙ ШАГ</p>
      <h2 id="trainer-first-run-title">Планы и результаты спортсменов — в одном месте</h2>
      <p>Подключите аккаунт спортсмена. После его согласия можно составлять тренировки.</p>
    </div>
    <Link className="button primary" to="/connect">Подключить первого спортсмена</Link>
  </section>
}

export function TrainerFirstPlanPrompt({ clientName }: { clientName: string }) {
  return <section className="first-run-first-plan" aria-labelledby="trainer-first-plan-title">
    <p className="eyebrow">ПЕРВЫЙ ПЛАН</p>
    <h2 id="trainer-first-plan-title">Первая тренировка: {clientName}</h2>
    <p>Надиктуйте тренировку, введите её текстом или выберите упражнения вручную.</p>
  </section>
}
