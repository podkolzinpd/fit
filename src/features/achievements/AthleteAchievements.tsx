import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { useDataBackend } from '../../app/data-backend-context'
import { computeAthleteAchievements, latestAthleteAchievement, type AthleteAchievement } from '../../shared/athlete-achievements'
import type { Workout } from '../../shared/domain'
import { formatLocalDate, todayInTimeZone } from '../../shared/local-date'
import { CloseIcon } from '../../shared/icons'
import { Page } from '../../shared/ui'

const DISMISSED_KEY = 'fit.athlete-achievements-dismissed.'

type HomePreference = { dismissedId: string | null; dismissedAt: string | null; reopenedIds: string[] }
const emptyPreference: HomePreference = { dismissedId: null, dismissedAt: null, reopenedIds: [] }

function readDismissed(userId: string): HomePreference {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(`${DISMISSED_KEY}${userId}`) ?? 'null')
    if (!parsed || typeof parsed !== 'object') return emptyPreference
    const value = parsed as Record<string, unknown>
    return {
      dismissedId: typeof value.dismissedId === 'string' ? value.dismissedId : null,
      dismissedAt: typeof value.dismissedAt === 'string' ? value.dismissedAt : null,
      reopenedIds: Array.isArray(value.reopenedIds) ? value.reopenedIds.filter((id): id is string => typeof id === 'string') : [],
    }
  } catch { return emptyPreference }
}

function Badge({ item, compact = false }: { item: AthleteAchievement; compact?: boolean }) {
  const earned = Boolean(item.earnedOn)
  const ratio = earned ? 1 : item.nearest ? item.progress / item.threshold : 0
  return <span className={`athlete-achievement-badge kind-${item.kind}${earned ? ' is-earned' : ''}${item.nearest ? ' is-nearest' : ''}${compact ? ' is-compact' : ''}`} role="img" aria-label={`${item.title}: ${earned ? 'получена' : `${item.progress} из ${item.threshold}`}`}>
    <svg className="athlete-achievement-ring" viewBox="0 0 100 100" aria-hidden="true">
      <circle className="athlete-achievement-ring-track" cx="50" cy="50" r="40" />
      {ratio > 0 && <circle className="athlete-achievement-ring-fill" cx="50" cy="50" r="40" strokeDasharray={`${ratio * 251.33} 251.33`} />}
    </svg>
    {item.kind === 'weeks'
      ? <svg className="athlete-achievement-calendar" viewBox="0 0 48 48" aria-hidden="true"><rect x="5" y="9" width="38" height="33" rx="7" /><path d="M5 19h38M15 5v9M33 5v9" /><path className="athlete-achievement-calendar-dots" d="M13 27h5M23 27h5M33 27h3M13 35h5M23 35h5M33 35h3" /></svg>
      : <span className="athlete-achievement-check" aria-hidden="true">✓</span>}
    <strong>{item.threshold}</strong>
  </span>
}

function useAchievements(clientId: string | undefined) {
  const { workouts: repository } = useDataBackend()
  const { actor } = useAuth()
  const query = useQuery({ queryKey: ['workouts', clientId], queryFn: () => repository.list(undefined, undefined, clientId!), enabled: Boolean(clientId) })
  const achievements = useMemo(() => query.data ? computeAthleteAchievements(query.data, todayInTimeZone(actor?.timezone), actor?.timezone) : null, [query.data, actor?.timezone])
  return { query, achievements }
}

function LoadState({ error, loading, retry }: { error: Error | null; loading: boolean; retry: () => void }) {
  if (loading) return <p className="athlete-achievements-state" role="status">Загружаем ачивки…</p>
  if (error) return <div className="athlete-achievements-state" role="alert"><p>Не удалось загрузить историю тренировок.</p><button type="button" onClick={retry}>Повторить</button></div>
  return null
}

export function AthleteAchievementHome({ workouts, loading, error, onRetry }: { workouts: Workout[] | undefined; loading: boolean; error: Error | null; onRetry: () => void }) {
  const { actor } = useAuth()
  const [dismissed, setDismissed] = useState(() => actor ? readDismissed(actor.userId) : emptyPreference)
  const items = useMemo(() => workouts ? computeAthleteAchievements(workouts, todayInTimeZone(actor?.timezone), actor?.timezone) : null, [workouts, actor?.timezone])
  const latest = items && latestAthleteAchievement(items)
  const featured = latest ?? items?.[0]
  const reopened = Boolean(featured?.earnedAt && dismissed.dismissedId && featured.id !== dismissed.dismissedId
    && dismissed.dismissedAt && Date.parse(featured.earnedAt) > Date.parse(dismissed.dismissedAt)
    && !dismissed.reopenedIds.includes(featured.id))
  const visible = !actor || !featured || !dismissed.dismissedId || reopened
  useEffect(() => {
    if (!actor || !featured || !reopened) return
    const next = { ...dismissed, reopenedIds: [...dismissed.reopenedIds, featured.id] }
    try { localStorage.setItem(`${DISMISSED_KEY}${actor.userId}`, JSON.stringify(next)) } catch { /* Private browsing. */ }
  }, [actor, dismissed, featured, reopened])
  function close() {
    if (!actor || !featured) return
    const next = { ...dismissed, dismissedId: featured.id, dismissedAt: new Date().toISOString() }
    setDismissed(next)
    try { localStorage.setItem(`${DISMISSED_KEY}${actor.userId}`, JSON.stringify(next)) } catch { /* Private browsing: dismiss for this view. */ }
  }
  if (!visible) return null
  return <section className="athlete-achievements-home" aria-labelledby="athlete-achievements-home-title">
    <div className="athlete-achievements-heading"><h2 id="athlete-achievements-home-title">Ачивки</h2>{featured && <button type="button" className="athlete-achievements-close" aria-label="Скрыть карточку ачивок" onClick={close}><CloseIcon /></button>}</div>
    {!items ? <LoadState loading={loading} error={error} retry={onRetry} /> : featured && <div className="athlete-achievements-home-content"><Badge item={featured} /><div><strong>{featured.title}</strong><p>{latest ? `Получена ${formatLocalDate(latest.earnedOn!)}` : `До первой ачивки: ${featured.progress} из ${featured.threshold}`}</p><Link to="/me/achievements">Все ачивки →</Link></div></div>}
  </section>
}

export function AthleteAchievementPreview({ clientId }: { clientId: string }) {
  const { query, achievements } = useAchievements(clientId)
  const earned = achievements?.filter((item) => item.earnedOn) ?? []
  const visible = earned.length ? earned.slice(-3) : achievements?.slice(0, 1) ?? []
  return <section className="athlete-achievements-preview" aria-labelledby="athlete-achievements-preview-title">
    <div className="athlete-achievements-heading"><h2 id="athlete-achievements-preview-title">Ачивки</h2>{achievements && <span>{earned.length} из 8</span>}</div>
    {!achievements ? <LoadState loading={query.isLoading} error={query.error} retry={() => void query.refetch()} /> : <><div className="athlete-achievements-preview-badges">{visible.map((item) => <Badge key={item.id} item={item} compact />)}</div><Link to="/me/achievements">Все ачивки →</Link></>}
  </section>
}

export function AthleteAchievementsPage() {
  const { clients: clientsRepository } = useDataBackend()
  const mine = useQuery({ queryKey: ['my-client'], queryFn: () => clientsRepository.getMine() })
  const { query, achievements } = useAchievements(mine.data?.id)
  const earned = achievements?.filter((item) => item.earnedOn).length ?? 0
  return <Page className="athlete-achievements-page" title="Все ачивки" back="/me/progress">
    {mine.isLoading ? <LoadState loading error={null} retry={() => void mine.refetch()} /> : mine.error ? <LoadState loading={false} error={mine.error} retry={() => void mine.refetch()} /> : !mine.data ? <p>Заполните профиль спортсмена, чтобы видеть ачивки.</p> : !achievements ? <LoadState loading={query.isLoading} error={query.error} retry={() => void query.refetch()} /> : <>
      <p className="athlete-achievements-count">Получено {earned} из 8</p>
      {(['workouts', 'weeks'] as const).map((kind) => <section className="athlete-achievements-group" key={kind} aria-label={kind === 'workouts' ? 'Тренировки' : 'Регулярность'}>
        <h2>{kind === 'workouts' ? 'Тренировки' : 'Регулярность'}</h2>
        <div className="athlete-achievements-grid">{achievements.filter((item) => item.kind === kind).map((item) => <article className="athlete-achievement-card" key={item.id}>
          <Badge item={item} />
          <div><h3>{item.title}</h3><p>{item.description}</p><small>{item.earnedOn ? `Получена ${formatLocalDate(item.earnedOn)}` : item.nearest ? `${item.progress} из ${item.threshold}` : 'Пока не получена'}</small></div>
        </article>)}</div>
      </section>)}
    </>}
  </Page>
}

export function NewlyEarnedAchievements({ items }: { items: readonly AthleteAchievement[] }) {
  if (!items.length) return null
  return <section className="athlete-achievements-new" aria-label="Новые ачивки"><h2>{items.length === 1 ? 'Новая ачивка' : 'Новые ачивки'}</h2><div>{items.map((item) => <div key={item.id}><Badge item={item} compact /><strong>{item.title}</strong></div>)}</div><Link to="/me/achievements">Все ачивки →</Link></section>
}
