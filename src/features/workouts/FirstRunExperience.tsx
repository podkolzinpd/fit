import { useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

export function ClientFirstRunIntro({ actions, showConnection = true }: { actions?: ReactNode; showConnection?: boolean }) {
  return <section className="first-run first-run-client" aria-labelledby="client-first-run-title">
    <div className="first-run-copy">
      <p className="eyebrow">ВАШ ПРОГРЕСС</p>
      <h2 id="client-first-run-title">Тренируйтесь и следите за прогрессом</h2>
      <p>Записывайте результаты, наблюдайте за изменениями и занимайтесь самостоятельно или с тренером.</p>
    </div>
    {actions}
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

export function TrainerFirstRun({ creating, error, onCreate }: {
  creating: boolean
  error: Error | null
  onCreate: (fullName: string) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [validation, setValidation] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = name.trim()
    if (value.length < 2) {
      setValidation('Введите имя клиента')
      return
    }
    setValidation(null)
    await onCreate(value)
  }

  return <section className="first-run first-run-trainer" aria-labelledby="trainer-first-run-title">
    <div className="first-run-copy">
      <p className="eyebrow">ПЕРВЫЙ ШАГ</p>
      <h2 id="trainer-first-run-title">Планы и результаты спортсменов — в одном месте</h2>
      <p>Добавьте первого клиента и составьте для него тренировку.</p>
    </div>
    <form className="first-run-client-form" onSubmit={(event) => void submit(event)}>
      <label htmlFor="first-client-name">Имя клиента</label>
      <div>
        <input id="first-client-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Например, Антон" autoComplete="off" />
        <button className="primary" disabled={creating}>{creating ? 'Добавляем…' : 'Добавить первого клиента'}</button>
      </div>
      {(validation || error) && <p className="error" role="alert">{validation ?? error?.message}</p>}
    </form>
  </section>
}

export function TrainerFirstPlanPrompt({ clientName }: { clientName: string }) {
  return <section className="first-run-first-plan" aria-labelledby="trainer-first-plan-title">
    <p className="eyebrow">ПЕРВЫЙ ПЛАН</p>
    <h2 id="trainer-first-plan-title">Первая тренировка: {clientName}</h2>
    <p>Надиктуйте тренировку, введите её текстом или выберите упражнения вручную.</p>
  </section>
}
