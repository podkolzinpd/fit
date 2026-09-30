import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { AssistantIcon, ClientsIcon, ScheduleIcon, TodayIcon } from '../src/shared/icons'

function Harness() {
  return <MemoryRouter initialEntries={['/clients/demo/finance']}>
    <div className="phone-frame theme-light ui-identity trainer-finance-identity">
      <div className="content">
        <main className="page trainer-finance-page">
          <header className="page-header"><button className="page-back" type="button" aria-label="Назад">‹</button><div className="page-title-group"><h1>Финансы</h1><p>Александр Константинопольский</p></div></header>
          <section className="finance-section-heading"><div><p className="eyebrow">АБОНЕМЕНТЫ</p><h2>Текущие</h2></div><button className="primary" type="button">Новый</button></section>
          <div className="finance-package-list">
            <article className="finance-package card">
              <header><div><span className="finance-status finance-status-active">Активен</span><h2>Персональные тренировки</h2></div><button className="overflow-trigger" type="button" aria-label="Действия с абонементом">•••</button></header>
              <div className="finance-package-summary"><p><span>Осталось занятий</span><strong>2 из 10</strong></p><p><span>Оплата</span><strong>10 000 ₽</strong><small>Оплачен частично · из 25 000 ₽</small></p></div>
              <div className="finance-package-meta"><span>С 1 по 30 сентября 2026 г.</span><strong className="is-overdue">К оплате 15 000 ₽</strong></div>
              <details className="finance-disclosure"><summary><span>Оплаты</span><small>2</small></summary><div className="finance-disclosure-content"><button type="button" className="secondary finance-inline-action">Добавить оплату</button><div className="finance-payment-list"><div className="finance-payment"><div><strong>5 000 ₽</strong><span>1 сентября 2026 г.</span></div></div><div className="finance-payment"><div><strong>5 000 ₽</strong><span>15 сентября 2026 г.</span></div></div></div></div></details>
            </article>
          </div>
          <details className="finance-sessions finance-disclosure card"><summary><span>Проведённые занятия</span><small>8</small></summary><div className="finance-disclosure-content"><button type="button" className="secondary finance-inline-action">Добавить занятие</button></div></details>
          <details className="finance-history finance-disclosure card"><summary><span>Прошлые абонементы</span><small>4</small></summary><div className="finance-disclosure-content"><p className="finance-empty">История абонементов</p></div></details>
        </main>
      </div>
      <nav className="tab-bar trainer-tab-bar" aria-label="Основная навигация">
        <a href="/today"><TodayIcon />Сегодня</a><a href="/clients" className="active" aria-current="page"><ClientsIcon />Клиенты</a><a href="/assistant"><AssistantIcon />Ассистент</a><a href="/schedule"><ScheduleIcon />Расписание</a>
      </nav>
    </div>
  </MemoryRouter>
}

export function mountFinanceClientHarness() {
  const original = document.getElementById('root')
  if (original) original.style.display = 'none'
  const mount = document.createElement('div')
  mount.id = 'finance-client-qa'
  document.body.append(mount)
  createRoot(mount).render(<Harness />)
}
