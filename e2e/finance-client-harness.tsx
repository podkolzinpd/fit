import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { PackageForm, PaymentForm } from '../src/features/finance/TrainerFinancePage'
import { AssistantIcon, ClientsIcon, ScheduleIcon, TodayIcon } from '../src/shared/icons'

const currentPackage = {
  id: 'package-1', clientId: 'client-1', trainerId: 'trainer-1', title: 'Персональные тренировки',
  sessionsTotal: 10, sessionsUsed: 1, sessionsRemaining: 9, priceCents: 3000000, paidCents: 3000000,
  dueCents: 0, startsOn: '2026-09-30', endsOn: null, paymentDueOn: null, comment: null,
  packageStatus: 'active' as const, paymentStatus: 'paid' as const, closedAt: null, version: 1,
  createdAt: '2026-09-30T10:00:00Z', updatedAt: '2026-09-30T10:00:00Z',
}

type Editor = 'package' | 'payment' | null

function Harness({ initialEditor = null }: { initialEditor?: Editor }) {
  const [editor, setEditor] = useState<Editor>(initialEditor)
  const [manualOpen, setManualOpen] = useState(false)
  const savePackage = () => setEditor(null)
  return <MemoryRouter initialEntries={['/clients/demo/finance']}>
    <div className="phone-frame theme-light ui-identity trainer-finance-identity">
      <div className="content">
        <main className="page trainer-finance-page">
          <header className="page-header"><button className="page-back" type="button" aria-label="Назад">‹</button><div className="page-title-group"><h1>Финансы</h1><p>Александр Константинопольский</p></div></header>
          {editor === 'package' && <PackageForm current={currentPackage} today="2026-10-01" saving={false} error={null} onCancel={() => setEditor(null)} onSubmit={savePackage} />}
          {editor === 'payment' && <PaymentForm today="2026-10-01" saving={false} error={null} onCancel={() => setEditor(null)} onSubmit={() => setEditor(null)} />}
          {!editor && <><section className="finance-section-heading"><div><p className="eyebrow">АБОНЕМЕНТЫ</p><h2>Текущие</h2></div><button className="primary" type="button">Новый</button></section>
          <div className="finance-package-list">
            <article className="finance-package card">
              <header><div><span className="finance-status finance-status-active">Активен</span><h2>Персональные тренировки с очень длинным названием</h2></div><div className="overflow-menu"><button className="overflow-trigger" type="button" aria-label="Редактировать абонемент" onClick={() => setEditor('package')}>•••</button></div></header>
              <div className="finance-package-summary"><p><span>Осталось занятий</span><strong>9 из 10</strong></p><p><span>Оплата</span><strong>30 000 ₽</strong><small>Оплачен · из 30 000 ₽</small></p></div>
              <div className="finance-package-meta"><span>С 30 сентября 2026 г.</span></div>
              <details className="finance-disclosure"><summary><span>Оплаты</span><small>1</small></summary><div className="finance-disclosure-content"><button type="button" className="secondary finance-inline-action" onClick={() => setEditor('payment')}>Добавить оплату</button><div className="finance-payment-list"><div className="finance-payment"><div><strong>30 000 ₽</strong><span>30 сентября 2026 г. · Оплата за персональные тренировки</span></div></div></div></div></details>
            </article>
          </div>
          <details className="finance-sessions finance-disclosure card" open><summary><span>Проведённые занятия</span><small>2</small></summary><div className="finance-disclosure-content"><button type="button" className="secondary finance-inline-action" onClick={() => setManualOpen((value) => !value)}>{manualOpen ? 'Закрыть форму' : 'Добавить занятие'}</button>{manualOpen && <form className="finance-manual-session"><label className="field"><span>Дата занятия</span><input name="workoutDate" type="date" defaultValue="2026-10-01" /></label><label className="field"><span>Учёт</span><select name="accounting" defaultValue="charged"><option value="charged">Списать: Персональные тренировки</option></select></label><label className="field"><span>Комментарий</span><input name="comment" defaultValue="Занятие вне расписания" /></label><button className="primary" type="button">Добавить занятие</button></form>}<div className="finance-session-list"><div className="finance-session"><div className="finance-session-row"><a href="/workouts/1"><strong>1 октября 2026 г.</strong><span>Из завершённой тренировки</span></a><small>Списано</small><div className="overflow-menu"><button className="overflow-trigger" type="button" aria-label="Действия с занятием 1 октября 2026 г.">•••</button></div></div></div><div className="finance-session"><div className="finance-session-row"><a href="/workouts/2"><strong>30 сентября 2026 г.</strong><span>Добавлено вручную с длинным пояснением</span></a><small>Нужно выбрать абонемент</small><div className="overflow-menu"><button className="overflow-trigger" type="button" aria-label="Действия с занятием 30 сентября 2026 г.">•••</button></div></div></div></div></div></details>
          <details className="finance-history finance-disclosure card"><summary><span>Прошлые абонементы</span><small>4</small></summary><div className="finance-disclosure-content"><p className="finance-empty">История абонементов</p></div></details>
          </>}
        </main>
      </div>
      <nav className="tab-bar trainer-tab-bar" aria-label="Основная навигация">
        <a href="/today"><TodayIcon />Сегодня</a><a href="/clients" className="active" aria-current="page"><ClientsIcon />Клиенты</a><a href="/assistant"><AssistantIcon />Ассистент</a><a href="/schedule"><ScheduleIcon />Расписание</a>
      </nav>
    </div>
  </MemoryRouter>
}

export function mountFinanceClientHarness(initialEditor: Editor = null) {
  const original = document.getElementById('root')
  if (original) original.style.display = 'none'
  document.getElementById('finance-client-qa')?.remove()
  const mount = document.createElement('div')
  mount.id = 'finance-client-qa'
  document.body.append(mount)
  createRoot(mount).render(<Harness initialEditor={initialEditor} />)
}
