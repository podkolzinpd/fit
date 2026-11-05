import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useAuth } from '../../app/auth-context'
import { useAppTheme } from '../../app/theme'
import { loadPrivateAnalytics, type AnalyticsRow as Row } from '../../data/repositories/private-analytics.repository'
import '../corporate-admin/corporate-admin.css'
import './private-analytics.css'

const sum = (rows: Row[], key: string) => rows.reduce((total, row) => total + (typeof row[key] === 'number' ? row[key] : 0), 0)
const format = (value: unknown) => value === null || value === undefined ? '—' : typeof value === 'boolean' ? (value ? 'Да' : 'Нет') : String(value)

function DataTable({ title, rows, columns }: { title: string; rows: Row[]; columns: string[] }) {
  return <section><h2>{title}</h2><div className="private-analytics-table"><table><thead><tr>{columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
    <tbody>{rows.map((row, index) => <tr key={String(row.id ?? row.client_id ?? row.trainer_id ?? index)}>{columns.map(c => <td key={c}>{format(row[c])}</td>)}</tr>)}</tbody></table></div></section>
}

function Breakdown({ title, items }: { title: string; items: Array<{ label: string; value: number }> }) {
  const max = Math.max(...items.map(item => item.value), 1)
  const total = items.reduce((acc, item) => acc + item.value, 0)
  return <section><h2>{title}</h2><div className="private-analytics-bars">{items.map(item => <div key={item.label}>
    <span>{item.label}</span><div className="private-analytics-bar"><i style={{ width: `${item.value / max * 100}%` }} /></div><strong>{item.value} {total > 0 && <small>({Math.round(item.value / total * 100)}%)</small>}</strong>
  </div>)}</div></section>
}

function RegistrationTrend({ title, rows }: { title: string; rows: Row[] }) {
  const counts = new Map<string, number>()
  for (const row of rows) {
    if (typeof row.registered_at !== 'string') continue
    const day = row.registered_at.slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(`${day}T00:00:00Z`))) continue
    counts.set(day, (counts.get(day) ?? 0) + 1)
  }
  const keys = [...counts.keys()].sort()
  const days: Array<[string, number]> = []
  if (keys.length) {
    const first = Date.parse(`${keys[0]}T00:00:00Z`), last = Date.parse(`${keys.at(-1)}T00:00:00Z`)
    for (let time = first; time <= last; time += 86_400_000) {
      const day = new Date(time).toISOString().slice(0, 10)
      days.push([day, counts.get(day) ?? 0])
    }
  }
  const max = Math.max(...days.map(([, count]) => count), 1)
  const width = Math.max(320, days.length * 22)
  return <section><h2>{title}</h2>{days.length ? <>
    <div className="private-analytics-chart"><svg role="img" aria-label={`${title}: количество регистраций по дням`} viewBox={`0 0 ${width} 130`} style={{ minWidth: width }}>
      {days.map(([day, count], index) => <rect key={day} x={index * 22 + 3} y={110 - count / max * 100} width="15" height={count / max * 100} fill="#83a900"><title>{day}: {count}</title></rect>)}
      <line x1="0" x2={width} y1="110" y2="110" stroke="currentColor" />
      <text x="0" y="125" fontSize="10" fill="currentColor">{days[0]?.[0]}</text>
      {days.length > 1 && <text x={width} y="125" textAnchor="end" fontSize="10" fill="currentColor">{days.at(-1)?.[0]}</text>}
    </svg></div>
    <details><summary>Данные по дням</summary><div className="private-analytics-trend">{days.map(([day, count]) => <div key={day}><span>{day}</span><strong>{count}</strong></div>)}</div></details>
  </> : <p>Регистраций нет.</p>}</section>
}

export function PrivateAnalyticsPage() {
  const { actor } = useAuth()
  const theme = useAppTheme()
  const [registration, setRegistration] = useState('all')
  const query = useQuery({ queryKey: ['private-analytics', actor?.userId], queryFn: loadPrivateAnalytics, enabled: Boolean(actor), retry: false, gcTime: 0, staleTime: 0 })
  const data = query.data
  const clients = data?.clients.filter(row => registration === 'all' || row.is_self_registered === (registration === 'self')) ?? []
  return <main className={`corporate-admin-shell ui-identity ym-hide-content ${theme === 'light' ? 'theme-light' : ''}`}><div className="page private-analytics">
    <header className="private-analytics-header"><h1>Аналитика Fit</h1><button type="button" onClick={() => void query.refetch()} disabled={query.isFetching}>Обновить</button></header>
    {query.isPending && <p>Загружаем аналитику…</p>}
    {query.error && <p role="alert">{query.error.message}</p>}
    {data && !query.error && <>
      <p>Обновлено: {new Date(data.computedAt).toLocaleString('ru-RU')}</p>
      <div className="private-analytics-cards">
        <div><span>Тренеры</span><strong>{data.trainersTotal}</strong></div>
        <div><span>Клиенты</span><strong>{clients.length}</strong></div>
        <div><span>Клиенты у тренеров</span><strong>{sum(data.trainers, 'clients_total')}</strong></div>
        <div><span>Тренировки у тренеров</span><strong>{sum(data.trainers, 'workouts_total')}</strong></div>
      </div>
      <section><h2>Тренеры</h2><div className="private-analytics-cards">{['new', 'active', 'not_active'].map(status => <div key={status}><span>{status === 'new' ? 'Новые' : status === 'active' ? 'Активные' : 'Неактивные'}</span><strong>{data.trainers.filter(row => row.trainer_status === status).length}</strong></div>)}</div></section>
      <RegistrationTrend title="Регистрации тренеров по дням" rows={data.trainers} />
      <Breakdown title="Клиенты тренеров в приложении" items={[{label:'Подключены', value:sum(data.trainers, 'clients_app_linked')}, {label:'Не подключены', value:sum(data.trainers, 'clients_total') - sum(data.trainers, 'clients_app_linked')}]} />
      <Breakdown title="Клиенты тренеров: активные и архивные" items={[{label:'Активные', value:sum(data.trainers, 'clients_total') - sum(data.trainers, 'clients_archived')}, {label:'Архивные', value:sum(data.trainers, 'clients_archived')}]} />
      <Breakdown title="Статус тренировок у тренеров" items={[{label:'Запланированы',value:sum(data.trainers,'workouts_planned')},{label:'В процессе',value:sum(data.trainers,'workouts_in_progress')},{label:'Проведены',value:sum(data.trainers,'workouts_done')}]} />
      <div className="private-analytics-cards">
        <div><span>Тренеры с зафиксированной активностью</span><strong>{data.trainers.filter(row => row.is_test_account === false && row.last_active_at != null).length}</strong></div>
        <div><span>Проведённые тренировки этих тренеров</span><strong>{sum(data.trainers.filter(row => row.is_test_account === false && row.last_active_at != null), 'workouts_done')}</strong></div>
      </div>
      <DataTable title="Данные тренеров" rows={data.trainers} columns={['trainer_status', 'trainer_id', 'registered_at', 'last_active_at', 'last_sign_in_at', 'days_since_last_activity', 'clients_added_30d', 'clients_added_7d', 'clients_total', 'clients_app_linked', 'clients_archived', 'last_workout_at', 'workouts_done_7d_by_client', 'workouts_done_7d_by_trainer', 'workouts_total', 'workouts_planned', 'workouts_in_progress', 'workouts_done', 'workouts_cancelled_total', 'assistant_messages_total', 'last_assistant_message_at', 'clients_with_notes_total', 'last_client_notes_at', 'custom_exercises_total', 'last_custom_exercise_at', 'exercises_unique_used', 'goals_created_total', 'last_goal_activity_at', 'progress_entries_total', 'last_progress_entry_at', 'summaries_published_total', 'last_summary_published_at']} />
      <section><h2>Клиенты</h2><label>Регистрация <select value={registration} onChange={event => setRegistration(event.target.value)}><option value="all">Все</option><option value="self">Самостоятельно</option><option value="trainer">Тренером</option></select></label></section>
      <RegistrationTrend title="Регистрации клиентов по дням" rows={clients} />
      <Breakdown title="Регистрация клиентов" items={[{label:'Самостоятельно',value:clients.filter(row => row.is_self_registered === true).length},{label:'Тренером',value:clients.filter(row => row.is_self_registered === false).length}]} />
      <Breakdown title="Статус клиентов" items={[{label:'Новые',value:clients.filter(row => row.client_status === 'new').length},{label:'Активные',value:clients.filter(row => row.client_status === 'active').length},{label:'Неактивные',value:clients.filter(row => row.client_status === 'not_active').length}]} />
      <div className="private-analytics-cards"><div><span>Тренировки клиентов</span><strong>{sum(clients, 'workouts_total')}</strong></div></div>
      <Breakdown title="Статус тренировок клиентов" items={[{label:'Запланированы',value:sum(clients,'workouts_planned')},{label:'В процессе',value:sum(clients,'workouts_in_progress')},{label:'Проведены',value:sum(clients,'workouts_done')}]} />
      <DataTable title="Данные клиентов" rows={clients} columns={['registered_at', 'last_sign_in_at', 'client_id', 'client_status', 'last_client_activity_at', 'days_since_last_activity', 'is_self_registered', 'is_test_account', 'workouts_total', 'workouts_done', 'workouts_in_progress', 'workouts_planned', 'questions_asked_total', 'last_question_asked_at', 'goals_created_total', 'last_goal_activity_at', 'custom_exercises_total', 'last_custom_exercise_at', 'connection_changes_total', 'last_connection_change_at']} />
      <DataTable title="Обратная связь" rows={data.feedback} columns={['id', 'message', 'account_role', 'created_at', 'display_mode', 'email', 'kind', 'screen_path']} />
    </>}
  </div></main>
}
