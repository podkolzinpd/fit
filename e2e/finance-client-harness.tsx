import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { PackageForm, PaymentForm } from '../src/features/finance/TrainerFinancePage'
import { AssistantIcon, ClientsIcon, ScheduleIcon, TodayIcon } from '../src/shared/icons'

const currentPackage = {
  id: 'package-1', clientId: 'client-1', trainerId: 'trainer-1', kind: 'session_pack' as const, title: 'Персональные тренировки с очень длинным названием',
  sessionsTotal: 10, sessionsUsed: 1, sessionsRemaining: 9, priceCents: 3000000, paidCents: 3000000,
  dueCents: 0, startsOn: '2026-09-30', endsOn: '2026-12-31', paymentDueOn: null, comment: 'Тренировки два раза в неделю.',
  packageStatus: 'active' as const, paymentStatus: 'paid' as const, closedAt: null, version: 1,
  createdAt: '2026-09-30T10:00:00Z', updatedAt: '2026-09-30T10:00:00Z',
}

type Editor = 'package' | 'new' | 'payment' | null
type Tab = 'packages' | 'sessions' | 'payments'

function FinanceTabs({ active, onChange }: { active: Tab; onChange: (tab: Tab) => void }) {
  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'packages', label: 'Услуги', count: 5 },
    { id: 'sessions', label: 'Занятия', count: 2 },
    { id: 'payments', label: 'Оплаты', count: 2 },
  ]
  return <div className="finance-tabs" role="tablist" aria-label="Раздел финансов клиента">{tabs.map((tab) => <button id={`finance-${tab.id}-tab`} key={tab.id} type="button" role="tab" aria-label={`${tab.label}: ${tab.count}`} aria-selected={active === tab.id} aria-controls={`finance-${tab.id}-panel`} className={active === tab.id ? 'is-active' : ''} onClick={() => onChange(tab.id)}><span>{tab.label}</span><small>{tab.count}</small></button>)}</div>
}

function Harness({ initialEditor = null }: { initialEditor?: Editor }) {
  const [editor, setEditor] = useState<Editor>(initialEditor)
  const [activeTab, setActiveTab] = useState<Tab>('packages')
  const [manualOpen, setManualOpen] = useState(false)
  return <MemoryRouter initialEntries={['/clients/demo/finance']}>
    <div className="phone-frame theme-light ui-identity trainer-finance-identity">
      <div className="content"><main className="page trainer-finance-page">
        <header className="page-header"><button className="page-back" type="button" aria-label="Назад">‹</button><div className="page-title-group"><h1>Финансы</h1><p>Александр Константинопольский</p></div></header>
        {editor === 'package' && <PackageForm current={currentPackage} today="2026-10-01" saving={false} error={null} onCancel={() => setEditor(null)} onSubmit={() => setEditor(null)} />}
        {editor === 'new' && <PackageForm today="2026-10-01" saving={false} error={null} onCancel={() => setEditor(null)} onSubmit={() => setEditor(null)} />}
        {editor === 'payment' && <PaymentForm packages={[currentPackage]} packageId={currentPackage.id} today="2026-10-01" saving={false} error={null} onCancel={() => setEditor(null)} onSubmit={() => setEditor(null)} />}
        {!editor && <><FinanceTabs active={activeTab} onChange={setActiveTab} />
          <section id="finance-packages-panel" className="finance-tab-panel" data-finance-tab="packages" role="tabpanel" aria-labelledby="finance-packages-tab" hidden={activeTab !== 'packages'}>
            <div className="finance-section-heading"><div><p className="eyebrow">АБОНЕМЕНТЫ</p><h2>Текущие</h2></div><button className="primary" type="button">Новый</button></div>
            <div className="finance-package-list"><article className="finance-package card">
              <header><div><span className="finance-status finance-status-active">Активен</span><h2>{currentPackage.title}</h2></div><div className="overflow-menu"><button className="overflow-trigger" type="button" aria-label="Редактировать абонемент" onClick={() => setEditor('package')}>•••</button></div></header>
              <div className="finance-package-summary"><p><span>Осталось занятий</span><strong>9 из 10</strong></p><p><span>Оплата</span><strong>30 000 ₽</strong><small>Оплачен · из 30 000 ₽</small></p></div>
              <div className="finance-package-meta"><span>30 сентября — 31 декабря</span></div>
              <details className="finance-package-details finance-disclosure"><summary><span>Подробнее</span></summary><div className="finance-disclosure-content"><div className="finance-package-facts"><p><span>Проведено</span><strong>1</strong></p><p><span>Оплачено</span><strong>30 000 ₽</strong></p><p><span>К оплате</span><strong>0 ₽</strong></p></div><p className="finance-comment">Тренировки два раза в неделю.</p><div className="finance-package-actions"><button type="button" className="secondary">Продлить</button><button type="button" className="secondary" onClick={() => setEditor('package')}>Изменить</button></div></div></details>
            </article></div>
            <details className="finance-history finance-disclosure card"><summary><span>История</span><small>4</small></summary><div className="finance-disclosure-content"><p className="finance-empty">Прошлые абонементы</p></div></details>
          </section>

          <section id="finance-sessions-panel" className="finance-tab-panel" data-finance-tab="sessions" role="tabpanel" aria-labelledby="finance-sessions-tab" hidden={activeTab !== 'sessions'}>
            <div className="finance-section-heading"><div><p className="eyebrow">ЗАНЯТИЯ</p><h2>Проведённые</h2></div>{!manualOpen && <button className="primary" type="button" onClick={() => setManualOpen(true)}>Добавить</button>}</div>
            <div className="finance-filter-row finance-session-filters" role="group" aria-label="Фильтр занятий"><button type="button" className="is-active">Все</button><button type="button">Без списания</button><button type="button">Пробные</button></div>
            {manualOpen && <form className="finance-manual-session"><label className="field"><span>Дата занятия</span><input name="workoutDate" type="date" defaultValue="2026-10-01" /></label><label className="field"><span>Учёт</span><select name="accounting" defaultValue="charged"><option value="charged">Списать: Персональные тренировки</option></select></label><label className="field"><span>Комментарий</span><input name="comment" defaultValue="Занятие вне расписания" /></label><div className="actions"><button className="secondary" type="button" onClick={() => setManualOpen(false)}>Отмена</button><button className="primary" type="button">Добавить</button></div></form>}
            <div className="finance-session-list"><div className="finance-session"><div className="finance-session-row"><div className="finance-session-leading"><span className="finance-session-number">№1</span><a href="/workouts/1"><strong>1 октября 2026 г.</strong><span>Из завершённой тренировки</span></a></div><div className="finance-session-accounting"><strong>Списано</strong><span>Персональные тренировки с длинным названием</span></div><div className="overflow-menu"><button className="overflow-trigger" type="button" aria-label="Действия с занятием 1 октября 2026 г.">•••</button></div></div></div><div className="finance-session"><div className="finance-session-row"><div className="finance-session-leading"><span className="finance-session-number">—</span><a href="/workouts/2"><strong>30 сентября 2026 г.</strong><span>Добавлено вручную с длинным пояснением</span></a></div><div className="finance-session-accounting"><strong>Нужно выбрать абонемент</strong><span>Без абонемента</span></div><div className="overflow-menu"><button className="overflow-trigger" type="button" aria-label="Действия с занятием 30 сентября 2026 г.">•••</button></div></div></div></div>
          </section>

          <section id="finance-payments-panel" className="finance-tab-panel" data-finance-tab="payments" role="tabpanel" aria-labelledby="finance-payments-tab" hidden={activeTab !== 'payments'}>
            <div className="finance-payment-overview"><p><span>Получено</span><strong>60 000 ₽</strong></p><p><span>К оплате</span><strong>125 000 ₽</strong></p></div>
            <div className="finance-section-heading"><div><p className="eyebrow">ОПЛАТЫ</p><h2>История</h2></div><button className="primary" type="button" onClick={() => setEditor('payment')}>Добавить</button></div>
            <div className="finance-payment-list finance-payment-ledger"><div className="finance-payment"><div><strong>30 000 ₽</strong><span>30 сентября 2026 г. · Оплата за тренировки</span></div><span className="finance-payment-package">Персональные тренировки с очень длинным названием</span><div className="overflow-menu"><button className="overflow-trigger" type="button" aria-label="Действия с оплатой 30 000 ₽">•••</button></div></div><div className="finance-payment"><div><strong>30 000 ₽</strong><span>1 сентября 2026 г.</span></div><span className="finance-payment-package">Предыдущий абонемент</span><div className="overflow-menu"><button className="overflow-trigger" type="button" aria-label="Действия с оплатой 30 000 ₽">•••</button></div></div></div>
          </section>
        </>}
      </main></div>
      <nav className="tab-bar trainer-tab-bar" aria-label="Основная навигация"><a href="/today"><TodayIcon />Сегодня</a><a href="/clients" className="active" aria-current="page"><ClientsIcon />Клиенты</a><a href="/assistant"><AssistantIcon />Ассистент</a><a href="/schedule"><ScheduleIcon />Расписание</a></nav>
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
