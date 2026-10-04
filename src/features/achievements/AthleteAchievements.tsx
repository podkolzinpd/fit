import { useCallback, useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { useDataBackend } from '../../app/data-backend-context'
import { achievementProgressLabel, computeAthleteAchievements, latestAthleteAchievement, type AthleteAchievement, type AchievementKind } from '../../shared/athlete-achievements'
import type { Workout } from '../../shared/domain'
import { formatLocalDate, todayInTimeZone } from '../../shared/local-date'
import { CloseIcon } from '../../shared/icons'
import { Page } from '../../shared/ui'
import { achievementArt } from './achievement-art'
import { showAchievementProgress } from './achievement-presentation'

const DISMISSED_KEY = 'fit.athlete-achievements-dismissed.'

type HomePreference = { dismissedId: string | null; dismissedAt: string | null; reopenedIds: string[] }
const emptyPreference: HomePreference = { dismissedId: null, dismissedAt: null, reopenedIds: [] }
const achievementGroups: readonly { title: string; kinds: readonly AchievementKind[] }[] = [
  { title: 'Тренировки', kinds: ['workouts'] },
  { title: 'Регулярность', kinds: ['weeks', 'weeks-total', 'comeback', 'rhythm', 'three-weekly', 'flexible', 'month-days', 'active-months', 'comeback-rhythm'] },
  { title: 'Планка', kinds: ['plank'] },
  { title: 'Вес за тренировку', kinds: ['workout-tonnage'] },
  { title: 'Вес за всё время', kinds: ['lifetime-tonnage'] },
  { title: 'Общая дистанция', kinds: ['distance'] },
  { title: 'Бег', kinds: ['run-single', 'run-total', 'run-workouts'] },
  { title: 'Велотренажёр', kinds: ['bike-workouts'] },
  { title: 'Гребной тренажёр', kinds: ['row-workouts'] },
  { title: 'Эллипс', kinds: ['ellipse-workouts'] },
  { title: 'Скакалка', kinds: ['rope-reps'] },
  { title: 'Отжимания', kinds: ['push-reps'] },
  { title: 'Подтягивания', kinds: ['pull-reps'] },
  { title: 'Кардио', kinds: ['cardio'] },
  { title: 'Личные рекорды', kinds: ['records', 'record-exercises'] },
  { title: 'Разные упражнения', kinds: ['variety'] },
  { title: 'Разнообразие', kinds: ['versatile', 'strength-endurance', 'movement-balance', 'cardio-choice', 'equipment-variety', 'four-seasons'] },
]

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

function Badge({ item, compact = false }: { item: AthleteAchievement; compact?: boolean; priority?: boolean }) {
  const earned = Boolean(item.earnedOn)
  const ratio = earned ? 1 : 0
  const status = earned ? 'получена' : item.kind === 'comeback' ? 'пока не получена' : achievementProgressLabel(item)
  const art = achievementArt[item.id]
  const calendar = item.kind === 'weeks' || item.kind === 'weeks-total'
  const record = item.kind === 'records'
  const recordFive = item.id === 'records-5'
  const showNumber = item.kind !== 'comeback' && item.id !== 'records-1'
  return <span className={`athlete-achievement-badge kind-${item.kind} badge-id-${item.id}${earned ? ' is-earned' : ''}${item.nearest ? ' is-nearest' : ''}${compact ? ' is-compact' : ''}${art ? ` has-static-art art-${art.crop}` : ''}`} role="img" aria-label={`${item.title}: ${status}`}>
    {art ? <span className={`athlete-achievement-static-art${art.expansion ? ' is-expansion' : ''}`} aria-hidden="true" style={{ backgroundPosition: `${art.column * (art.expansion ? 100 / 7 : 20)}% ${art.row * (art.expansion ? 100 / 6 : 20)}%` }} /> :
    <svg className="athlete-achievement-art" viewBox="0 0 100 100" aria-hidden="true">
      <circle className="athlete-achievement-ring-track" cx="50" cy="50" r="40" />
      {ratio > 0 && <circle className="athlete-achievement-ring-fill" cx="50" cy="50" r="40" pathLength="100" strokeDasharray={`${ratio * 100} 100`} transform="rotate(-90 50 50)" />}
      {calendar && <g className="athlete-achievement-calendar">
        <rect x="39" y="22" width="22" height="19" rx="3" />
        <path d="M39 28h22M44 19v6M56 19v6" />
        <path className="athlete-achievement-calendar-dots" d="M44 33h3M53 33h3M44 37h3M53 37h3" />
      </g>}
      {item.kind === 'comeback' && <g className="athlete-achievement-comeback">
        <path d="M30 67V54c0-11 7-18 18-18h14m-9-10 10 10-10 10" />
        <path className="athlete-achievement-comeback-accent" d="M30 67h10" />
      </g>}
      {record && <g className={`athlete-achievement-record${recordFive ? ' is-five' : ''}`}>
        {recordFive ? <path d="M37 76v-7h6v7m4 0V65h6v11m4 0V60h6v16" /> : <>
          <path d="M31 72V60h8v12m4 0V52h8v20m4 0V44h8v28" />
          <path className="athlete-achievement-record-star" d="m70 33 2 5 5 2-5 2-2 5-2-5-5-2 5-2z" />
        </>}
      </g>}
      {showNumber && <text className={`athlete-achievement-number${item.threshold >= 100 ? ' is-three-digit' : item.threshold >= 10 ? ' is-two-digit' : ''}${calendar ? ' is-calendar' : ''}${recordFive ? ' is-record-five' : ''}`} x="50" y={recordFive ? 36 : calendar ? 66 : 53} textAnchor="middle" dominantBaseline="middle">{item.threshold}</text>}
      {earned && <g className="athlete-achievement-check"><circle cx="80" cy="17" r="10" /><path d="m75 17 4 4 7-8" /></g>}
    </svg>}
  </span>
}

function AchievementDetail({ item, onClose, returnFocusTo }: { item: AthleteAchievement; onClose: () => void; returnFocusTo: RefObject<HTMLButtonElement | null> }) {
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
      if (event.key === 'Tab') { event.preventDefault(); closeRef.current?.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown); returnFocusTo.current?.focus() }
  }, [onClose, returnFocusTo])

  const host = document.querySelector('.phone-frame') ?? document.body
  return createPortal(<div className="athlete-achievement-detail-overlay" onClick={onClose}>
    <section className="athlete-achievement-detail" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(event) => event.stopPropagation()}>
      <div className="athlete-achievement-detail-heading"><h2 id={titleId}>{item.title}</h2><button ref={closeRef} type="button" aria-label="Закрыть подробности ачивки" onClick={onClose}><CloseIcon /></button></div>
      <Badge item={item} priority />
      <p>{item.description}</p>
      {item.kind === 'month-days' && <p>В этом месяце: {achievementProgressLabel({ ...item, progress: item.currentPeriodProgress ?? 0 })}<br />Получений: {item.earnedCount ?? 0}{item.lastEarnedOn ? ` · Последнее: ${formatLocalDate(item.lastEarnedOn)}` : ''}</p>}
      <strong>{item.earnedOn ? `Получена ${formatLocalDate(item.earnedOn)}` : item.kind === 'comeback' ? 'Пока не получена' : `Прогресс: ${achievementProgressLabel(item)}`}</strong>
    </section>
  </div>, host)
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
    {!items ? <LoadState loading={loading} error={error} retry={onRetry} /> : featured && <div className="athlete-achievements-home-content"><Badge item={featured} priority /><div><strong>{featured.title}</strong><p>{latest ? `Получена ${formatLocalDate((latest.lastEarnedOn ?? latest.earnedOn)!)}` : `До первой ачивки: ${achievementProgressLabel(featured)}`}</p><Link to="/me/achievements">Все ачивки →</Link></div></div>}
  </section>
}

export function AthleteAchievementPreview({ clientId }: { clientId: string }) {
  const { query, achievements } = useAchievements(clientId)
  const earned = achievements?.filter((item) => item.earnedOn).sort((a, b) => b.earnedAt!.localeCompare(a.earnedAt!)) ?? []
  const visible = earned.length ? earned.slice(0, 3) : achievements?.slice(0, 1) ?? []
  return <section className="athlete-achievements-preview" aria-labelledby="athlete-achievements-preview-title">
    <div className="athlete-achievements-heading"><h2 id="athlete-achievements-preview-title">Ачивки</h2>{achievements && <span>{earned.length} из {achievements.length}</span>}</div>
    {!achievements ? <LoadState loading={query.isLoading} error={query.error} retry={() => void query.refetch()} /> : <><div className="athlete-achievements-preview-badges">{visible.map((item) => <Badge key={item.id} item={item} compact priority />)}</div><Link to="/me/achievements">Все ачивки →</Link></>}
  </section>
}

export function AthleteAchievementsPage() {
  const [selected, setSelected] = useState<AthleteAchievement | null>(null)
  const selectedButton = useRef<HTMLButtonElement>(null)
  const closeSelected = useCallback(() => setSelected(null), [])
  const { clients: clientsRepository } = useDataBackend()
  const mine = useQuery({ queryKey: ['my-client'], queryFn: () => clientsRepository.getMine() })
  const { query, achievements } = useAchievements(mine.data?.id)
  const earned = achievements?.filter((item) => item.earnedOn).length ?? 0
  return <Page className="athlete-achievements-page" title="Все ачивки" back="/me/progress">
    {mine.isLoading ? <LoadState loading error={null} retry={() => void mine.refetch()} /> : mine.error ? <LoadState loading={false} error={mine.error} retry={() => void mine.refetch()} /> : !mine.data ? <p>Заполните профиль спортсмена, чтобы видеть ачивки.</p> : !achievements ? <LoadState loading={query.isLoading} error={query.error} retry={() => void query.refetch()} /> : <>
      <p className="athlete-achievements-count">Получено {earned} из {achievements.length}</p>
      {achievementGroups.map((group) => <section className="athlete-achievements-group" key={group.title} aria-label={group.title}>
        <h2>{group.title}</h2>
        <div className="athlete-achievements-grid">{achievements.filter((item) => group.kinds.includes(item.kind)).sort((a, b) => group.kinds.indexOf(a.kind) - group.kinds.indexOf(b.kind) || a.threshold - b.threshold).map((item, index) => <button className="athlete-achievement-card" type="button" key={item.id} onClick={(event) => { selectedButton.current = event.currentTarget; setSelected(item) }} aria-label={`${item.title}. ${item.earnedOn ? (item.earnedCount ? `Получений: ${item.earnedCount}` : 'Получена') : item.kind === 'comeback' ? 'Пока не получена' : `Прогресс: ${achievementProgressLabel(item)}`}. Открыть подробности`}>
          <Badge item={item} priority={group.title === 'Тренировки' && index < 6} />
          <span className={`athlete-achievement-progress-slot${showAchievementProgress(item) ? '' : ' is-empty'}`} aria-hidden={!showAchievementProgress(item)}>
            {showAchievementProgress(item) && <>
              <span className="athlete-achievement-progress-track"><span style={{ width: `${Math.min(100, item.progress / item.threshold * 100)}%` }} /></span>
              <span className="athlete-achievement-progress-label">{achievementProgressLabel(item)}</span>
            </>}
          </span>
          <span className="athlete-achievement-card-title">{item.title}</span>
          {item.earnedCount && <span className="athlete-achievement-repeat">×{item.earnedCount}</span>}
        </button>)}</div>
      </section>)}
      {selected && <AchievementDetail item={selected} onClose={closeSelected} returnFocusTo={selectedButton} />}
    </>}
  </Page>
}

export function NewlyEarnedAchievements({ items }: { items: readonly AthleteAchievement[] }) {
  if (!items.length) return null
  return <section className="athlete-achievements-new" aria-label="Новые ачивки"><h2>{items.length === 1 ? 'Новая ачивка' : 'Новые ачивки'}</h2><div>{items.map((item) => <div key={item.id}><Badge item={item} compact priority /><strong>{item.title}</strong></div>)}</div><Link to="/me/achievements">Все ачивки →</Link></section>
}
