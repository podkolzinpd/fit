import { invalidateWorkoutResults } from '../../app/invalidate-workout-results'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { currentStage, orderedStages } from '../../shared/goal-rules'
import { copiedExerciseName } from '../../shared/exercise-catalog-curation'
import { AxisTick, computeYDomain, formatTooltipLabel, formatTooltipValue, renderChartDot } from '../progress/ProgressChart'
import { readLiveRestOverrides, restDeadline, restoreRestDeadline, storeRestDeadline } from './rest-timer-storage'
import { blockLabel, chartUnitFor, compactCompletedSetSummary, compactExerciseDetailSummary, compactPlannedSetSummary, completedWorkoutDraft, copyWorkout, createRunningFormatDrafts, durationLabel, durationSeconds, exerciseSummary, factLine, favoriteTemplateToWorkoutDraft, formatFactVsPlan, groupIntoBlocks, blockRoundsView, currentRoundIndex, muscleGroupLabels, performedMuscleGroupLabels, previousResultLine, replaceExercise, restSecondsAfterSet, splitClientWorkouts, tonnageLabel, workoutFocusTitle, workoutStatusPresentation, workoutDurationLabel, workoutToFavoriteTemplate, workoutTonnage, type PreviousExerciseResult } from '../../data/repositories/workouts.repository'
import type { ExerciseProgressCursor, ExerciseSnapshot, LiveSetDraft, TrainerReaction, Workout, WorkoutDraft, WorkoutExercise as WorkoutExerciseModel, WorkoutFeedbackDraft, WorkoutQuestionAnswerDraft, WorkoutSet, WorkoutTrainerResponseDraft, WorkoutWellbeing } from '../../shared/domain'
import { LiveRestTimer } from './LiveRestTimer'
import { cancelNativeRestTimerNotification, scheduleNativeRestTimerNotification } from './rest-timer-notification'
import {
  addDays, currentTimeInTimeZone, dayOfMonth, daysBetween, formatLocalDate, formatMonth, formatWeekRange, localDate, todayInTimeZone, weekdayShort,
  type LocalDate,
} from '../../shared/local-date'
import { AsyncView, Coachmark, EmptyState, Field, OverflowMenu, Page, SaveStatus, StatePanel, useConfirm } from '../../shared/ui'
import { ExerciseImage, ExercisePicker, ExerciseTechniqueSheet, ExerciseThumbnail, findCatalogExercise, hasExerciseAnimation, hasExerciseMedia, hasExerciseTechnique, recentExercisesForClient, useExerciseCatalog } from '../exercises'
import { clientWorkoutAuthorLabel, ClientPicker, ClientWorkoutHistoryCalendar, useWorkoutHistoryCalendar, type ClientPickerSelection } from '../clients'
import { hasWorkoutBackEntry, safeWorkoutReturnTo, useWorkoutBack, workoutListFallback, type WorkoutNavigationState } from './workout-navigation'
import { VoiceNoteField } from '../voice-input'
import { QuickWorkoutEntry } from './QuickWorkoutEntry'
import { WorkoutExerciseEditor } from './WorkoutExerciseEditor'
import { RPE_OPTIONS } from '../../shared/rpe'
import type { RunningFormat } from '../../shared/running-formats'
import type { ParsedWorkoutExercise } from './quick-workout-entry'
import { createLiveSetCoordinator } from './live-set-coordinator'
import { createLiveSetAutosave } from './live-set-autosave'
import { applyLiveSetConfirmation, applyLiveSetDraft, carriedLiveWeightKey, reconcileLiveWorkout, sameLiveSetDraft, setWithCarriedLiveWeight } from './live-set-cache'
import { clearPendingLiveSetDrafts, readPendingLiveSetDrafts, removePendingLiveSetDraft, writePendingLiveSetDraft } from './live-set-draft-storage'
import { createLiveWorkoutCoordinator, liveWorkoutRecoveryError } from './live-workout-coordinator'
import { setLiveScreenAwake } from './live-keep-awake'
import { LoadMoreButton } from './LoadMoreButton'
import { workoutCountLabel } from './workout-count-label'
import { useAuth } from '../../app/auth-context'
import { useDataBackend } from '../../app/data-backend-context'
import { useExercisePlanRestDisplay } from '../../app/exercise-plan-display'
import { useLiveExerciseAnimation } from '../../app/live-exercise-animation'
import { useRpeDisplay } from '../../app/rpe-display'
import { useClientRealtime } from '../../app/use-client-realtime'
import { prepareGong } from '../../shared/gong'
import { readWorkoutFormDraft, removeWorkoutFormDraft, workoutFormDraftKey, writeWorkoutFormDraft } from './workout-form-draft'
import { plannedWorkoutActionLabels } from './workout-entry-rules'
import { WorkoutSetTable } from './WorkoutSetTable'
import { RunMetricsFields } from './RunMetricsFields'
import { isRowingExerciseRef, parseRunDurationInput, rowingPaceLabel, runDistanceKmFromInput, runDistanceLabel, runPaceLabel, type RunDistanceUnit } from '../../shared/run-metrics'
import { WorkoutExerciseHeader } from './WorkoutExerciseHeader'
import { ExerciseProgressHistory, ExerciseProgressSummary } from './ExerciseProgressSummary'
import { WorkoutCompletionCard } from './WorkoutCompletionCard'
import { WorkoutCompletionReport } from './WorkoutCompletionReport'
import { AddIcon, ArrowDownIcon, ArrowUpIcon, BackIcon, BellIcon, CheckIcon, ChevronRightIcon, CloseIcon, CopyIcon, HistoryIcon, MessageIcon, RecordIcon, ScheduleIcon, SettingsIcon } from '../../shared/icons'
import { workoutVolumeComparison } from './workout-completion-insights'
import { WorkoutChoice, WorkoutCta, WorkoutExercise, WorkoutExerciseCompact, WorkoutHeader, WorkoutRpeScale, WorkoutSetRow, WorkoutStatus, type WorkoutUiState } from './WorkoutSurface'
import { liveSessionProgress } from './live-session-progress'
import { chronicleExercisePreview } from './workout-chronicle'
import { compactScheduleEventLabel, formatScheduleDateLabel, mondayWeekStart, scheduleEventStatus, scheduleExerciseLine, scheduleFocusMinutes, scheduleHourLabelCollidesWithNow, scheduleTimelineScrollTop } from './schedule-presentation'
import { InvitationCodeCard } from '../../shared/invitation-code-card'
import { trackGoal } from '../../shared/yandex-metrika'
import { latestWorkoutFact } from '../../shared/workout-results'
import { liveOperationWithTimeout } from './live-operation-timeout'
import { workoutFeedbackConfirmation } from './workout-feedback-copy'
import { clearWorkoutInactivityReminder } from './workout-inactivity-reminder'
import { useWorkoutInactivityReminder } from './use-workout-inactivity-reminder'
import { LiveExerciseTechnique } from './LiveExerciseTechnique'
import { useAppViewport } from '../../app/app-viewport'
import { prepareZeroReplacement } from '../../shared/numeric-input'
import { isTrainerScheduleV2Enabled } from '../../app/trainer-schedule-v2'
import { useTrainerWorkspace } from './use-trainer-workspace'
import { useChatThreads } from '../chat/use-chat-threads'
import { useYandexAppSession } from '../../app/yandex-app-session-context'
import { getYandexAppSessionEntryConfig } from '../../app/feature-flags'
import { yandexPilotRepository } from '../../data/repositories/yandex-pilot.repository'

const HOURS = Array.from({ length: 24 }, (_, index) => index)
const HOUR_HEIGHT = 56
export const WORKOUT_HISTORY_PAGE_SIZE = 20

const LIVE_SET_KEYBOARD_GUTTER = 16

function keepLiveSetFieldVisible(target: HTMLElement) {
  const row = target.closest('.live-set-grid')
  const content = target.closest('.content')
  if (!(row instanceof HTMLElement) || !(content instanceof HTMLElement) || content.clientHeight <= 0) return

  const rowRect = row.getBoundingClientRect()
  const contentRect = content.getBoundingClientRect()
  const visibleTop = contentRect.top + LIVE_SET_KEYBOARD_GUTTER
  const visibleBottom = contentRect.bottom - LIVE_SET_KEYBOARD_GUTTER
  if (rowRect.top >= visibleTop && rowRect.bottom <= visibleBottom) return

  const centeredTop = content.scrollTop
    + rowRect.top
    - contentRect.top
    - Math.max(LIVE_SET_KEYBOARD_GUTTER, (content.clientHeight - rowRect.height) / 2)
  content.scrollTo({ top: Math.max(0, centeredTop), behavior: 'auto' })
}

function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

function eventTime(workout: Workout): string {
  const start = workout.startTime?.slice(0, 5) ?? ''
  if (!workout.endTime) return start
  return `${start}–${workout.endTime.slice(0, 5)}`
}

function safeScheduleDate(value: string | null): LocalDate | null {
  if (!value) return null
  try { return localDate(value) } catch { return null }
}

function useTrainerScheduleModel(forceDayView = false) {
  const { workouts: workoutsRepository } = useDataBackend()
  const [params, setParams] = useSearchParams()
  const { actor } = useAuth()
  const navigate = useNavigate()
  const pilot = isTrainerScheduleV2Enabled(actor)
  const today = todayInTimeZone(actor?.timezone)
  const dateParam = safeScheduleDate(params.get('date'))
  const weekParam = safeScheduleDate(params.get('week'))
  const scheduleRange = params.get('range') === '2w' ? '2w' : 'week'
  const isTwoWeekView = scheduleRange === '2w'
  const isDayView = forceDayView || Boolean(dateParam)
  const overviewDayCount = isTwoWeekView ? 14 : 7
  const selected = dateParam ?? (forceDayView ? today : weekParam ?? today)
  const validWeekStart = weekParam ? mondayWeekStart(weekParam) : null
  const weekStart = validWeekStart && (!isDayView || (daysBetween(validWeekStart, selected) >= 0 && daysBetween(validWeekStart, selected) < overviewDayCount))
    ? validWeekStart : mondayWeekStart(selected)
  const periodEnd = addDays(weekStart, overviewDayCount - 1)
  const todayWeekStart = mondayWeekStart(today)
  const overviewDays = Array.from({ length: overviewDayCount }, (_, offset) => addDays(weekStart, offset))
  const scrollRef = useRef<HTMLDivElement>(null)
  const autoScrolledDateRef = useRef<LocalDate | null>(null)

  function openDay(date: LocalDate, preservePeriodStart?: LocalDate) {
    const anchor = preservePeriodStart ?? (daysBetween(weekStart, date) >= 0 && daysBetween(weekStart, date) < overviewDayCount
      ? weekStart : mondayWeekStart(date))
    const next = new URLSearchParams({ date, week: anchor })
    if (isTwoWeekView) next.set('range', '2w')
    if (pilot) navigate(`/today?${next}`)
    else setParams(next)
  }
  function showOverview(date: LocalDate, range: 'week' | '2w' = scheduleRange) {
    const start = mondayWeekStart(date)
    const next: Record<string, string> = {}
    if (pilot || start !== todayWeekStart) next.week = start
    if (range === '2w') next.range = '2w'
    if (pilot) navigate(`/schedule?${new URLSearchParams(next)}`)
    else setParams(next)
  }
  function shiftOverview(direction: -1 | 1) { showOverview(addDays(weekStart, direction * overviewDayCount)) }

  const query = useQuery({
    queryKey: ['workouts', 'schedule-overview', weekStart, periodEnd],
    queryFn: () => workoutsRepository.list(weekStart, periodEnd),
  })
  const items = query.data ?? []
  const itemsByDay = new Map<LocalDate, Workout[]>()
  for (const day of overviewDays) itemsByDay.set(day, [])
  for (const workout of items) itemsByDay.get(workout.workoutDate)?.push(workout)
  for (const workouts of itemsByDay.values()) {
    workouts.sort((left, right) => {
      if (left.startTime && right.startTime) return minutesOf(left.startTime) - minutesOf(right.startTime)
      if (left.startTime) return -1
      if (right.startTime) return 1
      return left.clientName.localeCompare(right.clientName, 'ru')
    })
  }
  const dayItems = itemsByDay.get(selected) ?? []
  const totalCount = dayItems.length
  const timed = dayItems.filter((workout) => workout.startTime)
  const untimed = dayItems.filter((workout) => !workout.startTime)

  useEffect(() => {
    if (!isDayView) {
      autoScrolledDateRef.current = null
      return
    }
    if (query.isLoading || query.isError || !scrollRef.current || autoScrolledDateRef.current === selected) return
    const focusMinutes = scheduleFocusMinutes(timed, currentTimeInTimeZone(actor?.timezone))
    scrollRef.current.scrollTop = scheduleTimelineScrollTop(
      focusMinutes,
      scrollRef.current.clientHeight,
      HOUR_HEIGHT,
    )
    autoScrolledDateRef.current = selected
  }, [actor?.timezone, isDayView, query.isError, query.isLoading, selected, timed])

  const todayDisabled = isDayView ? selected === today : weekStart === todayWeekStart

  return {
    actor, selected, scheduleRange, isTwoWeekView, isDayView, weekStart,
    overviewDayCount, periodEnd, overviewDays, today, scrollRef, openDay,
    showOverview, shiftOverview, query, itemsByDay, dayItems, totalCount,
    timed, untimed, todayDisabled,
  }
}

export function SchedulePage() {
  const { actor } = useAuth()
  const [claimToken] = useState(() => {
    const match = /^#trainer-schedule-v2=([A-Za-z0-9_-]{43})$/.exec(window.location.hash)
    return match?.[1] ?? null
  })
  if (claimToken !== null && !isTrainerScheduleV2Enabled(actor)) {
    return <TrainerScheduleV2Claim token={claimToken} />
  }
  return isTrainerScheduleV2Enabled(actor) ? <TrainerScheduleV2 /> : <TrainerScheduleV1 />
}

function TrainerScheduleV2Claim({ token }: { token: string }) {
  const { session, retry } = useYandexAppSession()
  const config = getYandexAppSessionEntryConfig()
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (session === null || config === null) return
    let cancelled = false
    setError(null)
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`)
    void yandexPilotRepository.claimTrainerScheduleV2(
      config.apiBaseUrl,
      session.session.token,
      token,
    ).then(() => retry()).catch((caught: unknown) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : 'Не удалось включить новый дизайн.')
    })
    return () => { cancelled = true }
  }, [attempt, config, retry, session, token])

  return <Page title="Новый дизайн расписания">
    <StatePanel
      tone={error === null ? 'info' : 'error'}
      title={error === null ? 'Подключаем дизайн' : 'Не удалось подключить'}
      description={error ?? 'Проверяем учётку тренера и включаем интерфейс только для неё…'}
      action={error === null ? undefined : <button type="button" className="primary" onClick={() => setAttempt((value) => value + 1)}>Повторить</button>}
    />
  </Page>
}

function TrainerScheduleV1() {
  const {
    actor, selected, isTwoWeekView, isDayView, weekStart,
    periodEnd, overviewDays, today, scrollRef, openDay, showOverview,
    shiftOverview, query, itemsByDay, totalCount, timed, untimed, todayDisabled,
  } = useTrainerScheduleModel()

  return <Page className={`schedule-page ${isDayView ? 'schedule-day-view' : 'schedule-week-view'}`} title="Расписание" action={
    <div className="schedule-controls">
      <div className="schedule-month-row">
        <strong>{formatMonth(selected)}</strong>
        <div className="schedule-month-actions">
          <button type="button" className="schedule-today" disabled={todayDisabled} onClick={() => showOverview(today)}>Сегодня</button>
          <label className="schedule-jump" aria-label="Выбрать дату"><ScheduleIcon /><input type="date" value={selected} onChange={(event) => event.target.value && openDay(localDate(event.target.value))} /></label>
        </div>
      </div>
      {isDayView ? <div className="schedule-selected-row">
        <button type="button" className="schedule-week-back" onClick={() => showOverview(weekStart)}><BackIcon />{isTwoWeekView ? 'К 2 неделям' : 'К неделе'}</button>
        <div className="schedule-selected-actions">
          <div className="schedule-selected-date">
            <strong>{formatScheduleDateLabel(selected)}</strong>
            <span>{query.isLoading ? 'Загружаем…' : workoutCountLabel(totalCount)}</span>
          </div>
          <Link className="button secondary schedule-plan" to={`/workouts/new?date=${selected}`}>Запланировать</Link>
        </div>
      </div> : <>
        <div className="schedule-range-toggle" role="group" aria-label="Период расписания">
          <button type="button" aria-pressed={!isTwoWeekView} onClick={() => showOverview(weekStart, 'week')}>Неделя</button>
          <button type="button" aria-pressed={isTwoWeekView} onClick={() => showOverview(weekStart, '2w')}>2 недели</button>
        </div>
        <div className="week-nav schedule-week-navigation">
          <strong>{formatWeekRange(weekStart, periodEnd)}</strong>
          <span className="schedule-week-arrows">
            <button type="button" className="week-arrow" aria-label={isTwoWeekView ? 'Предыдущие 2 недели' : 'Предыдущая неделя'} onClick={() => shiftOverview(-1)}><BackIcon /></button>
            <button type="button" className="week-arrow" aria-label={isTwoWeekView ? 'Следующие 2 недели' : 'Следующая неделя'} onClick={() => shiftOverview(1)}><ChevronRightIcon /></button>
          </span>
        </div>
      </>}
    </div>
  }>
    <AsyncView loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>
      {!isDayView ? <Coachmark id="trainer-schedule-week-overview-2026-09" userId={actor?.userId} title="Расписание целиком" description="Все тренировки выбранного периода видны сразу. Нажмите на день, чтобы открыть подробное расписание.">
        {isTwoWeekView ? <section className="schedule-fortnight" aria-label={`Расписание на две недели: ${formatWeekRange(weekStart, periodEnd)}`}>
          <div className="schedule-fortnight-weekdays" aria-hidden="true">
            {overviewDays.slice(0, 7).map((day) => <span key={day}>{weekdayShort(day)}</span>)}
          </div>
          <div className="schedule-fortnight-grid">
            {overviewDays.map((day) => {
              const workouts = itemsByDay.get(day) ?? []
              return <button
                key={day}
                type="button"
                className={`schedule-fortnight-day${day === today ? ' is-today' : ''}`}
                aria-label={`${formatScheduleDateLabel(day)}, ${workoutCountLabel(workouts.length)}`}
                onClick={() => openDay(day, weekStart)}
              >
                <span className="schedule-fortnight-date">{dayOfMonth(day)}</span>
                <span className="schedule-fortnight-workouts">
                  {workouts.length > 0 ? workouts.map((workout) => {
                    const status = scheduleEventStatus(workout, today)
                    const fullTime = workout.startTime?.slice(0, 5) ?? '—'
                    return <span key={workout.id} className="schedule-fortnight-workout" title={`${eventTime(workout) || 'Без времени'} · ${workout.clientName} · ${status.label}`}>
                      <span className="schedule-fortnight-workout-compact" aria-hidden="true">{compactScheduleEventLabel(workout.startTime, workout.clientName)}</span>
                      <span className="schedule-fortnight-workout-full" aria-hidden="true">{fullTime} {workout.clientName}</span>
                      <span className="sr-only">{fullTime}, {workout.clientName}, {status.label}</span>
                    </span>
                  }) : <span className="schedule-fortnight-empty"><span className="schedule-fortnight-empty-compact">Нет</span><span className="schedule-fortnight-empty-full">Нет тренировок</span></span>}
                </span>
              </button>
            })}
          </div>
        </section> : <section className="schedule-week-grid" aria-label={`Расписание на неделю: ${formatWeekRange(weekStart, periodEnd)}`}>
          {overviewDays.map((day, index) => {
            const workouts = itemsByDay.get(day) ?? []
            return <button
              key={day}
              type="button"
              className={`schedule-week-day${index === 6 ? ' schedule-week-sunday' : ''}${day === today ? ' is-today' : ''}`}
              aria-label={`${formatScheduleDateLabel(day)}, ${workoutCountLabel(workouts.length)}`}
              onClick={() => openDay(day)}
            >
              <span className="schedule-week-day-heading">
                <strong>{weekdayShort(day)}</strong>
                <span>{dayOfMonth(day)}</span>
              </span>
              <span className="schedule-week-workouts">
                {workouts.length > 0 ? workouts.map((workout) => {
                  const status = scheduleEventStatus(workout, today)
                  return <span key={workout.id} className="schedule-week-workout" title={`${eventTime(workout) || 'Без времени'} · ${workout.clientName}`}>
                    <span className="schedule-week-workout-time">{workout.startTime?.slice(0, 5) ?? '—'}</span>
                    <span className="schedule-week-workout-name">{workout.clientName}</span>
                    <span className="sr-only">, {status.label}</span>
                  </span>
                }) : <span className="schedule-week-empty">Нет тренировок</span>}
              </span>
            </button>
          })}
        </section>}
      </Coachmark> : <>
      {untimed.length > 0 && <section className="schedule-untimed-section" aria-labelledby="schedule-untimed-title">
        <div className="schedule-untimed-heading">
          <strong id="schedule-untimed-title">Без времени</strong>
          <span>{workoutCountLabel(untimed.length)}</span>
        </div>
        <div className="day-untimed">{untimed.map((workout) => (
          <Link key={workout.id} className="schedule-untimed-card" to={`/workouts/${workout.id}`}>
            <span className="schedule-untimed-copy">
              <strong>{workout.clientName}</strong>
              <span>{scheduleExerciseLine(exerciseSummary(workout).map((exercise) => exercise.name))}</span>
            </span>
            <WorkoutStatusBadge workout={workout} />
          </Link>
        ))}</div>
      </section>}
      <div className="day-grid-scroll" ref={scrollRef}>
        <div className="day-grid" style={{ height: HOURS.length * HOUR_HEIGHT }}>
          {HOURS.map((hour) => (
            <div key={hour} className="day-grid-hour" style={{ top: hour * HOUR_HEIGHT }}>
              <span className="day-grid-hour-label">{String(hour).padStart(2, '0')}:00</span>
              <div className="day-grid-hour-line" />
            </div>
          ))}
          {timed.map((workout) => {
            const startMin = minutesOf(workout.startTime!.slice(0, 5))
            const endMin = workout.endTime ? minutesOf(workout.endTime.slice(0, 5)) : startMin + 60
            const top = (startMin / 60) * HOUR_HEIGHT
            const height = Math.max(((endMin - startMin) / 60) * HOUR_HEIGHT, 52)
            const names = exerciseSummary(workout).map((e) => e.name)
            const status = scheduleEventStatus(workout, today)
            return <Link key={workout.id} className={`day-grid-event schedule-event-${status.tone}`} style={{ top, height }} to={`/workouts/${workout.id}`}>
              <span className="day-grid-event-top">
                <span className="day-grid-event-time">{eventTime(workout)}</span>
                <span className="day-grid-event-name">{workout.clientName}</span>
                <span className="day-grid-event-status">{status.label}</span>
              </span>
              <span className="day-grid-event-summary">{scheduleExerciseLine(names)}</span>
            </Link>
          })}
         </div>
       </div>
       </>}
     </AsyncView>
  </Page>
}

function scheduleCount(value: number): string {
  return value > 99 ? '99+' : String(value)
}

function clientInitials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part.slice(0, 1).toUpperCase()).join('') || 'К'
}

function scheduleV2Date(value: LocalDate): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1, 12)
}

function scheduleV2DayTitle(value: LocalDate): string {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(scheduleV2Date(value))
}

function scheduleV2Weekday(value: LocalDate): string {
  return new Intl.DateTimeFormat('ru-RU', { weekday: 'long' }).format(scheduleV2Date(value))
}

function scheduleV2Range(start: LocalDate, end: LocalDate): string {
  const startDate = scheduleV2Date(start)
  const endDate = scheduleV2Date(end)
  const capitalize = (value: string) => `${value.charAt(0).toUpperCase()}${value.slice(1)}`
  const month = (value: Date) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' })
    .formatToParts(value).find((part) => part.type === 'month')?.value ?? ''
  const startMonth = capitalize(month(startDate))
  const endMonth = capitalize(month(endDate))
  const monthPart = startDate.getMonth() === endDate.getMonth()
    ? endMonth
    : `${startMonth} — ${endDate.getDate()} ${endMonth}`
  const label = startDate.getMonth() === endDate.getMonth()
    ? `${startDate.getDate()} — ${endDate.getDate()} ${monthPart}`
    : `${startDate.getDate()} ${monthPart}`
  return `${label} ${endDate.getFullYear()} г.`
}

function scheduleV2WorkoutLine(workout: Workout): string {
  const start = workout.startTime ? minutesOf(workout.startTime) : 0
  const end = workout.endTime ? minutesOf(workout.endTime) : start + 60
  const duration = Math.max(end - start, 1)
  const durationLabel = duration % 60 === 0 ? `${duration / 60} ч` : `${duration} мин`
  return `${durationLabel} · ${scheduleExerciseLine(exerciseSummary(workout).map((exercise) => exercise.name))}`
}

function trainerClientCount(value: number): string {
  const tail = value % 100
  const ending = tail >= 11 && tail <= 14 ? 'клиентов' : value % 10 === 1 ? 'клиент' : value % 10 >= 2 && value % 10 <= 4 ? 'клиента' : 'клиентов'
  return `${value} ${ending}`
}

function scheduleV2TimeLabel(value: string): string {
  return new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

function ScheduleV2InboxSheet({ questions, questionsLoading, questionsError, onRetryQuestions, onClose }: {
  questions: NonNullable<ReturnType<typeof useTrainerWorkspace>['data']>['questions']
  questionsLoading: boolean
  questionsError: boolean
  onRetryQuestions: () => void
  onClose: () => void
}) {
  const threads = useChatThreads()

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [onClose])

  return createPortal(<div className="schedule-v2-sheet-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="schedule-v2-inbox-sheet" role="dialog" aria-modal="true" aria-labelledby="schedule-v2-inbox-title">
      <div className="schedule-v2-sheet-handle" aria-hidden="true" />
      <header><div><h2 id="schedule-v2-inbox-title">Входящие</h2><p>Вопросы тренеру и сообщения</p></div><button type="button" aria-label="Закрыть входящие" onClick={onClose}><CloseIcon /></button></header>
      <div className="schedule-v2-inbox-scroll">
        <section aria-labelledby="schedule-v2-questions-title">
          <div className="schedule-v2-inbox-section-title"><h3 id="schedule-v2-questions-title">Вопросы тренеру</h3><span>{questionsError ? '—' : scheduleCount(questions.length)}</span></div>
          {questionsLoading && <p className="schedule-v2-inbox-empty">Загружаем вопросы…</p>}
          {questionsError && <p className="schedule-v2-inbox-empty schedule-v2-inbox-error">Не удалось загрузить вопросы <button type="button" onClick={onRetryQuestions}>Повторить</button></p>}
          {!questionsLoading && !questionsError && questions.length === 0 && <p className="schedule-v2-inbox-empty">Новых вопросов нет</p>}
          {!questionsError && questions.map((item) => <Link key={item.workoutId} className="schedule-v2-inbox-row" to={`/workouts/${item.workoutId}?reply=1`} onClick={onClose}>
            <span className="schedule-v2-inbox-avatar">{clientInitials(item.clientName)}</span>
            <span><b>{item.clientName}</b><small>{item.question}</small></span>
            <time>{scheduleV2TimeLabel(item.askedAt)}</time>
          </Link>)}
        </section>
        <section aria-labelledby="schedule-v2-messages-title">
          <div className="schedule-v2-inbox-section-title"><h3 id="schedule-v2-messages-title">Сообщения</h3><span>{threads.isError ? '—' : scheduleCount(threads.data?.reduce((sum, item) => sum + item.unreadCount, 0) ?? 0)}</span></div>
          {threads.isLoading && <p className="schedule-v2-inbox-empty">Загружаем сообщения…</p>}
          {threads.isError && <p className="schedule-v2-inbox-empty schedule-v2-inbox-error">Не удалось загрузить сообщения <button type="button" onClick={() => void threads.refetch()}>Повторить</button></p>}
          {!threads.isLoading && !threads.isError && threads.data?.length === 0 && <p className="schedule-v2-inbox-empty">Новых сообщений нет</p>}
          {threads.data?.map((item) => <Link key={`${item.clientId}:${item.trainerId}`} className="schedule-v2-inbox-row" to={item.conversationId ? `/chat/${item.conversationId}` : '/chat'} onClick={onClose}>
            <span className="schedule-v2-inbox-avatar">{clientInitials(item.partnerName)}</span>
            <span><b>{item.partnerName}</b><small>{item.lastMessageBody === '' ? 'Фото' : item.lastMessageBody ?? 'Начать диалог'}</small></span>
            {item.unreadCount > 0 && <strong>{scheduleCount(item.unreadCount)}</strong>}
          </Link>)}
        </section>
      </div>
      <Link className="schedule-v2-inbox-all" to="/chat" onClick={onClose}>Открыть все сообщения</Link>
    </section>
  </div>, document.body)
}

function TrainerScheduleV2({ forceDayView = false }: { forceDayView?: boolean }) {
  const {
    actor, selected, isTwoWeekView, isDayView, weekStart, periodEnd,
    overviewDays, today, scrollRef, openDay, showOverview, shiftOverview,
    query, itemsByDay, timed, untimed, todayDisabled,
  } = useTrainerScheduleModel(forceDayView)
  const workspace = useTrainerWorkspace(isDayView)
  const location = useLocation()
  const returnTo = `${location.pathname}${location.search}`
  const dateInputRef = useRef<HTMLInputElement>(null)
  const [inboxOpen, setInboxOpen] = useState(false)
  const currentTime = currentTimeInTimeZone(actor?.timezone)
  const currentMinutes = minutesOf(currentTime)
  const periodWorkouts = (query.data ?? []).filter((workout) => workout.status !== 'cancelled')
  const periodClients = new Set(periodWorkouts.map((workout) => workout.clientId)).size

  useEffect(() => {
    trackGoal('schedule_v2_exposed')
    trackGoal(isDayView ? 'schedule_v2_day_opened' : 'schedule_v2_week_opened')
  }, [isDayView])

  const summaryValue = (value: number | undefined) => workspace.isError
    ? '—'
    : value === undefined ? '…' : scheduleCount(value)
  const openDatePicker = () => {
    const input = dateInputRef.current
    if (!input) return
    if (typeof input.showPicker === 'function') input.showPicker()
    else input.click()
  }
  const menuItems = [
    { label: 'Сегодня', disabled: todayDisabled, onClick: () => openDay(today) },
    { label: 'Выбрать дату', onClick: openDatePicker },
    { label: isTwoWeekView ? 'К 2 неделям' : 'К неделе', onClick: () => showOverview(weekStart) },
  ]

  return <Page
    className={`schedule-page schedule-v2 ${isDayView ? 'schedule-day-view' : 'schedule-week-view'}`}
    title="Расписание"
    hideTitle
  >
    <header className={`schedule-v2-topbar${isDayView ? ' schedule-v2-topbar-day' : ''}`}>
      {isDayView ? <div><h1>{scheduleV2DayTitle(selected)}</h1><p>{scheduleV2Weekday(selected)}</p></div> : <h1 aria-hidden="true">Расписание</h1>}
      {isDayView
        ? <div className="schedule-v2-day-actions"><label className="schedule-v2-calendar" aria-label="Выбрать дату"><ScheduleIcon /><input ref={dateInputRef} type="date" value={selected} onChange={(event) => event.target.value && openDay(localDate(event.target.value))} /></label><OverflowMenu label="Настройки расписания" trigger={<SettingsIcon />} items={menuItems} /></div>
        : <label className="schedule-v2-calendar" aria-label="Выбрать дату"><ScheduleIcon /><input ref={dateInputRef} type="date" value={selected} onChange={(event) => event.target.value && openDay(localDate(event.target.value))} /></label>}
    </header>
    <AsyncView loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>
      {!isDayView ? <>
        <div className="schedule-v2-range-toggle" role="group" aria-label="Период расписания">
          <button type="button" aria-pressed={!isTwoWeekView} onClick={() => showOverview(weekStart, 'week')}>Неделя</button>
          <button type="button" aria-pressed={isTwoWeekView} onClick={() => showOverview(weekStart, '2w')}>2 недели</button>
        </div>
        <section className="schedule-v2-period" aria-label="Навигация по расписанию">
          <button type="button" aria-label={isTwoWeekView ? 'Предыдущие 2 недели' : 'Предыдущая неделя'} onClick={() => shiftOverview(-1)}><BackIcon /></button>
          <strong>{scheduleV2Range(weekStart, periodEnd)}</strong>
          <button type="button" aria-label={isTwoWeekView ? 'Следующие 2 недели' : 'Следующая неделя'} onClick={() => shiftOverview(1)}><ChevronRightIcon /></button>
        </section>
        <div className="schedule-v2-weekstrip" aria-label="Дни периода">
          {Array.from({ length: isTwoWeekView ? 2 : 1 }, (_, weekIndex) => <div key={weekIndex} className="schedule-v2-weekdays">
            {overviewDays.slice(weekIndex * 7, (weekIndex + 1) * 7).map((day) => <button key={day} type="button" className={`${day === selected ? 'is-selected' : ''}${day === today ? ' is-today' : ''}`} aria-label={formatScheduleDateLabel(day)} onClick={() => openDay(day, weekStart)}><span>{weekdayShort(day)}</span><strong>{dayOfMonth(day)}</strong></button>)}
          </div>)}
        </div>
        <p className="schedule-v2-period-summary">{workoutCountLabel(periodWorkouts.length)} · {trainerClientCount(periodClients)}</p>
        <section className="schedule-v2-card-grid" aria-label={`Расписание: ${formatWeekRange(weekStart, periodEnd)}`}>
          {overviewDays.map((day) => {
            const workouts = itemsByDay.get(day) ?? []
            return <button key={day} type="button" className={`schedule-v2-day-card${day === today ? ' is-today' : ''}`} onClick={() => openDay(day, weekStart)}>
              <span className="schedule-v2-day-title"><span>{weekdayShort(day)}</span><strong>{dayOfMonth(day)}</strong></span>
              <span className="schedule-v2-day-events">{workouts.slice(0, 5).map((workout) => {
                const status = scheduleEventStatus(workout, today)
                return <span key={workout.id} className={`schedule-event-${status.tone}`}><time>{workout.startTime?.slice(0, 5) ?? '—'}</time><b>{workout.clientName}</b><span className="sr-only">{status.label}</span></span>
              })}{workouts.length === 0 && <em>Свободный день</em>}{workouts.length > 5 && <em>Ещё {workouts.length - 5}</em>}</span>
            </button>
          })}
        </section>
      </> : <>
        <section className="schedule-v2-summary" aria-label="Рабочая сводка">
          <Link className="schedule-v2-action-card" to="/today?classic=1#trainer-attention" onClick={() => trackGoal('schedule_v2_action_tile_opened')}>
            <span className="schedule-v2-summary-icon"><BellIcon /></span>
            <strong>{summaryValue(workspace.data?.summary.pendingActionCount)}</strong>
            <span className="sr-only">Незавершённые действия</span>
          </Link>
          <button type="button" className="schedule-v2-message-card" aria-label={`${summaryValue(workspace.data?.summary.inboxCount)} Вопросы и сообщения`} onClick={() => { trackGoal('schedule_v2_inbox_tile_opened'); setInboxOpen(true) }}>
            <span className="schedule-v2-summary-icon"><MessageIcon /></span>
            <strong>{summaryValue(workspace.data?.summary.inboxCount)}</strong>
          </button>
        </section>
        {untimed.length > 0 && <section className="schedule-v2-untimed" aria-labelledby="schedule-v2-untimed-title"><strong id="schedule-v2-untimed-title">Без времени</strong>{untimed.map((workout) => <Link key={workout.id} to={`/workouts/${workout.id}`} state={{ returnTo }}><span className="schedule-v2-avatar">{clientInitials(workout.clientName)}</span><span><b>{workout.clientName}</b><small>{scheduleExerciseLine(exerciseSummary(workout).map((exercise) => exercise.name))}</small></span>{workout.status === 'done' && <CheckIcon />}</Link>)}</section>}
        <div className="day-grid-scroll schedule-v2-timeline" ref={scrollRef}>
          <div className="day-grid" style={{ height: HOURS.length * HOUR_HEIGHT }}>
            {HOURS.map((hour) => <div key={hour} className={`day-grid-hour${selected === today && scheduleHourLabelCollidesWithNow(hour, currentMinutes) ? ' is-near-current-time' : ''}`} style={{ top: hour * HOUR_HEIGHT }}><span className="day-grid-hour-label">{String(hour).padStart(2, '0')}:00</span><div className="day-grid-hour-line" /></div>)}
            {selected === today && <div className="schedule-v2-now" style={{ top: (currentMinutes / 60) * HOUR_HEIGHT }}><time>{currentTime}</time><span /></div>}
            {timed.map((workout) => {
              const startMin = minutesOf(workout.startTime!.slice(0, 5))
              const endMin = workout.endTime ? minutesOf(workout.endTime.slice(0, 5)) : startMin + 60
              const top = (startMin / 60) * HOUR_HEIGHT
              const height = Math.max(((endMin - startMin) / 60) * HOUR_HEIGHT, 54)
              const status = scheduleEventStatus(workout, today)
              return <Link key={workout.id} className={`schedule-v2-event schedule-event-${status.tone}`} style={{ top, height }} to={`/workouts/${workout.id}`} state={{ returnTo }} onClick={() => trackGoal('schedule_v2_workout_opened')}>
                <span className="schedule-v2-avatar">{clientInitials(workout.clientName)}</span>
                <span><b>{workout.clientName}</b><small>{scheduleV2WorkoutLine(workout)}</small><span className="sr-only">{status.label}</span></span>
                {workout.status === 'done' && <CheckIcon />}
              </Link>
            })}
          </div>
        </div>
      </>}
    </AsyncView>
    <Link className="schedule-v2-fab" aria-label={`Запланировать тренировку на ${selected}`} to={`/workouts/new?date=${selected}`} onClick={() => trackGoal('schedule_v2_workout_create_started')}><AddIcon /></Link>
    {inboxOpen && <ScheduleV2InboxSheet
      questions={workspace.data?.questions ?? []}
      questionsLoading={workspace.isLoading}
      questionsError={workspace.isError}
      onRetryQuestions={() => void workspace.refetch()}
      onClose={() => setInboxOpen(false)}
    />}
  </Page>
}

export function TrainerScheduleTodayPage() {
  return <TrainerScheduleV2 forceDayView />
}

export function WorkoutStatusBadge({ workout }: { workout: Workout }) {
  const { actor } = useAuth()
  const status = workoutStatusPresentation(workout, todayInTimeZone(actor?.timezone))
  const state: WorkoutUiState = status.tone === 'done' ? 'completed'
    : status.tone === 'in_progress' ? 'current'
      : status.tone === 'partial' ? 'partial'
        : status.tone === 'decision' ? 'decision'
          : status.tone === 'cancelled' ? 'cancelled'
          : 'planned'
  return <WorkoutStatus state={state} label={status.label} />
}

// Список упражнений тренировки для карточки (история/предстоящие): каждое
// на своей строке, у упражнений с комментарием — сам комментарий ниже.
// Одинаково в плане и в истории.
function exerciseCountLabel(count: number): string {
  const lastTwo = count % 100
  const last = count % 10
  if (lastTwo >= 11 && lastTwo <= 14) return 'упражнений'
  if (last === 1) return 'упражнение'
  if (last >= 2 && last <= 4) return 'упражнения'
  return 'упражнений'
}

function setCountLabel(count: number): string {
  const lastTwo = count % 100
  const last = count % 10
  if (lastTwo >= 11 && lastTwo <= 14) return 'подходов'
  if (last === 1) return 'подход'
  if (last >= 2 && last <= 4) return 'подхода'
  return 'подходов'
}

export function WorkoutExercisesSummary({ workout, maxItems }: { workout: Workout; maxItems?: number }) {
  const items = exerciseSummary(workout)
  if (!items.length) return <p className="muted">Без упражнений</p>
  const visibleItems = maxItems === undefined ? items : items.slice(0, maxItems)
  return <ul className="workout-exercise-list">{visibleItems.map((item, index) => <li key={index}>
    <span className="workout-exercise-name">{item.name}{item.comment && ' 💬'}</span>
    {item.comment && <span className="workout-exercise-comment">💬 {item.comment}</span>}
  </li>)}{maxItems !== undefined && items.length > maxItems && <li className="workout-exercise-more">Ещё {items.length - maxItems} {exerciseCountLabel(items.length - maxItems)}</li>}</ul>
}

export function PastWorkoutPlanCard({ workout, contextLabel, returnTo }: { workout: Workout; contextLabel?: string | null; returnTo?: string }) {
  return <Link className="past-workout-plan-card" to={`/workouts/${workout.id}`} state={returnTo ? { returnTo } : undefined}>
    <span className="past-workout-plan-copy">
      <strong>План на {formatLocalDate(workout.workoutDate)}</strong>
      {contextLabel && <small>{contextLabel}</small>}
      <WorkoutExercisesSummary workout={workout} maxItems={2} />
    </span>
    <span className="past-workout-plan-action">Выбрать действие <ChevronRightIcon /></span>
  </Link>
}

const chronicleWellbeingLabels: Record<WorkoutWellbeing, string> = {
  good: 'Хорошо',
  normal: 'Нормально',
  hard: 'Плохо',
}

const chronicleReactionLabels: Record<TrainerReaction, string> = {
  thumbs_up: '👍',
  fire: '🔥',
  strong: '💪',
}

export function WorkoutChronicleCard({ workout, contextLabel, returnTo, historyListActions = false }: { workout: Workout; contextLabel?: string | null; returnTo?: string; historyListActions?: boolean }) {
  const done = workout.status === 'done'
  const duration = workoutDurationLabel(workout.startedAt, workout.completedAt)
  const tonnage = workoutTonnage(workout)
  const meta = done ? [
    duration,
    tonnage > 0 ? tonnageLabel(tonnage) : null,
    workout.activeCaloriesKcal ? `≈ ${workout.activeCaloriesKcal} ккал` : null,
  ].filter(Boolean) : []
  const hasFeedback = workout.sessionRpe !== undefined && workout.wellbeing !== undefined
  const exercisePreview = chronicleExercisePreview(workout.exercises)
  const musclePreview = chronicleExercisePreview(historyListActions && done ? performedMuscleGroupLabels(workout) : [], 3)
  const detailState = returnTo ? { returnTo } : undefined
  const formattedDate = formatLocalDate(workout.workoutDate)
  const muscleSummary = [...musclePreview.visible, ...(musclePreview.hiddenCount > 0 ? [`+${musclePreview.hiddenCount}`] : [])].join(' · ')

  return <article className={`card workout-chronicle-card${workout.hasPr ? ' has-pr' : ''}${historyListActions && done ? ' has-history-actions' : ''}`}>
    <Link className="workout-chronicle-open" aria-label={`Открыть тренировку за ${formattedDate}`} to={`/workouts/${workout.id}`} state={detailState}>
      <div className="workout-chronicle-head">
        <strong>{formattedDate}</strong>
        <div className="workout-chronicle-head-badges">
          {workout.hasPr && <span className="workout-pr-badge"><RecordIcon />Личный рекорд</span>}
          <WorkoutStatusBadge workout={workout} />
        </div>
      </div>
      {contextLabel && <p className="card-author">{contextLabel}</p>}
      <div className="workout-chronicle-exercises">
        {exercisePreview.visible.length > 0 ? exercisePreview.visible.map((exercise) => {
          const result = done
            ? compactCompletedSetSummary(exercise.sets, false, exercise.ref)
            : compactPlannedSetSummary(exercise.sets, false, exercise.ref)
          return <div className="workout-chronicle-exercise" key={exercise.id}>
            <span className="workout-chronicle-exercise-name">{exercise.name}
              {exercise.trainerComment && <small className="workout-exercise-comment">💬 {exercise.trainerComment}</small>}
            </span>
            {result && <strong>{result}</strong>}
          </div>
        }) : <p className="muted">Без упражнений</p>}
        {exercisePreview.hiddenCount > 0 && <p className="workout-chronicle-more">Ещё {exercisePreview.hiddenCount} {exerciseCountLabel(exercisePreview.hiddenCount)}</p>}
      </div>
      {muscleSummary && <p className="workout-chronicle-muscles" aria-label={`Основные группы мышц: ${muscleSummary}`}><span>Мышцы:</span> {muscleSummary}</p>}
      {(meta.length > 0 || hasFeedback || workout.discomfort) && <div className="card-meta workout-chronicle-facts">
        {meta.map((item) => <span key={item}>{item}</span>)}
        {hasFeedback && <span>RPE {workout.sessionRpe}/10</span>}
        {workout.wellbeing && <span>{chronicleWellbeingLabels[workout.wellbeing]}</span>}
        {workout.discomfort && <span className="attention">Дискомфорт</span>}
      </div>}
      {workout.clientComment && <p className="workout-chronicle-comment"><span className="workout-chronicle-note-label">Клиент</span><span className="workout-chronicle-note-text">{workout.clientComment}</span></p>}
      {workout.trainerReview && <p className="workout-chronicle-response">
        <span className="workout-chronicle-note-label">{workout.trainerReaction ? chronicleReactionLabels[workout.trainerReaction] : 'Тренер'}</span>
        <span className="workout-chronicle-note-text">{workout.trainerReview}</span>
      </p>}
    </Link>
    {historyListActions && done && <Link className="workout-chronicle-copy" aria-label={`Скопировать тренировку за ${formattedDate}`} title="Скопировать тренировку" to={`/workouts/new?copy=${workout.id}`} state={detailState}><CopyIcon /></Link>}
  </article>
}

export function ClientWorkoutsPage() {
  const { workouts: workoutsRepository } = useDataBackend()
  const { clientId = '' } = useParams()
  const { actor } = useAuth()
  const today = todayInTimeZone(actor?.timezone)
  const calendar = useWorkoutHistoryCalendar(today)
  const returnTo = `/clients/${clientId}/workouts${calendar.search}`
  const goBack = useWorkoutBack(`/clients/${clientId}`)
  useClientRealtime(clientId)
  const query = useInfiniteQuery({
    queryKey: ['workouts', clientId, 'history', today],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => workoutsRepository.listPage(undefined, today, clientId, pageParam, WORKOUT_HISTORY_PAGE_SIZE),
    getNextPageParam: (page) => page.nextOffset,
  })
  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  const split = splitClientWorkouts(items, today)
  const calendarHistory = useQuery({
    queryKey: ['workouts', clientId, 'history-calendar', calendar.range.from, calendar.range.to],
    queryFn: () => workoutsRepository.list(calendar.range.from, calendar.range.to, clientId),
    enabled: calendar.state.view === 'calendar',
  })
  const calendarItems = splitClientWorkouts(calendarHistory.data ?? [], today).history
  const contextLabel = (workout: Workout) => workout.createdBy && workout.createdBy !== actor?.userId ? 'Создано клиентом' : null
  const hasWorkouts = split.needsDecision.length > 0 || split.history.length > 0
  return <Page className="trainer-client-workouts-page" title="Тренировки клиента" back={`/clients/${clientId}`} onBack={goBack} action={hasWorkouts && <Link className="button" to={`/workouts/new?client=${clientId}`} state={{ returnTo }}>Запланировать</Link>}><AsyncView loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>
    {hasWorkouts || calendar.state.view === 'calendar' ? <div className="client-workouts-stack">
      {split.needsDecision.length > 0 && <section className="client-workout-section"><div className="client-workout-section-head"><p className="eyebrow">РАНЕЕ ЗАПЛАНИРОВАНО</p><h2>Выберите действие</h2></div><div className="cards client-workout-cards">{split.needsDecision.map((workout) => <PastWorkoutPlanCard key={workout.id} workout={workout} returnTo={returnTo} />)}</div></section>}
      <section className="client-workout-section client-history-section">
        <div className="client-workout-section-head client-history-section-head">
          <div><p className="eyebrow">РЕЗУЛЬТАТЫ</p><h2>История</h2></div>
          <Coachmark id="trainer-workout-history-calendar-2026-09" userId={actor?.userId} title="История по датам" description="Переключитесь на календарь, чтобы найти тренировку по дню.">
            <div className="client-history-view-toggle" role="group" aria-label="Вид истории тренировок">
              <button type="button" aria-pressed={calendar.state.view === 'list'} onClick={calendar.showList}>Список</button>
              <button type="button" aria-pressed={calendar.state.view === 'calendar'} onClick={() => calendar.showCalendar(split.history[0]?.workoutDate)}><ScheduleIcon />Календарь</button>
            </div>
          </Coachmark>
        </div>
        {calendar.state.view === 'list' ? <>
          <div className="cards workout-chronicle-list">{split.history.map((workout) => <WorkoutChronicleCard key={workout.id} workout={workout} contextLabel={contextLabel(workout)} returnTo={returnTo} historyListActions />)}</div>
          {split.history.length === 0 && <p className="muted">Здесь появятся завершённые тренировки.</p>}
          <LoadMoreButton hasMore={query.hasNextPage} loading={query.isFetchingNextPage} onLoadMore={() => void query.fetchNextPage()} />
        </> : <ClientWorkoutHistoryCalendar month={calendar.state.month} today={today} workouts={calendarItems}
          selectedDate={calendar.state.selectedDate} loading={calendarHistory.isLoading} error={calendarHistory.error}
          returnTo={returnTo} contextLabel={contextLabel} onRetry={() => void calendarHistory.refetch()}
          onMonthChange={calendar.shiftMonth} onDateSelect={calendar.selectDate} />}
      </section>
    </div> : <EmptyState
      title="Тренировка для клиента"
      description="Составьте план или сразу запишите готовый результат."
      action={<Link className="button secondary" to={`/workouts/new?client=${clientId}`} state={{ returnTo }}>Запланировать тренировку</Link>}
    />}
  </AsyncView></Page>
}

export function WorkoutFormPage() {
  const { clients: clientsRepository, exercises: exercisesRepository, favoriteWorkouts: favoriteWorkoutsRepository, goals: goalsRepository, workouts: workoutsRepository } = useDataBackend()
  const { workoutId } = useParams()
  const { actor } = useAuth()
  const today = todayInTimeZone(actor?.timezone)
  const showRpeByDefault = useRpeDisplay(actor?.userId)
  const showRestByDefault = useExercisePlanRestDisplay(actor?.userId)
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const navigationState = location.state as WorkoutNavigationState | null
  const queryClient = useQueryClient()
  const [confirmLeave, confirmLeaveDialog] = useConfirm()
  const sourceId = workoutId ?? params.get('copy') ?? undefined
  const copiedWorkout = params.has('copy')
  const favoriteId = params.get('favorite') ?? undefined
  const recordPlannedResult = Boolean(workoutId && params.get('result') === '1')
  const routeClientId = params.get('client') ?? ''
  const source = useQuery({ queryKey: ['workout', sourceId], queryFn: () => workoutsRepository.get(sourceId ?? ''), enabled: Boolean(sourceId) })
  const favorites = useQuery({ queryKey: ['favorite-workouts'], queryFn: () => favoriteWorkoutsRepository.list(), enabled: Boolean(favoriteId) })
  const favorite = favorites.data?.find((item) => item.id === favoriteId)
  const plannedFromFavorite = Boolean(favoriteId)
  const clientMode = actor?.role === 'client'
  const clients = useQuery({ queryKey: ['clients', false], queryFn: () => clientsRepository.list(false), enabled: !clientMode })
  const mine = useQuery({ queryKey: ['my-client'], queryFn: () => clientsRepository.getMine(), enabled: clientMode })
  useClientRealtime(source.data?.clientId ?? (clientMode ? mine.data?.id : params.get('client') ?? undefined))
  const catalog = useExerciseCatalog()
  const [draftExercises, setDraftExercises] = useState<WorkoutDraft['exercises'] | null>(null)
  const [previousResultReferences, setPreviousResultReferences] = useState<ReadonlyMap<string, PreviousExerciseResult>>(() => new Map())
  const createRequestId = useRef(crypto.randomUUID())
  const [recordCompleted, setRecordCompleted] = useState(false)
  const [entryDate, setEntryDate] = useState<LocalDate>(() => localDate(params.get('date') ?? today))
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [showEndTime, setShowEndTime] = useState(false)
  const [notes, setNotes] = useState('')
  const [clientSelectionError, setClientSelectionError] = useState<string | null>(null)
  const [stageId, setStageId] = useState('')
  const [formDraftReady, setFormDraftReady] = useState(false)
  const [prefillError, setPrefillError] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerSelectionDraft, setPickerSelectionDraft] = useState<ExerciseSnapshot[]>([])
  const [techniqueExercise, setTechniqueExercise] = useState<ExerciseSnapshot | null>(null)
  const [pickerSearch, setPickerSearch] = useState('')
  const parsedExerciseSelection = useRef<((exercise: ExerciseSnapshot) => void) | null>(null)
  // Индекс упражнения, которое заменяем через пикер; null — режим добавления.
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null)
  const initial = source.data
    ? (workoutId ? { ...(source.data.status === 'done' || recordPlannedResult ? completedWorkoutDraft(source.data) : copyWorkout(source.data)), id: source.data.id, version: source.data.version } : copyWorkout(source.data, today, { refreshCatalogNames: true }))
    : favorite ? favoriteTemplateToWorkoutDraft(favorite.exercises, mine.data?.id ?? '', today, favorite.title) : undefined
  const exercises = draftExercises ?? initial?.exercises ?? []
  const draftKey = workoutFormDraftKey(actor?.userId ?? 'anonymous', sourceId ?? (favoriteId ? `favorite-${favoriteId}` : `new-${params.get('client') ?? ''}-${params.get('date') ?? ''}`))
  useEffect(() => { setPickerSelectionDraft([]) }, [draftKey])
  // Клиент, для которого выбираем этап (реактивно — при смене в селекте).
  const defaultClientId = clientMode ? (mine.data?.id ?? '') : (initial?.clientId ?? routeClientId)
  const [selectedClientId, setSelectedClientId] = useState<string>('')
  // Копия остаётся в контексте клиента исходной тренировки: имя уже видно
  // в шапке, поэтому повторный picker только удлинял форму и создавал риск ошибки.
  const clientId = copiedWorkout ? (initial?.clientId ?? defaultClientId) : (selectedClientId || defaultClientId)
  const goBack = useWorkoutBack(workoutId ? `/workouts/${workoutId}` : workoutListFallback(clientMode, clientId))
  const clientWorkouts = useQuery({ queryKey: ['client-exercises-frequency', clientId], queryFn: () => workoutsRepository.list(undefined, undefined, clientId), enabled: Boolean(clientId) })
  const clientRecentExercises = useMemo(() => recentExercisesForClient(catalog.exercises, clientWorkouts.data ?? []), [catalog.exercises, clientWorkouts.data])
  const goal = useQuery({ queryKey: ['client-goal', clientId], queryFn: () => goalsRepository.get(clientId), enabled: Boolean(clientId) })
  const stages = goal.data ? orderedStages(goal.data) : []
  // Этап по умолчанию: сохранённый у тренировки, иначе текущий по дате.
  const defaultStageId = source.data?.stageId ?? (goal.data ? currentStage(goal.data, today)?.id ?? '' : '')
  // Завершённой остаётся только редактируемая запись. Копия завершённой
  // тренировки — это новый план, который тренер при необходимости может
  // переключить в «Завершённую».
  const completedMode = recordCompleted || recordPlannedResult || Boolean(workoutId && source.data?.status === 'done')
  useEffect(() => {
    if (!actor || source.isLoading || (clientMode && mine.isLoading) || (plannedFromFavorite && favorites.isLoading) || formDraftReady) return
    // Only creation persists drafts. An unfinished copy must never populate an edit.
    const saved = workoutId ? null : readWorkoutFormDraft(draftKey)
    if (saved) {
      setSelectedClientId(routeClientId || saved.clientId)
      setEntryDate(saved.workoutDate)
      setStartTime(saved.startTime.slice(0, 5))
      setEndTime(saved.endTime.slice(0, 5))
      setShowEndTime(Boolean(saved.endTime))
      setNotes(saved.notes)
      setStageId(saved.stageId)
      setRecordCompleted(saved.recordCompleted)
      setDraftExercises(copiedWorkout || plannedFromFavorite
        ? saved.exercises.map((exercise) => ({ ...exercise, name: copiedExerciseName(exercise) }))
        : saved.exercises)
    } else if (initial) {
      setEntryDate(initial.workoutDate)
      // PostgreSQL возвращает time как HH:MM:SS, а нативный input[type=time]
      // без шага секунд принимает HH:MM. Иначе браузер молча блокирует submit.
      setStartTime(initial.startTime?.slice(0, 5) ?? '')
      setEndTime(initial.endTime?.slice(0, 5) ?? '')
      setShowEndTime(Boolean(initial.endTime))
      setNotes(initial.notes ?? '')
      setStageId(initial.stageId ?? '')
    }
    setFormDraftReady(true)
  }, [actor, clientMode, draftKey, favorites.isLoading, formDraftReady, initial, mine.isLoading, plannedFromFavorite, routeClientId, source.data?.status, source.isLoading])

  useEffect(() => {
    if (!formDraftReady || workoutId) return
    writeWorkoutFormDraft(draftKey, { clientId, workoutDate: entryDate, startTime, endTime, notes, stageId, recordCompleted, exercises })
  }, [clientId, draftKey, endTime, entryDate, exercises, formDraftReady, notes, recordCompleted, stageId, startTime, workoutId])

  useEffect(() => {
    if (!initial || formDraftReady) return
    setEntryDate(initial.workoutDate)
  }, [formDraftReady, initial, source.data?.status])
  const mutation = useMutation({ mutationFn: (draft: WorkoutDraft) => recordPlannedResult ? workoutsRepository.recordPlannedResult(draft) : completedMode ? workoutsRepository.saveCompleted(draft) : workoutsRepository.save(draft), onSuccess: async (id) => {
    if (!workoutId) removeWorkoutFormDraft(draftKey)
    // Перед переходом карточка должна получить новую optimistic-concurrency
    // version. Иначе пользователь успевает запустить только что изменённую
    // тренировку из устаревшего cache и получает ложный conflict.
    await queryClient.invalidateQueries({ queryKey: ['workout', id] })
    if (workoutId === id && navigationState?.fromWorkoutDetailId === id && hasWorkoutBackEntry()) {
      navigate(-1)
    } else {
      navigate(`/workouts/${id}`, { replace: true, state: { returnTo: safeWorkoutReturnTo(navigationState?.returnTo) } })
    }
    void Promise.all([
      invalidateWorkoutResults(queryClient),
      queryClient.invalidateQueries({ queryKey: ['today-workouts'] }),
      queryClient.invalidateQueries({ queryKey: ['today-recent-workouts'] }),
      queryClient.invalidateQueries({ queryKey: ['clients'] }),
    ])
  } })

  async function createQuickClient(fullName: string): Promise<ClientPickerSelection> {
    const id = await clientsRepository.createQuick(fullName)
    await queryClient.invalidateQueries({ queryKey: ['clients'] })
    return { id, fullName }
  }

  async function previousResults(selected: ExerciseSnapshot[]): Promise<Map<string, PreviousExerciseResult>> {
    if (!clientId) return new Map<string, PreviousExerciseResult>()
    try {
      setPrefillError(null)
      return await workoutsRepository.latestExerciseResults(clientId, selected.map((exercise) => exercise.ref))
    } catch {
      // Добавление тренировки не должно блокироваться, если история временно недоступна.
      setPrefillError('Не удалось подставить значения с прошлой тренировки')
      return new Map<string, PreviousExerciseResult>()
    }
  }
  function rememberPreviousResults(results: ReadonlyMap<string, PreviousExerciseResult>) {
    if (!results.size) return
    setPreviousResultReferences((current) => new Map([...current, ...results]))
  }
  function exerciseDraft(selected: ExerciseSnapshot, position: number, result: PreviousExerciseResult | undefined) {
    return {
      ...selected, position, blockId: crypto.randomUUID(), blockType: 'single' as const, blockRounds: 1,
      prefilledFromDate: result?.workoutDate,
      sets: result?.sets.length ? result.sets : [{ position: 0 }],
    }
  }
  async function pickExercise(selected: ExerciseSnapshot, runningFormat?: RunningFormat) {
    const selectParsedExercise = parsedExerciseSelection.current
    if (selectParsedExercise) {
      selectParsedExercise(selected)
      closePicker()
      return
    }
    if (runningFormat) {
      const selectedDrafts = createRunningFormatDrafts(selected, runningFormat, replaceIndex ?? exercises.length)
      if (selectedDrafts.length) {
        const next = replaceIndex === null
          ? [...exercises, ...selectedDrafts]
          : [
              ...exercises.slice(0, replaceIndex),
              ...selectedDrafts.map((draft) => source.data?.status === 'done' ? { ...draft, clearFact: true } : draft),
              ...exercises.slice(replaceIndex + 1),
            ]
        setDraftExercises(next.map((exercise, position) => ({ ...exercise, position })))
      }
      closePicker()
      return
    }
    const results = await previousResults([selected])
    rememberPreviousResults(results)
    const previous = results.get(selected.ref)
    if (replaceIndex !== null) {
      const clearFact = source.data?.status === 'done'
      // Если в истории этого упражнения ещё нет, сохраняем привычное поведение
      // замены: при одинаковом типе остаются уже набранные значения формы.
      // В завершённой тренировке значения нельзя приписать новому упражнению:
      // замена всегда начинается без факта.
      const draft = !clearFact && previous ? exerciseDraft(selected, replaceIndex, previous) : undefined
      setDraftExercises(replaceExercise(exercises, replaceIndex, selected, draft, { clearFact }))
    }
    else setDraftExercises([...exercises, exerciseDraft(selected, exercises.length, previous)])
    closePicker()
  }
  async function pickExercises(selected: ExerciseSnapshot[]) {
    const results = await previousResults(selected)
    rememberPreviousResults(results)
    setDraftExercises([
      ...exercises,
      ...selected.map((exercise, index) => exerciseDraft(exercise, exercises.length + index, results.get(exercise.ref))),
    ])
    closePicker()
  }
  async function addQuickEntry(parsed: ParsedWorkoutExercise[]) {
    const exercisesWithoutParsedValues = parsed.filter((item) => !item.hasValues).map((item) => item.exercise)
    const results = exercisesWithoutParsedValues.length > 0
      ? await previousResults(exercisesWithoutParsedValues)
      : new Map<string, PreviousExerciseResult>()
    rememberPreviousResults(results)
    const additions = parsed.map((item, index) => {
      const fallback = exerciseDraft(item.exercise, exercises.length + index, results.get(item.exercise.ref))
      return {
        ...fallback,
        ...item.structure,
        sets: item.hasValues ? item.sets : fallback.sets,
      }
    })
    const roundsByGroup = new Map<string, number>()
    for (const exercise of additions) {
      if (exercise.blockType === 'group') {
        roundsByGroup.set(exercise.blockId, Math.max(roundsByGroup.get(exercise.blockId) ?? 1, exercise.sets.length, 1))
      }
    }
    setDraftExercises([
      ...exercises,
      ...additions.map((exercise) => exercise.blockType === 'group'
        ? { ...exercise, blockRounds: roundsByGroup.get(exercise.blockId) ?? exercise.blockRounds }
        : exercise),
    ])
  }
  function closePicker() { parsedExerciseSelection.current = null; setPickerOpen(false); setReplaceIndex(null); setPickerSearch('') }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (exercises.length === 0) return
    const form = new FormData(event.currentTarget)
    const submitClientId = String(form.get('clientId'))
    if (!submitClientId) { setClientSelectionError('Выберите клиента для тренировки'); return }
    const date = entryDate
    const submittedStartTime = startTime
    const submittedEndTime = endTime
    const endTimeInput = event.currentTarget.elements.namedItem('endTime') as HTMLInputElement | null
    const timeError = submittedEndTime && !submittedStartTime
      ? 'Укажите время начала тренировки'
      : submittedEndTime && submittedEndTime <= submittedStartTime
        ? 'Окончание должно быть позже начала'
        : ''
    endTimeInput?.setCustomValidity(timeError)
    if (timeError) { endTimeInput?.reportValidity(); return }
    const stageId = String(form.get('stageId') || '') || null
    mutation.mutate({ id: workoutId, requestId: workoutId ? undefined : createRequestId.current, clientId: submitClientId, workoutDate: date, startTime: submittedStartTime || undefined,
      endTime: submittedEndTime || undefined,
      notes: notes || undefined, stageId: stageId || null, exercises, version: source.data?.version,
      favoriteTitle: initial?.favoriteTitle })
  }
  const availableClients = clientMode ? (mine.data ? [mine.data] : []) : clients.data
  const selectedClientName = availableClients?.find((client) => client.id === clientId)?.fullName
  const clientContextLocked = !clientMode && !workoutId && Boolean(routeClientId || (copiedWorkout && source.data?.clientId))
  const editingDenied = Boolean(clientMode && workoutId && source.data && source.data.createdBy !== actor?.userId)
  const loading = source.isLoading || mine.isLoading
  const error = source.error ?? mine.error
  const pageTitle = recordPlannedResult ? 'Записать результат' : workoutId ? 'Редактировать тренировку' : 'Новая тренировка'
  const documentTitle = recordPlannedResult ? 'Запись результата' : workoutId ? 'Редактирование тренировки' : params.has('copy') ? 'Копирование тренировки' : 'Создание тренировки'
  const exerciseMeta = exercises.length > 0 ? `${exercises.length} ${exerciseCountLabel(exercises.length)}` : 'Сначала добавьте упражнения'
  const headerMeta = [copiedWorkout ? 'Скопировано' : plannedFromFavorite ? 'Из избранного' : '', selectedClientName, exerciseMeta].filter(Boolean).join(' · ')
  const hasMeaningfulDraft = exercises.length > 0 || Boolean(notes.trim() || startTime || endTime || selectedClientId || recordCompleted || entryDate !== localDate(params.get('date') ?? today))
  async function leaveForm() {
    if (!workoutId && hasMeaningfulDraft) {
      const shouldLeave = await confirmLeave({ message: 'Выйти из тренировки? Черновик и введённые значения будут удалены.', confirmLabel: 'Выйти', danger: true })
      if (!shouldLeave) return
      removeWorkoutFormDraft(draftKey)
    }
    goBack()
  }
  return <Page title={documentTitle} hideTitle className="workout-form-page workout-focused-page" back={-1} onBack={() => void leaveForm()}>
    <WorkoutHeader eyebrow={completedMode ? 'РЕЗУЛЬТАТ' : 'ПЛАН ТРЕНИРОВКИ'} title={pageTitle} state={completedMode ? 'history' : 'planned'}
      meta={headerMeta} showStatus={Boolean(workoutId)} />
    <AsyncView loading={loading} error={error} onRetry={() => { void source.refetch(); void mine.refetch() }}>{editingDenied ? <StatePanel tone="info" title="Редактирование недоступно" description="Назначенную тренером тренировку может менять только тренер." action={<button type="button" className="secondary" onClick={goBack}>Вернуться</button>} /> : clientMode && !mine.data ? <StatePanel tone="info" title="Заполните профиль спортсмена" description="После этого можно будет добавлять самостоятельные тренировки и отслеживать результаты." action={<Link className="button" to="/me/edit">Заполнить профиль</Link>} /> : <form className="stack workout-form" onSubmit={(event) => void submit(event)}>
      <section className="workout-form-section">
        {clientMode
          ? <input type="hidden" name="clientId" value={mine.data?.id ?? ''} />
          : clientContextLocked
            ? <input type="hidden" name="clientId" value={clientId} />
            : <ClientPicker userId={actor?.userId} clients={availableClients ?? []} selectedId={clientId} onChange={(id) => { setClientSelectionError(null); setSelectedClientId(id) }} selectionError={clientSelectionError} loading={clients.isLoading} error={clients.error} onRetry={() => void clients.refetch()} onCreate={createQuickClient} />}
        {!workoutId && <div className="workout-record-mode" role="group" aria-label="Тип тренировки"><button type="button" className={!recordCompleted ? 'active' : ''} aria-pressed={!recordCompleted} onClick={() => setRecordCompleted(false)}>План</button><button type="button" className={recordCompleted ? 'active' : ''} aria-pressed={recordCompleted} onClick={() => setRecordCompleted(true)}>Завершённая</button></div>}
        <div className="workout-form-section-head"><p className="eyebrow">КОГДА</p></div>
        <div className="split workout-time-row"><Field label="Дата"><input name="date" type="date" value={entryDate} onChange={(event) => setEntryDate(localDate(event.target.value))} required /></Field><Field label="Начало"><input name="startTime" type="time" value={startTime} onChange={(event) => { setStartTime(event.target.value); (event.currentTarget.form?.elements.namedItem('endTime') as HTMLInputElement | null)?.setCustomValidity('') }} /></Field></div>
        {showEndTime
          ? <div className="workout-end-time"><Field label="Окончание"><input name="endTime" type="time" value={endTime} onChange={(event) => { setEndTime(event.target.value); event.currentTarget.setCustomValidity('') }} /></Field><button type="button" className="link" onClick={() => { setEndTime(''); setShowEndTime(false) }}>Убрать окончание</button></div>
          : <button type="button" className="link workout-add-end-time" onClick={() => setShowEndTime(true)}>＋ Добавить время окончания</button>}
        {stages.length > 0 && <Field label="Этап цели">
          {/* key — чтобы defaultValue пересчитался при смене клиента/загрузке цели */}
          <select name="stageId" key={`${clientId}-${defaultStageId}`} value={stageId || defaultStageId} onChange={(event) => setStageId(event.target.value)}>
            <option value="">Без этапа</option>
            {stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.title}</option>)}
          </select>
        </Field>}
        <details className="workout-notes" open={Boolean(initial?.notes)}>
          <summary>Заметка для спортсмена <span>Необязательно</span></summary>
          <VoiceNoteField name="notes" source="workout_form" value={notes} onValueChange={setNotes} hideLabel />
        </details>
      </section>
      <section className="workout-form-section workout-form-exercises">
        <div className="workout-form-section-head workout-form-exercise-heading"><h2>{completedMode ? 'Что выполнено' : 'Упражнения'}</h2></div>
        <QuickWorkoutEntry catalog={catalog.exercises} preferredExerciseRefs={clientRecentExercises.map((exercise) => exercise.ref)} parseWorkout={(text, systemCatalog) => exercisesRepository.parseWorkout(text, systemCatalog)} onAdd={(parsed) => void addQuickEntry(parsed)} compact={exercises.length > 0} onOpenCatalog={exercises.length === 0 ? (search, onSelect) => { parsedExerciseSelection.current = onSelect ?? null; setPickerSearch(search); setReplaceIndex(null); setPickerOpen(true) } : undefined} />
        {exercises.length === 0 && <p className="workout-empty-hint" role="status">Добавьте хотя бы одно упражнение — голосом, текстом или из каталога.</p>}
        <WorkoutExerciseEditor exercises={exercises} onChange={setDraftExercises} onOpenPicker={() => { setReplaceIndex(null); setPickerOpen(true) }} onReplaceExercise={(index) => { setReplaceIndex(index); setPickerOpen(true) }}
          exerciseCatalog={catalog.exercises}
          canOpenTechnique={(exercise) => hasExerciseTechnique(findCatalogExercise(catalog.exercises, exercise))}
          onOpenTechnique={(exercise) => { const meta = findCatalogExercise(catalog.exercises, exercise); if (hasExerciseTechnique(meta)) setTechniqueExercise(meta) }}
          showTrainerComments={!clientMode} entryMode={completedMode ? 'fact' : 'plan'} hideEmptyAddAction previousResults={previousResultReferences} showRpeByDefault={showRpeByDefault} showRestByDefault={showRestByDefault} collapseInitialExercises={copiedWorkout || plannedFromFavorite} initialExercisesReady={formDraftReady} />
      </section>
      {prefillError && <p className="error">{prefillError}</p>}
      {mutation.error && <p className="error">{mutation.error.message}</p>}
      <div className="actions workout-action-row"><WorkoutCta pending={mutation.isPending} pendingLabel="Сохраняем…" disabled={exercises.length === 0}>{recordPlannedResult ? 'Сохранить результат' : recordCompleted ? 'Записать тренировку' : completedMode ? 'Сохранить изменения' : 'Сохранить план'}</WorkoutCta></div>
    </form>}</AsyncView>
    {pickerOpen && <ExercisePicker catalog={catalog} clientRecent={clientRecentExercises} initialSearch={pickerSearch} initialMode={parsedExerciseSelection.current ? 'all' : replaceIndex === null && exercises.length === 0 ? 'choose' : 'all'} techniqueActionLabel={parsedExerciseSelection.current ? 'Выбрать упражнение' : replaceIndex === null ? 'Добавить упражнение' : 'Заменить упражнение'} onPick={pickExercise} onPickMany={pickExercises} selectionDraft={replaceIndex === null && !parsedExerciseSelection.current ? pickerSelectionDraft : undefined} onSelectionDraftChange={replaceIndex === null && !parsedExerciseSelection.current ? setPickerSelectionDraft : undefined} multiple={replaceIndex === null && !parsedExerciseSelection.current} onClose={closePicker} />}
    {techniqueExercise && <ExerciseTechniqueSheet exercise={techniqueExercise} onClose={() => setTechniqueExercise(null)} />}
    {confirmLeaveDialog}
  </Page>
}

function SaveFavoriteWorkoutSheet({ exercises, pending, error, onSave, onClose }: {
  exercises: readonly WorkoutExerciseModel[]
  pending: boolean
  error: Error | null
  onSave: (title: string) => void
  onClose: () => void
}) {
  const [title, setTitle] = useState('')
  // Пустое поле — не значит «без названия»: подсказка уже показывает то же
  // имя, что клиент видит заголовком завершённой тренировки, и станет
  // реальным названием, если он ничего не введёт сам.
  const placeholder = workoutFocusTitle(muscleGroupLabels(exercises))
  return <div className="sheet-overlay" onClick={() => !pending && onClose()}>
    <section className="workout-decision-sheet" role="dialog" aria-modal="true" aria-label="Сохранить в избранное" onClick={(event) => event.stopPropagation()}>
      <header className="picker-header"><h2>Сохранить в избранное</h2><button type="button" className="picker-close" aria-label="Закрыть" disabled={pending} onClick={onClose}><CloseIcon /></button></header>
      <form className="stack compact" onSubmit={(event) => { event.preventDefault(); onSave(title.trim() || placeholder) }}>
        <Field label="Название"><input value={title} maxLength={120} placeholder={placeholder} autoFocus onChange={(event) => setTitle(event.target.value)} /></Field>
        {error && <p className="error" role="alert">{error.message}</p>}
        <div className="actions workout-action-row">
          <WorkoutCta type="button" variant="tertiary" disabled={pending} onClick={onClose}>Отмена</WorkoutCta>
          <WorkoutCta type="submit" pending={pending} pendingLabel="Сохраняем…">Сохранить</WorkoutCta>
        </div>
      </form>
    </section>
  </div>
}

export function WorkoutDetailPage() {
  const { favoriteWorkouts: favoriteWorkoutsRepository, goals: goalsRepository, invitations: invitationsRepository, workouts: workoutsRepository } = useDataBackend()
  const { workoutId = '' } = useParams(); const navigate = useNavigate(); const location = useLocation(); const queryClient = useQueryClient()
  const navigationState = location.state as WorkoutNavigationState | null
  const { actor } = useAuth()
  const catalog = useExerciseCatalog()
  const showRpe = useRpeDisplay(actor?.userId)
  const [confirm, confirmDialog] = useConfirm()
  const [askActiveWorkoutRecovery, activeWorkoutRecoveryDialog] = useConfirm()
  const [decisionSheet, setDecisionSheet] = useState<'actions' | 'reschedule' | null>(null)
  const [favoriteSheetOpen, setFavoriteSheetOpen] = useState(false)
  const [rescheduleDate, setRescheduleDate] = useState<LocalDate>(() => todayInTimeZone(actor?.timezone))
  const [rescheduleTime, setRescheduleTime] = useState('')
  const [firstPlanInviteCode, setFirstPlanInviteCode] = useState<string | null>(null)
  const query = useQuery({ queryKey: ['workout', workoutId], queryFn: () => workoutsRepository.get(workoutId) })
  const clientMode = actor?.role === 'client'
  const justCompleted = query.data?.status === 'done' && navigationState?.justCompleted === true
  const clientCompletionReport = Boolean(justCompleted && clientMode)
  const backTo = workoutListFallback(actor?.role === 'client', query.data?.clientId)
  const goBack = useWorkoutBack(backTo)
  const childNavigationState: WorkoutNavigationState = { returnTo: `${location.pathname}${location.search}`, fromWorkoutDetailId: workoutId }
  function openLive(id: string) {
    if (id === workoutId) {
      // Keep the existing detail entry and its origin for Back/completion.
      // The completion card appears only when the workout data becomes done.
      void navigate(`${location.pathname}${location.search}`, { replace: true, state: { ...navigationState, justCompleted: true } })
    }
    void navigate(`/workouts/${id}/live`, { state: { ...childNavigationState, fromWorkoutDetailId: id === workoutId ? id : undefined } })
  }
  const completionHistory = useQuery({ queryKey: ['workouts', query.data?.clientId], queryFn: () => workoutsRepository.list(undefined, undefined, query.data!.clientId), enabled: actor?.role === 'client' && navigationState?.justCompleted === true && query.data?.status === 'done' })
  const completionRecords = useQuery({
    queryKey: ['workout-personal-records', workoutId],
    queryFn: () => workoutsRepository.personalRecords(workoutId),
    enabled: actor?.role !== 'client' && navigationState?.justCompleted === true && query.data?.status === 'done',
  })
  useClientRealtime(query.data?.clientId)
  // Этап тренировки: get() отдаёт stageId, название берём из цели клиента.
  const goal = useQuery({ queryKey: ['client-goal', query.data?.clientId], queryFn: () => goalsRepository.get(query.data!.clientId), enabled: Boolean(query.data?.stageId && query.data?.clientId) })
  const stageTitle = query.data?.stageId ? goal.data?.stages.find((stage) => stage.id === query.data!.stageId)?.title ?? null : null
  const start = useMutation({
    mutationFn: async () => {
      const active = await workoutsRepository.findActive(query.data!.clientId)
      if (active && active.id !== workoutId) return { kind: 'active' as const, workout: active }
      await workoutsRepository.start(query.data!)
      return { kind: 'started' as const, workoutId }
    },
    onSuccess: async (result) => {
      if (result.kind === 'active') {
        const shouldResume = await askActiveWorkoutRecovery({
          message: `У ${query.data!.clientName} уже есть незавершённая тренировка от ${formatLocalDate(result.workout.workoutDate)}. Откройте её, чтобы продолжить или завершить.`,
          confirmLabel: 'Открыть незавершённую',
          cancelLabel: 'Остаться в плане',
        })
        if (shouldResume) openLive(result.workout.id)
        return
      }
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['workout', workoutId] }), queryClient.invalidateQueries({ queryKey: ['clients'] })])
      openLive(result.workoutId)
    },
    onError: async (error) => {
      if (error instanceof Error && 'code' in error && error.code === 'active_workout_exists') {
        const active = await workoutsRepository.findActive(query.data!.clientId)
        if (active) {
          const shouldResume = await askActiveWorkoutRecovery({
            message: `У ${query.data!.clientName} уже есть незавершённая тренировка от ${formatLocalDate(active.workoutDate)}. Откройте её, чтобы продолжить или завершить.`,
            confirmLabel: 'Открыть незавершённую',
            cancelLabel: 'Остаться в плане',
          })
          if (shouldResume) openLive(active.id)
        }
      }
    },
  })
  const invalidateWorkoutSurfaces = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['workout', workoutId] }),
      invalidateWorkoutResults(queryClient),
      queryClient.invalidateQueries({ queryKey: ['today-workouts'] }),
      queryClient.invalidateQueries({ queryKey: ['workout-regularity'] }),
      queryClient.invalidateQueries({ queryKey: ['clients'] }),
      queryClient.invalidateQueries({ queryKey: ['trainer-attention'] }),
    ])
  }
  const cancelPlanned = useMutation({
    mutationFn: () => workoutsRepository.cancelPlanned(query.data!),
    onSuccess: async () => { setDecisionSheet(null); await invalidateWorkoutSurfaces() },
  })
  const reschedule = useMutation({
    mutationFn: () => workoutsRepository.reschedule(query.data!, rescheduleDate, rescheduleTime || null),
    onSuccess: async () => { setDecisionSheet(null); await invalidateWorkoutSurfaces() },
  })
  const saveFavorite = useMutation({
    mutationFn: (title: string) => favoriteWorkoutsRepository.save(title, workoutToFavoriteTemplate(query.data!)),
    onSuccess: async () => {
      setFavoriteSheetOpen(false)
      await queryClient.invalidateQueries({ queryKey: ['favorite-workouts'] })
    },
  })
  const remove = useMutation({ mutationFn: () => workoutsRepository.remove(query.data!), onSuccess: async () => {
    if (actor?.userId) clearWorkoutInactivityReminder(actor.userId, workoutId)
    await Promise.all([invalidateWorkoutResults(queryClient), queryClient.invalidateQueries({ queryKey: ['clients'] })])
    goBack()
  } })
  const removeCompletedExercise = useMutation({
    mutationFn: ({ exerciseId, workout }: { exerciseId: string; exerciseName: string; workout: Workout }) => workoutsRepository.removeLiveExercise(workout, exerciseId),
    onSuccess: async () => {
      await Promise.all([
        invalidateWorkoutSurfaces(),
        queryClient.invalidateQueries({ queryKey: ['workout-personal-records', workoutId] }),
        queryClient.invalidateQueries({ queryKey: ['exercise-history', query.data!.clientId] }),
        queryClient.invalidateQueries({ queryKey: ['client-stats', query.data!.clientId] }),
        queryClient.invalidateQueries({ queryKey: ['client-progress-story-workouts', query.data!.clientId] }),
        queryClient.invalidateQueries({ queryKey: ['trainer-progress-story-workouts', query.data!.clientId] }),
      ])
    },
  })
  const review = useMutation({ mutationFn: (value: WorkoutTrainerResponseDraft) => workoutsRepository.setWorkoutReview(query.data!, value), onSuccess: async () => {
    await invalidateWorkoutSurfaces()
  } })
  const questionAnswer = useMutation({ mutationFn: (value: WorkoutQuestionAnswerDraft) => workoutsRepository.answerQuestion(query.data!, value), onSuccess: async () => {
    await invalidateWorkoutSurfaces()
  } })
  const feedback = useMutation({ mutationFn: (value: WorkoutFeedbackDraft) => workoutsRepository.submitFeedback(query.data!, value), onSuccess: async () => {
    await invalidateWorkoutSurfaces()
  } })
  const question = useMutation({ mutationFn: (value: string) => workoutsRepository.askQuestion(query.data!, value), onSuccess: invalidateWorkoutSurfaces })
  const firstPlanInvite = useMutation({
    mutationFn: () => invitationsRepository.create(query.data!.clientId, 'client'),
    onSuccess: setFirstPlanInviteCode,
  })
  const workout = query.data
  const done = workout?.status === 'done'
  const duration = workout ? workoutDurationLabel(workout.startedAt, workout.completedAt) : null
  const groups = workout ? muscleGroupLabels(workout.exercises) : []
  const tonnage = workout ? workoutTonnage(workout) : 0
  const sets = workout?.exercises.flatMap((exercise) => exercise.sets) ?? []
  const completedSets = sets.filter((set) => set.confirmedAt).length
  const clientOwned = clientMode && workout?.createdBy === actor.userId
  const trainerOwned = !clientMode && Boolean(workout && (!workout.createdBy || workout.createdBy === actor?.userId))
  const canManage = clientMode ? clientOwned : trainerOwned
  const canRemoveCompletedExercise = Boolean(done && workout && (clientMode || trainerOwned))
  const canExecute = clientMode || trainerOwned
  const clientAuthoredReadOnly = !clientMode && Boolean(workout && !trainerOwned)
  const canReview = !clientMode && Boolean(done && workout && (
    trainerOwned || (clientAuthoredReadOnly && workout.trainerId === actor?.userId)
  ))
  const trainers = useQuery({ queryKey: ['client-trainers', workout?.clientId], queryFn: () => invitationsRepository.listTrainers(workout!.clientId), enabled: clientMode && Boolean(workout?.clientId) })
  const hasActiveTrainer = Boolean(trainers.data?.length)
  const completionPersonalResult = useMemo(
    () => latestWorkoutFact(completionHistory.data ?? [], workoutId).result,
    [completionHistory.data, workoutId],
  )
  const completionVolumeComparison = useMemo(
    () => workout ? workoutVolumeComparison(workout, completionHistory.data ?? []) : null,
    [completionHistory.data, workout],
  )
  const completedExercises = workout?.exercises.filter((exercise) => exercise.sets.length > 0 && exercise.sets.every((set) => Boolean(set.confirmedAt))).length ?? 0
  const incompleteExercises = workout?.exercises.flatMap((exercise) => {
    const missingSets = exercise.sets.filter((set) => !set.confirmedAt).length
    return missingSets > 0 ? [`${exercise.name} — ${missingSets} ${setCountLabel(missingSets)}`] : []
  }) ?? []
  const authorLabel = workout ? clientWorkoutAuthorLabel(workout.createdBy, workout.origin, actor?.userId, trainers.data) : null
  const responseAuthor = trainers.data?.find((trainer) => trainer.trainerId === workout?.trainerReviewAuthorId)
  const responseAuthorName = responseAuthor ? [responseAuthor.firstName, responseAuthor.lastName].filter(Boolean).join(' ') : null
  const today = todayInTimeZone(actor?.timezone)
  const statusPresentation = workout ? workoutStatusPresentation(workout, today) : null
  const detailState: WorkoutUiState = statusPresentation?.tone === 'done' ? 'completed'
    : statusPresentation?.tone === 'partial' ? 'partial'
      : statusPresentation?.tone === 'in_progress' ? 'current'
        : statusPresentation?.tone === 'decision' ? 'decision'
          : statusPresentation?.tone === 'cancelled' ? 'cancelled'
          : 'planned'
  const plannedActions = workout?.status === 'planned' ? plannedWorkoutActionLabels(workout.workoutDate, today) : null
  const requestWorkoutRemoval = async () => {
    if (await confirm({ message: 'Удалить тренировку?', confirmLabel: 'Удалить', danger: true })) remove.mutate()
  }
  const requestCompletedExerciseRemoval = async (exercise: WorkoutExerciseModel) => {
    if (await confirm({
      message: `Удалить «${exercise.name}» из результата тренировки вместе со всеми подходами?`,
      confirmLabel: 'Удалить',
      danger: true,
    })) removeCompletedExercise.mutate({ exerciseId: exercise.id, exerciseName: exercise.name, workout: query.data! })
  }
  const requestCancelPlanned = async () => {
    setDecisionSheet(null)
    if (await confirm({
      message: 'Сохранить как «Не состоялась»? План останется в истории и не будет учитываться как выполненная тренировка.',
      confirmLabel: 'Сохранить',
    })) cancelPlanned.mutate()
  }
  const openReschedule = () => {
    setRescheduleDate(today)
    setRescheduleTime(workout?.startTime?.slice(0, 5) ?? '')
    setDecisionSheet('reschedule')
  }
  const manageMenuInHeader = Boolean(clientMode && canManage && workout && !done)
  const workoutManageItems = [
    ...(clientMode ? [{ label: 'В избранное', onClick: () => setFavoriteSheetOpen(true) }] : []),
    { label: 'Копировать тренировку', onClick: () => navigate(`/workouts/new?copy=${workoutId}`, { state: childNavigationState }) },
    { label: 'Удалить тренировку', danger: true, disabled: remove.isPending, onClick: () => { void requestWorkoutRemoval() } },
  ]
  const exerciseCards = <div className={`cards ${done ? 'completed-exercise-list' : 'planned-exercise-list'}`}>{groupIntoBlocks(workout?.exercises ?? []).map((block) => {
    const articles = block.exercises.map((exercise) => {
      const detailSummary = compactExerciseDetailSummary(exercise.inputKind, exercise.sets, done ? 'completed' : 'planned', showRpe, exercise.ref)
      const exerciseMeta = findCatalogExercise(catalog.exercises, exercise) ?? exercise
      return <WorkoutExercise state={done ? 'history' : 'planned'} className={`exercise ${done ? 'completed-exercise' : 'planned-detail-exercise'}`} key={exercise.id}>
        <div className="workout-detail-exercise-row">
          <ExerciseThumbnail exercise={exerciseMeta} />
          <details className={done ? 'completed-exercise-details' : 'planned-exercise-details'}>
            <summary className={done ? 'completed-set-summary' : 'planned-set-summary'}>
              <span className="workout-detail-exercise-heading"><strong>{exercise.name}</strong><span className="exercise-details-chevron" aria-hidden="true" /></span>
              <span className="workout-detail-exercise-result">{detailSummary}</span>
            </summary>
            <WorkoutSetTable variant="history" inputKind={exercise.inputKind} showRpe={false} columnLabels={[done ? 'Результат' : 'План']} className="workout-history-sets">
              {exercise.sets.map((set, index) => <WorkoutHistorySet key={set.id} set={set} index={index} done={done} showRpe={showRpe} exerciseRef={exercise.ref} />)}
            </WorkoutSetTable>
          </details>
          <div className="workout-detail-exercise-actions">
            <Link className="exercise-history-link" aria-label={`История упражнения «${exercise.name}»`} to={`/workouts/${workout?.id}/history/${encodeURIComponent(exercise.ref)}`}><HistoryIcon /><span className="sr-only">История</span></Link>
            {canRemoveCompletedExercise && <OverflowMenu label={`Действия с упражнением «${exercise.name}»`} items={[{
              label: 'Удалить упражнение', danger: true, disabled: removeCompletedExercise.isPending,
              onClick: () => { void requestCompletedExerciseRemoval(exercise) },
            }]} />}
          </div>
        </div>
        {exercise.trainerComment && <p className="exercise-comment-note">{exercise.trainerComment}</p>}
        {exercise.clientNote && <p className="exercise-comment-note">Заметка: {exercise.clientNote}</p>}
      </WorkoutExercise>
    })
    if (block.blockType === 'single' || block.exercises.length === 1) return articles
    return <div className={`exercise-block view${done ? ' completed-exercise-block' : ''}`} key={block.blockId}><span className="block-badge">{blockLabel(block.blockType, block.blockPreset)} · {block.blockRounds} кр.</span>{articles}</div>
  })}</div>
  return <Page title="Тренировка" hideTitle className={`workout-detail-page${clientCompletionReport ? ' workout-completion-page' : ''}`} back={backTo} onBack={goBack}>
    <AsyncView loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>{workout && <>
      {!clientMode && navigationState?.firstPlanClient && <section className="first-plan-success" aria-labelledby="first-plan-success-title">
        <div><p className="eyebrow">ГОТОВО</p><h2 id="first-plan-success-title">Тренировка запланирована</h2><p>Первый план для {navigationState.firstPlanClient.fullName} готов.</p></div>
        {firstPlanInviteCode ? <InvitationCodeCard code={firstPlanInviteCode} label="Код приглашения" description="Отправьте код спортсмену — после подключения он сразу увидит план." /> : <button className="primary wide" disabled={firstPlanInvite.isPending} onClick={() => firstPlanInvite.mutate()}>{firstPlanInvite.isPending ? 'Создаём приглашение…' : 'Пригласить спортсмена'}</button>}
        {firstPlanInvite.error && <p className="error" role="alert">{firstPlanInvite.error.message}</p>}
        <Link className="button secondary wide" to="/today">Перейти на главную</Link>
      </section>}
      {clientCompletionReport && <WorkoutCompletionReport
        date={formatLocalDate(workout.workoutDate)}
        completedSets={completedSets}
        totalSets={sets.length}
        completedExercises={completedExercises}
        totalExercises={workout.exercises.length}
        incompleteExercises={incompleteExercises}
        duration={duration && duration !== '0 мин' ? duration : null}
        tonnage={tonnage > 0 ? tonnageLabel(tonnage) : null}
        caloriesKcal={workout.activeCaloriesKcal}
        muscleGroups={groups}
        personalResult={completionPersonalResult}
        resultLoading={completionHistory.isLoading}
        resultError={completionHistory.error}
        onRetryResult={() => void completionHistory.refetch()}
        volumeComparison={completionVolumeComparison}
        comparisonLoading={completionHistory.isLoading}
        hasTrainer={hasActiveTrainer}
      />}
      {justCompleted && !clientMode && <WorkoutCompletionCard completedSets={completedSets} totalSets={sets.length} record={completionRecords.data?.[0]} clientMode={false} clientId={workout.clientId} />}
      {!clientCompletionReport && <WorkoutHeader eyebrow={clientMode && done ? 'ТРЕНИРОВКА ЗАВЕРШЕНА' : clientMode ? 'ВАША ТРЕНИРОВКА' : 'ТРЕНИРОВКА КЛИЕНТА'} title={clientMode ? (done ? workoutFocusTitle(groups) : 'Ваша тренировка') : workout.clientName} state={detailState}
        statusLabel={statusPresentation?.label}
        showStatus={detailState !== 'completed'}
        action={manageMenuInHeader ? <OverflowMenu label="Другие действия с тренировкой" items={workoutManageItems} /> : undefined}
        meta={<><span>{formatLocalDate(workout.workoutDate)} · {workout.startTime?.slice(0, 5) ?? 'без времени'}</span>{clientMode && !done && authorLabel && <span>{authorLabel}</span>}{clientAuthoredReadOnly && <span>Создано клиентом · только просмотр</span>}{stageTitle && <span>Цель: {stageTitle}</span>}</>} />}
      {plannedActions && canExecute && <div className="workout-detail-primary-actions">
        {workout.workoutDate < today ? <Coachmark id="missed-workout-actions-2026-08" userId={actor?.userId} title="План можно закрыть спокойно" description="Запишите результат, перенесите тренировку или сохраните, что она не состоялась.">
          <WorkoutCta className="wide" pending={start.isPending || cancelPlanned.isPending || reschedule.isPending} pendingLabel="Сохраняем…" onClick={() => setDecisionSheet('actions')}>{plannedActions.primary}</WorkoutCta>
        </Coachmark> : <WorkoutCta className="wide" pending={start.isPending} pendingLabel={plannedActions.pending} onClick={() => start.mutate()}>{plannedActions.primary}</WorkoutCta>}
      </div>}
      {workout.status === 'cancelled' && canExecute && <div className="workout-detail-primary-actions"><WorkoutCta className="wide" variant="secondary" onClick={openReschedule}>Вернуть в план</WorkoutCta></div>}
      {start.error && !(start.error instanceof Error && 'code' in start.error && start.error.code === 'active_workout_exists') && <p className="error">{start.error.message}</p>}
      {workout.status === 'in_progress' && canExecute && <Link className="button primary wide" to={`/workouts/${workoutId}/live`} onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        openLive(workoutId)
      }}>Продолжить тренировку</Link>}
      {done && !clientCompletionReport && <section className={`workout-fact-summary${workout.activeCaloriesKcal ? ' has-calories' : ''}`} aria-label="Сводка тренировки">
        <p><span>Время</span><strong>{duration && duration !== '0 мин' ? duration : '—'}</strong></p>
        <p><span>Тоннаж</span><strong>{tonnage > 0 ? tonnageLabel(tonnage) : '—'}</strong></p>
        {workout.activeCaloriesKcal && <p><span>Оценка ФИТ</span><strong>≈ {workout.activeCaloriesKcal} ккал</strong></p>}
        <p><span>Подходы</span><strong>{completedSets}</strong></p>
        {groups.length > 0 && <p className="workout-fact-summary-groups"><span>Группы мышц</span><strong>{groups.join(' · ')}</strong></p>}
        {clientMode && workout.hasPr && <p className="workout-fact-summary-record"><RecordIcon /><span>Личный рекорд</span><strong>Лучший результат тренировки</strong></p>}
      </section>}
      {done && <WorkoutClientFeedback workout={workout} canEdit={clientMode} saving={feedback.isPending} error={feedback.error} onSave={(value) => feedback.mutateAsync(value)} />}
      {done && clientMode && hasActiveTrainer && !clientCompletionReport && <WorkoutClientQuestion workout={workout} saving={question.isPending} error={question.error} onSave={(value) => question.mutateAsync(value)} />}
      {done && !clientMode && workout.clientQuestion && <WorkoutTrainerQuestion workout={workout} canReply={canReview} startEditing={new URLSearchParams(location.search).get('reply') === '1'} authorName={responseAuthorName} saving={questionAnswer.isPending} error={questionAnswer.error} onSave={(value) => questionAnswer.mutateAsync(value)} />}
      {done && (clientMode || !workout.clientQuestion) && <WorkoutTrainerReview workout={workout} canEdit={canReview} authorName={responseAuthorName} saving={review.isPending} error={review.error} onSave={(value) => review.mutateAsync(value)} />}
      {!clientMode && workout.clientComment && workout.sessionRpe === undefined && <WorkoutClientComment workout={workout} />}
      {!done && <div className="workout-detail-exercise-overview"><p>ПЛАН ТРЕНИРОВКИ</p><span>{workout.exercises.length} {exerciseCountLabel(workout.exercises.length)} · {sets.length} {setCountLabel(sets.length)}</span></div>}
      {clientCompletionReport ? <details className="workout-completion-recorded">
        <summary><span><span className="eyebrow">РЕЗУЛЬТАТ</span><strong>Что записано</strong></span><span>{workout.exercises.length} {exerciseCountLabel(workout.exercises.length)}</span></summary>
        {exerciseCards}
        {canManage && <Link className="button secondary wide workout-completion-edit" to={`/workouts/${workoutId}/edit`} state={childNavigationState}>Исправить результат</Link>}
      </details> : exerciseCards}
      {removeCompletedExercise.error && <p className="error workout-exercise-removal-error" role="alert">Не удалось удалить упражнение. <button type="button" className="link" disabled={removeCompletedExercise.isPending} onClick={async () => {
        if (!removeCompletedExercise.variables) return
        const refreshed = await query.refetch()
        if (refreshed.data) removeCompletedExercise.mutate({ ...removeCompletedExercise.variables, workout: refreshed.data })
      }}>Повторить</button></p>}
      {workout.notes && !clientCompletionReport && <section className="workout-review workout-review-readonly"><div className="workout-review-head"><div><p className="eyebrow">{clientMode && !clientOwned ? 'ОТ ТРЕНЕРА' : 'К ТРЕНИРОВКЕ'}</p><h2>{clientMode && !clientOwned ? 'Инструкции' : 'Заметка'}</h2></div></div><p className="workout-review-text">{workout.notes}</p></section>}
      {clientCompletionReport && <div className="workout-completion-actions">
        <Link className="button primary wide" to="/me" replace>Готово</Link>
        <Link className="button secondary wide" to="/me/progress">Посмотреть прогресс</Link>
      </div>}
      {canManage && !clientCompletionReport && <div className="actions workout-detail-actions">
        {(workout.status === 'planned' || done) && <Link className="button secondary" to={`/workouts/${workoutId}/edit`} state={childNavigationState}>{done ? 'Изменить результат' : 'Изменить'}</Link>}
        {!manageMenuInHeader && <OverflowMenu label="Другие действия с тренировкой" items={workoutManageItems} />}
      </div>}
      {clientAuthoredReadOnly && <div className="actions"><Link className="button secondary" to={`/workouts/new?copy=${workoutId}`} state={childNavigationState}>Скопировать и отправить план</Link></div>}
      {clientMode && !clientOwned && <div className="actions"><Link className="button secondary" to={`/workouts/new?copy=${workoutId}`} state={childNavigationState}>Создать свою копию</Link></div>}
      {remove.error && <p className="error">{remove.error.message}</p>}
      {cancelPlanned.error && <p className="error" role="alert">{cancelPlanned.error.message}</p>}
      {reschedule.error && <p className="error" role="alert">{reschedule.error.message}</p>}
      {decisionSheet && <div className="sheet-overlay" onClick={() => !cancelPlanned.isPending && !reschedule.isPending && setDecisionSheet(null)}>
        <section className="workout-decision-sheet" role="dialog" aria-modal="true" aria-label={decisionSheet === 'actions' ? 'Действия с планом' : workout.status === 'cancelled' ? 'Вернуть тренировку в план' : 'Перенести тренировку'} onClick={(event) => event.stopPropagation()}>
          <header className="picker-header"><div><p className="eyebrow">ПЛАН НА {formatLocalDate(workout.workoutDate)}</p><h2>{decisionSheet === 'actions' ? 'Что сделать с планом?' : workout.status === 'cancelled' ? 'Вернуть в план' : 'Перенести тренировку'}</h2></div><button type="button" className="picker-close" aria-label="Закрыть" disabled={cancelPlanned.isPending || reschedule.isPending} onClick={() => setDecisionSheet(null)}><CloseIcon /></button></header>
          {decisionSheet === 'actions' ? <div className="workout-decision-actions">
            <WorkoutCta onClick={() => { setDecisionSheet(null); navigate(`/workouts/${workoutId}/edit?result=1`, { state: childNavigationState }) }}>Записать результат</WorkoutCta>
            <WorkoutCta variant="secondary" onClick={openReschedule}>Перенести тренировку</WorkoutCta>
            <WorkoutCta variant="tertiary" pending={cancelPlanned.isPending} pendingLabel="Сохраняем…" onClick={() => void requestCancelPlanned()}>Тренировка не состоялась</WorkoutCta>
          </div> : <form className="stack compact" onSubmit={(event) => { event.preventDefault(); reschedule.mutate() }}>
            <Field label="Новая дата"><input type="date" min={today} value={rescheduleDate} onChange={(event) => setRescheduleDate(localDate(event.target.value))} required /></Field>
            <Field label="Время"><input type="time" value={rescheduleTime} onChange={(event) => setRescheduleTime(event.target.value)} /></Field>
            <div className="actions workout-action-row"><WorkoutCta type="button" variant="tertiary" disabled={reschedule.isPending} onClick={() => workout.status === 'cancelled' ? setDecisionSheet(null) : setDecisionSheet('actions')}>Назад</WorkoutCta><WorkoutCta type="submit" pending={reschedule.isPending} pendingLabel="Сохраняем…">{workout.status === 'cancelled' ? 'Вернуть в план' : 'Перенести'}</WorkoutCta></div>
          </form>}
        </section>
      </div>}
      {favoriteSheetOpen && workout && <SaveFavoriteWorkoutSheet exercises={workout.exercises} pending={saveFavorite.isPending} error={saveFavorite.error}
        onSave={(title) => saveFavorite.mutate(title)} onClose={() => { saveFavorite.reset(); setFavoriteSheetOpen(false) }} />}
      {confirmDialog}{activeWorkoutRecoveryDialog}
    </>}</AsyncView>
  </Page>
}

const wellbeingLabels: Record<WorkoutWellbeing, string> = {
  good: 'Хорошо',
  normal: 'Нормально',
  hard: 'Плохо',
}

const trainerReactionLabels: Record<TrainerReaction, string> = {
  thumbs_up: '👍',
  fire: '🔥',
  strong: '💪',
}

function trainerResponseTime(value: string | undefined) {
  if (!value) return null
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value))
}

function WorkoutClientFeedback({ workout, canEdit, saving, error, onSave }: {
  workout: Workout
  canEdit: boolean
  saving: boolean
  error: Error | null
  onSave: (value: WorkoutFeedbackDraft) => Promise<unknown>
}) {
  const hasFeedback = workout.sessionRpe !== undefined && workout.wellbeing !== undefined && workout.discomfort !== undefined
  const [editing, setEditing] = useState(canEdit && !hasFeedback)
  const [saved, setSaved] = useState(false)
  const [sessionRpe, setSessionRpe] = useState<number | undefined>(workout.sessionRpe)
  const [wellbeing, setWellbeing] = useState<WorkoutWellbeing | undefined>(workout.wellbeing)
  const [discomfort, setDiscomfort] = useState<boolean | undefined>(workout.discomfort ?? (workout.clientComment ? true : undefined))
  const [comment, setComment] = useState(workout.clientComment ?? '')
  const [noteOpen, setNoteOpen] = useState(Boolean(workout.clientComment))

  useEffect(() => {
    if (editing) return
    setSessionRpe(workout.sessionRpe)
    setWellbeing(workout.wellbeing)
    setDiscomfort(workout.discomfort ?? (workout.clientComment ? true : undefined))
    setComment(workout.clientComment ?? '')
    setNoteOpen(Boolean(workout.clientComment))
  }, [editing, workout.clientComment, workout.discomfort, workout.id, workout.sessionRpe, workout.wellbeing])

  if (!canEdit && !hasFeedback) return null
  const needsExplanation = discomfort === true || (sessionRpe ?? 0) >= 9
  const showNote = noteOpen || needsExplanation
  const valid = sessionRpe !== undefined && wellbeing !== undefined && discomfort !== undefined
    && (!needsExplanation || comment.trim().length > 0)

  if (!editing) return <section className="workout-review workout-feedback workout-review-readonly" aria-labelledby="workout-feedback-title">
    <div className="workout-review-head">
      <div><h2 id="workout-feedback-title">Итоги тренировки</h2></div>
      {canEdit && <button type="button" className="secondary" onClick={() => { setSaved(false); setEditing(true) }}>Изменить</button>}
    </div>
    {saved && <p className="workout-feedback-confirmation" role="status">{workoutFeedbackConfirmation()}</p>}
    <div className="workout-feedback-summary">
      <p><span>Нагрузка</span><strong>RPE {workout.sessionRpe}/10</strong></p>
      <p><span>Самочувствие после</span><strong>{workout.wellbeing ? wellbeingLabels[workout.wellbeing] : '—'}</strong></p>
      <p><span>Боль</span><strong>{workout.discomfort ? 'Да' : 'Нет'}</strong></p>
    </div>
    {workout.clientComment && <p className="workout-review-text"><strong>Заметка:</strong> {workout.clientComment}</p>}
  </section>

  return <form className="workout-review workout-feedback" aria-labelledby="workout-feedback-title" onSubmit={async (event) => {
    event.preventDefault()
    if (!valid || sessionRpe === undefined || wellbeing === undefined || discomfort === undefined) return
    try {
      await onSave({ sessionRpe, wellbeing, discomfort, comment: showNote ? comment : '' })
      setSaved(true)
      setEditing(false)
    } catch {
      // Ошибка мутации остаётся рядом с формой; пользователь может повторить
      // тот же submit, а RPC безопасно дедуплицирует потерянный ответ.
    }
  }}>
    <div className="workout-review-head"><div><h2 id="workout-feedback-title">Как прошла тренировка?</h2></div></div>
    <fieldset className="workout-feedback-fieldset">
      <legend>Нагрузка</legend>
      <WorkoutRpeScale aria-label="Нагрузка по шкале RPE" value={sessionRpe} disabled={saving} onChange={setSessionRpe} />
    </fieldset>
    <fieldset className="workout-feedback-fieldset">
      <legend>Самочувствие после</legend>
      <div className="workout-feedback-options">
        {(Object.keys(wellbeingLabels) as WorkoutWellbeing[]).map((value) => <WorkoutChoice key={value} className="workout-feedback-option" selected={wellbeing === value} disabled={saving} onClick={() => setWellbeing(value)}>{wellbeingLabels[value]}</WorkoutChoice>)}
      </div>
    </fieldset>
    <fieldset className="workout-feedback-fieldset">
      <legend>Боль или дискомфорт?</legend>
      <div className="workout-feedback-options">
        <WorkoutChoice className="workout-feedback-option" selected={discomfort === false} disabled={saving} onClick={() => setDiscomfort(false)}>Нет</WorkoutChoice>
        <WorkoutChoice className="workout-feedback-option" selected={discomfort === true} tone="destructive" disabled={saving} onClick={() => setDiscomfort(true)}>Да</WorkoutChoice>
      </div>
    </fieldset>
    {!showNote && <button type="button" className="link workout-feedback-note-toggle" disabled={saving} onClick={() => setNoteOpen(true)}>Добавить заметку</button>}
    {showNote && <Field label={discomfort ? 'Где и насколько сильно?' : (sessionRpe ?? 0) >= 9 ? 'Почему было настолько тяжело?' : 'Заметка'}>
      <textarea aria-label="Заметка к итогам тренировки" rows={3} maxLength={500}
        placeholder={discomfort ? 'Например: правое плечо, умеренно, при жиме' : (sessionRpe ?? 0) >= 9 ? 'Например: не восстановился или не выспался' : 'Что важно отметить?'}
        value={comment} onChange={(event) => setComment(event.target.value)} />
    </Field>}
    {showNote && !needsExplanation && <button type="button" className="link workout-feedback-note-toggle" disabled={saving} onClick={() => { setNoteOpen(false); setComment('') }}>Убрать заметку</button>}
    {error && <p className="error">{error.message}</p>}
    <div className="actions workout-review-actions workout-action-row">
      {hasFeedback && <WorkoutCta type="button" variant="tertiary" disabled={saving} onClick={() => setEditing(false)}>Отмена</WorkoutCta>}
      <WorkoutCta type="submit" pending={saving} pendingLabel="Сохраняем…" disabled={!valid}>Сохранить итоги</WorkoutCta>
    </div>
  </form>
}

function WorkoutClientQuestion({ workout, saving, error, onSave }: {
  workout: Workout
  saving: boolean
  error: Error | null
  onSave: (value: string) => Promise<unknown>
}) {
  const unresolved = Boolean(workout.clientQuestion && !workout.clientQuestionResolvedAt)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [sent, setSent] = useState(false)

  useEffect(() => {
    if (!editing) setValue('')
  }, [editing, workout.clientQuestionResolvedAt])

  const openEditor = () => {
    setSent(false)
    setValue(unresolved ? workout.clientQuestion ?? '' : '')
    setEditing(true)
  }
  const closeEditor = () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    setEditing(false)
  }

  if (!editing) return <section className="workout-review workout-question workout-review-readonly" aria-labelledby="workout-question-title">
    <div className="workout-review-head">
      <div><p className="eyebrow">СВЯЗЬ С ТРЕНЕРОМ</p><h2 id="workout-question-title">Вопрос тренеру</h2></div>
      <button type="button" className="secondary" onClick={openEditor}>{unresolved ? 'Изменить' : 'Задать вопрос тренеру'}</button>
    </div>
    {sent && <p className="workout-feedback-confirmation" role="status">Вопрос отправлен</p>}
    {workout.clientQuestion && <><p className="workout-review-text">{workout.clientQuestion}</p><p className="workout-response-meta">{unresolved ? 'Тренер увидит вопрос в своём кабинете' : 'Вопрос закрыт'}</p></>}
    {!workout.clientQuestion && <p className="muted">Можно спросить тренера именно об этой тренировке.</p>}
  </section>

  const valid = value.trim().length > 0 && value.trim().length <= 500
  return <form className="workout-review workout-question" aria-labelledby="workout-question-title" onSubmit={async (event) => {
    event.preventDefault()
    if (!valid) return
    try {
      const textarea = event.currentTarget.querySelector('textarea')
      await onSave(value)
      textarea?.blur()
      setSent(true)
      setEditing(false)
    } catch {
      // Ошибка остаётся рядом с формой, повтор безопасен на уровне RPC.
    }
  }}>
    <div className="workout-review-head"><div><p className="eyebrow">СВЯЗЬ С ТРЕНЕРОМ</p><h2 id="workout-question-title">Вопрос тренеру</h2></div></div>
    <Field label="Напишите, что хотите уточнить по тренировке"><textarea rows={3} maxLength={500} placeholder="Например: правильно ли я выбрал вес?" value={value} onChange={(event) => setValue(event.target.value)} autoFocus /></Field>
    <p className="workout-response-limit muted">{value.length}/500</p>
    {error && <p className="error">{error.message}</p>}
    <div className="actions workout-review-actions workout-action-row"><WorkoutCta type="button" variant="tertiary" disabled={saving} onClick={closeEditor}>Отмена</WorkoutCta><WorkoutCta type="submit" pending={saving} pendingLabel="Отправляем…" disabled={!valid}>Отправить вопрос</WorkoutCta></div>
  </form>
}

function WorkoutTrainerQuestion({ workout, canReply, startEditing = false, authorName, saving, error, onSave }: {
  workout: Workout
  canReply: boolean
  startEditing?: boolean
  authorName: string | null
  saving: boolean
  error: Error | null
  onSave: (value: WorkoutQuestionAnswerDraft) => Promise<unknown>
}) {
  const unresolved = !workout.clientQuestionResolvedAt
  const responseBelongsToQuestion = Boolean(
    workout.trainerReviewedAt
    && workout.clientQuestionAskedAt
    && new Date(workout.trainerReviewedAt).getTime() >= new Date(workout.clientQuestionAskedAt).getTime(),
  )
  const currentReview = responseBelongsToQuestion ? workout.trainerReview ?? '' : ''
  const currentReaction = responseBelongsToQuestion ? workout.trainerReaction : undefined
  const [editing, setEditing] = useState(Boolean(startEditing && canReply && unresolved))
  const [value, setValue] = useState(currentReview)
  const [reaction, setReaction] = useState<TrainerReaction | undefined>(currentReaction)
  const valid = value.trim().length > 0 && value.trim().length <= 500

  useEffect(() => {
    if (startEditing && canReply && unresolved) setEditing(true)
  }, [canReply, startEditing, unresolved])

  useEffect(() => {
    if (!editing) {
      setValue(currentReview)
      setReaction(currentReaction)
    }
  }, [currentReaction, currentReview, editing, workout.id])

  const closeEditor = () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    setValue(currentReview)
    setReaction(currentReaction)
    setEditing(false)
  }

  return <section className="workout-review workout-question workout-review-readonly" aria-labelledby="trainer-workout-question-title">
    <div className="workout-review-head"><div><p className="eyebrow">ВОПРОС КЛИЕНТА</p><h2 id="trainer-workout-question-title">По этой тренировке</h2></div>{canReply && unresolved && !editing && <button type="button" className="secondary" disabled={saving} onClick={() => setEditing(true)}>Ответить</button>}</div>
    <p className="workout-review-text">{workout.clientQuestion}</p>
    {editing ? <form className="workout-question-answer" onFocusCapture={(event) => {
      const target = event.target
      if (!(target instanceof HTMLTextAreaElement)) return
      // iOS can scroll the root document together with scrollIntoView and keep
      // that offset after the keyboard closes. Move only the app content: the
      // shell itself must stay pinned to the viewport without a grey tail.
      window.setTimeout(() => {
        const content = target.closest('.content')
        if (!(content instanceof HTMLElement)) return
        const targetRect = target.getBoundingClientRect()
        const contentRect = content.getBoundingClientRect()
        const centeredTop = content.scrollTop + targetRect.top - contentRect.top - Math.max(16, (content.clientHeight - targetRect.height) / 2)
        content.scrollTo({ top: Math.max(0, centeredTop), behavior: 'smooth' })
      }, 180)
    }} onSubmit={async (event) => {
      event.preventDefault()
      if (!valid) return
      try {
        const textarea = event.currentTarget.querySelector('textarea')
        await onSave({ reaction, review: value })
        textarea?.blur()
        setEditing(false)
      } catch {
        // Ошибка остаётся в этой карточке; повтор ответа безопасен в RPC.
      }
    }}>
      <fieldset className="workout-feedback-fieldset workout-trainer-reactions">
        <legend>Реакция <span className="muted">· необязательно</span></legend>
        <div className="workout-feedback-options">
          {(Object.keys(trainerReactionLabels) as TrainerReaction[]).map((item) => <WorkoutChoice key={item} className="workout-feedback-option" selected={reaction === item} disabled={saving} aria-label={trainerReactionLabels[item]} onClick={() => setReaction((current) => current === item ? undefined : item)}>{trainerReactionLabels[item]}</WorkoutChoice>)}
        </div>
      </fieldset>
      <VoiceNoteField name="trainerQuestionAnswer" source="workout_question_answer" label="Ответ клиенту" placeholder="Коротко ответьте на вопрос" value={value} onValueChange={(next) => setValue(next.slice(0, 500))} autoResize />
      <p className="workout-response-limit muted">{value.length}/500</p>
      {error && <p className="error" role="alert">{error.message}</p>}
      <div className="actions workout-review-actions workout-action-row">
        <WorkoutCta type="button" variant="tertiary" disabled={saving} onClick={closeEditor}>Отмена</WorkoutCta>
        <WorkoutCta type="submit" pending={saving} pendingLabel="Отправляем…" disabled={!valid}>Отправить ответ</WorkoutCta>
      </div>
    </form> : <>
      {unresolved && <p className="workout-response-meta">Ждёт ответа</p>}
      {!unresolved && <p className="workout-response-meta">Вопрос закрыт</p>}
      {!unresolved && responseBelongsToQuestion && currentReview && <div className={`workout-response-body${currentReaction ? '' : ' without-reaction'}`}>
        {currentReaction && <span className="workout-response-reaction" aria-label={`Реакция ${trainerReactionLabels[currentReaction]}`}>{trainerReactionLabels[currentReaction]}</span>}
        <p className="workout-review-text">{currentReview}</p>
        {(authorName || workout.trainerReviewedAt) && <p className="workout-response-meta">{[authorName || 'Тренер', trainerResponseTime(workout.trainerReviewedAt)].filter(Boolean).join(' · ')}</p>}
      </div>}
      {error && <p className="error" role="alert">{error.message}</p>}
    </>}
  </section>
}

function WorkoutTrainerReview({ workout, canEdit, startEditing, authorName, saving, error, onSave }: {
  workout: Workout
  canEdit: boolean
  startEditing?: boolean
  authorName: string | null
  saving: boolean
  error: Error | null
  onSave: (value: WorkoutTrainerResponseDraft) => Promise<unknown>
}) {
  const [editing, setEditing] = useState(Boolean(startEditing && canEdit))
  const [value, setValue] = useState(workout.trainerReview ?? '')
  const [reaction, setReaction] = useState<TrainerReaction | undefined>(workout.trainerReaction)
  const hasReview = Boolean(workout.trainerReview)
  const valid = Boolean(reaction && value.trim().length > 0 && value.trim().length <= 500)

  useEffect(() => {
    if (!editing) {
      setValue(workout.trainerReview ?? '')
      setReaction(workout.trainerReaction)
    }
  }, [editing, workout.id, workout.trainerReaction, workout.trainerReview])

  if (!canEdit && !hasReview) return null

  return <section className={`workout-review ${editing ? '' : 'workout-review-readonly'}`} aria-labelledby="workout-review-title">
    <div className="workout-review-head">
      <div><p className="eyebrow">ПОСЛЕ ТРЕНИРОВКИ</p><h2 id="workout-review-title">Отзыв тренера</h2></div>
      {canEdit && !editing && <button type="button" className="secondary" onClick={() => setEditing(true)}>{hasReview ? 'Изменить' : 'Добавить'}</button>}
    </div>
    {editing ? <>
      <fieldset className="workout-feedback-fieldset workout-trainer-reactions">
        <legend>Реакция</legend>
        <div className="workout-feedback-options">
          {(Object.keys(trainerReactionLabels) as TrainerReaction[]).map((item) => <WorkoutChoice key={item} className="workout-feedback-option" selected={reaction === item} disabled={saving} aria-label={trainerReactionLabels[item]} onClick={() => setReaction(item)}>{trainerReactionLabels[item]}</WorkoutChoice>)}
        </div>
      </fieldset>
      <VoiceNoteField name="trainerReview" source="workout_review" label="Отзыв тренера" placeholder="Что получилось и на что обратить внимание дальше" value={value} onValueChange={(next) => setValue(next.slice(0, 500))} autoResize />
      <p className="workout-response-limit muted">{value.length}/500</p>
      {error && <p className="error">{error.message}</p>}
      <div className="actions workout-review-actions workout-action-row">
        <WorkoutCta type="button" variant="tertiary" disabled={saving} onClick={() => { setValue(workout.trainerReview ?? ''); setReaction(workout.trainerReaction); setEditing(false) }}>Отмена</WorkoutCta>
        <WorkoutCta type="button" pending={saving} pendingLabel="Сохраняем…" disabled={!valid} onClick={async () => {
          if (!reaction) return
          try {
            await onSave({ reaction, review: value })
            setEditing(false)
          } catch {
            // Ошибку мутации показывает общий экранный state ниже поля.
          }
        }}>Отправить ответ</WorkoutCta>
      </div>
    </> : hasReview ? <>
      <div className="workout-response-body">
        {workout.trainerReaction && <span className="workout-response-reaction" aria-label={`Реакция ${trainerReactionLabels[workout.trainerReaction]}`}>{trainerReactionLabels[workout.trainerReaction]}</span>}
        <p className="workout-review-text">{workout.trainerReview}</p>
      </div>
      {(authorName || workout.trainerReviewedAt) && <p className="workout-response-meta">{[authorName || 'Тренер', trainerResponseTime(workout.trainerReviewedAt)].filter(Boolean).join(' · ')}</p>}
    </> : <p className="muted">Добавьте реакцию и короткий ответ, пока впечатления свежие.</p>}
  </section>
}

function WorkoutClientComment({ workout }: { workout: Workout }) {
  return <section className="workout-review workout-review-readonly" aria-labelledby="workout-client-comment-title">
    <div className="workout-review-head"><div><p className="eyebrow">ОБРАТНАЯ СВЯЗЬ</p><h2 id="workout-client-comment-title">Комментарий клиента</h2></div></div>
    <p className="workout-review-text">{workout.clientComment}</p>
  </section>
}

function formatSet(set: WorkoutSet, showRpe: boolean, exerciseRef?: string) {
  const duration = durationLabel(set.durationSec, set.durationMin)
  const distance = runDistanceLabel(set.distanceKm)
  const rowing = isRowingExerciseRef(exerciseRef)
  const pace = rowing ? rowingPaceLabel(durationSeconds(set.durationSec, set.durationMin), set.distanceKm) : runPaceLabel(durationSeconds(set.durationSec, set.durationMin), set.distanceKm)
  const plan = [set.weightKg && `${set.weightKg} кг`, set.reps && `${set.reps} ${rowing ? 'гребков/мин' : 'повт.'}`, distance, duration, showRpe && set.rpe !== undefined && `RPE ${set.rpe}`].filter(Boolean).join(' × ')
  return pace && plan ? `${plan} · темп ${pace}` : plan || 'Подход без плана'
}

function WorkoutHistorySet({ set, index, done, showRpe, exerciseRef }: { set: WorkoutSet; index: number; done: boolean; showRpe: boolean; exerciseRef?: string }) {
  const confirmed = Boolean(set.confirmedAt)
  const { fact, planNote } = formatFactVsPlan(set, showRpe, exerciseRef)
  const result = done ? fact : formatSet(set, showRpe, exerciseRef)
  return <WorkoutSetRow state={done ? (confirmed ? 'completed' : 'skipped') : 'planned'} className={`workout-history-set ${confirmed ? 'confirmed' : 'missed'}`}>
    <span className="workout-set-number workout-history-set-number" aria-label={`Подход ${index + 1}`}>{index + 1}</span>
    <span className="workout-history-set-result"><strong>{result}</strong>
      {done && !confirmed && <span className="plan-note">не выполнено</span>}
      {done && confirmed && planNote && <span className="plan-note">{planNote}</span>}
    </span>
    {done && <span className="workout-history-set-status" aria-label={confirmed ? 'Выполнен' : 'Не выполнен'}>{confirmed ? '✓' : '—'}</span>}
  </WorkoutSetRow>
}


// Плановое значение подхода вторичной строкой («План: 100 кг × 10») по типу
// упражнения. Факт остаётся основным редактируемым полем, план — явно виден
// (раньше был только тусклым placeholder). null — если план не задан.
function planLine(inputKind: ExerciseSnapshot['inputKind'], set: WorkoutSet, exerciseRef?: string): string | null {
  const parts: string[] = []
  if (inputKind === 'strength') {
    if (set.weightKg !== undefined) parts.push(`${set.weightKg} кг`)
    if (set.reps !== undefined) parts.push(`${set.reps} повт.`)
  } else if (inputKind === 'reps') {
    const duration = durationLabel(set.durationSec, set.durationMin)
    if (duration) parts.push(duration)
    if (set.reps !== undefined) parts.push(`${set.reps} повт.`)
  } else if (inputKind === 'duration') {
    const duration = durationLabel(set.durationSec, set.durationMin)
    if (duration) parts.push(duration)
  } else {
    const duration = durationLabel(set.durationSec, set.durationMin)
    if (duration) parts.push(duration)
    const distance = runDistanceLabel(set.distanceKm)
    if (distance) parts.push(distance)
    if (isRowingExerciseRef(exerciseRef) && set.reps !== undefined) parts.push(`${set.reps} гребков/мин`)
  }
  if (set.rpe !== undefined) parts.push(`RPE ${set.rpe}`)
  const plan = parts.length ? parts.join(' × ') : null
  const pace = inputKind === 'distance'
    ? isRowingExerciseRef(exerciseRef)
      ? rowingPaceLabel(durationSeconds(set.durationSec, set.durationMin), set.distanceKm)
      : runPaceLabel(durationSeconds(set.durationSec, set.durationMin), set.distanceKm)
    : null
  return pace && plan ? `${plan} · темп ${pace}` : plan
}

// Одна ячейка факта в таблице подходов. В live основной сценарий — прямой
// ввод: компактное число открывает цифровую клавиатуру и не разворачивает
// строку в набор крупных степперов.
function LiveSetInput({ name, label, placeholder, defaultValue, step, disabled, inputKey, decimal = false, planHint = false, selectZero = false }: {
  name: string; label: string; placeholder: string; defaultValue: number | undefined
  step: number; disabled: boolean; inputKey: string; decimal?: boolean; planHint?: boolean; selectZero?: boolean
}) {
  return <input
    key={inputKey}
    className={`live-set-input${planHint ? ' plan-hint' : ''}`}
    aria-label={label}
    name={name}
    type="number"
    inputMode={decimal ? 'decimal' : 'numeric'}
    min="0"
    step={step}
    disabled={disabled}
    defaultValue={defaultValue}
    placeholder={placeholder}
    onFocus={(event) => { if (selectZero) prepareZeroReplacement(event.currentTarget) }}
    onInput={(event) => event.currentTarget.classList.remove('plan-hint')}
  />
}

function LiveSetFields({ inputKind, exerciseRef, set, editing = false, showRpe = false, carriedWeightKey = 'plan' }: { inputKind: ExerciseSnapshot['inputKind']; exerciseRef?: string; set: WorkoutSet; editing?: boolean; showRpe?: boolean; carriedWeightKey?: string }) {
  // После подтверждения показываем зафиксированный результат (факт, иначе план)
  // как обычное яркое значение в заблокированном поле, а не тусклый placeholder.
  // Правка по карандашику временно разблокирует поля (editing).
  const locked = Boolean(set.confirmedAt) && !editing
  // Ключ ремоунтит поля при смене режима (подтверждён / правка / ввод), чтобы
  // неконтролируемый defaultValue пересчитался и показал нужное значение.
  // В key добавлена version: после правки подтверждённого подхода факт меняется
  // и версия бампится — иначе стабильный key оставил бы старое значение в поле.
  const mode = locked ? 'locked' : editing ? 'editing' : 'edit'
  // В обычном вводе ответ автосохранения меняет version, но не должен
  // пересоздавать активный input: на iOS это закрывает клавиатуру и сдвигает
  // текущий подход. Версия нужна в key только для уже зафиксированного факта.
  const k = locked ? `${mode}-${set.version}` : mode
  // Факт при первом открытии начинается с плана: тренер видит готовые значения
  // и меняет только нужное. После выполнения приоритет остаётся у факта.
  const value = (fact: number | undefined, plan: number | undefined) => fact ?? plan
  const isPlanHint = (fact: number | undefined, plan: number | undefined) => !locked && fact === undefined && plan !== undefined
  const factDuration = durationSeconds(set.fact.durationSec, set.fact.durationMin)
  const planDuration = durationSeconds(set.durationSec, set.durationMin)
  const rpeField = showRpe ? <select className="live-set-rpe" name="rpe" aria-label="Фактический RPE" defaultValue={set.fact.rpe ?? set.rpe ?? ''} disabled={locked}>
    <option value="">—</option>
    {RPE_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
  </select> : null
  if (inputKind === 'strength') return <>
    <LiveSetInput name="weightKg" label="Фактический вес" placeholder="кг" defaultValue={value(set.fact.weightKg, set.weightKg)} planHint={isPlanHint(set.fact.weightKg, set.weightKg)} step={2.5} disabled={locked} inputKey={`w-${k}-${carriedWeightKey}`} decimal selectZero />
    <LiveSetInput name="reps" label="Фактические повторы" placeholder="повт." defaultValue={value(set.fact.reps, set.reps)} planHint={isPlanHint(set.fact.reps, set.reps)} step={1} disabled={locked} inputKey={`r-${k}`} selectZero />
    {rpeField}
  </>
  if (inputKind === 'reps') return <>
    <LiveSetInput name="durationSec" label="Фактическое время, сек" placeholder="сек" defaultValue={value(factDuration, planDuration)} planHint={isPlanHint(factDuration, planDuration)} step={15} disabled={locked} inputKey={`d-${k}`} />
    <LiveSetInput name="reps" label="Фактические повторы" placeholder="повт." defaultValue={value(set.fact.reps, set.reps)} planHint={isPlanHint(set.fact.reps, set.reps)} step={1} disabled={locked} inputKey={`r-${k}`} selectZero />
    {rpeField}
  </>
  if (inputKind === 'duration') return <>
    <LiveSetInput name="durationSec" label="Фактическое время, сек" placeholder="сек" defaultValue={value(factDuration, planDuration)} planHint={isPlanHint(factDuration, planDuration)} step={15} disabled={locked} inputKey={`d-${k}`} />
    <span className="live-set-empty" aria-hidden="true" />
    {rpeField}
  </>
  return <>
    <RunMetricsFields
      idPrefix={`live-run-${set.id}-${k}`}
      rowing={isRowingExerciseRef(exerciseRef)}
      durationSec={value(factDuration, planDuration)}
      distanceKm={value(set.fact.distanceKm, set.distanceKm)}
      strokeRate={value(set.fact.reps, set.reps)}
      inputClassName="live-set-input"
      disabled={locked}
      planDurationHint={isPlanHint(factDuration, planDuration)}
      planDistanceHint={isPlanHint(set.fact.distanceKm, set.distanceKm)}
      planStrokeRateHint={isPlanHint(set.fact.reps, set.reps)}
      durationName="runDuration"
      distanceName="runDistance"
      distanceUnitName="runDistanceUnit"
      strokeRateName="reps"
      durationLabel="Фактическое время"
      distanceLabel="Фактическая дистанция"
      distanceUnitLabel="Единица фактической дистанции"
    />
    {rpeField}
  </>
}

// Live elapsed workout time counting up from the start timestamp, "42:07".
function formatElapsed(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  const mm = String(minutes).padStart(2, '0')
  const ss = String(secs).padStart(2, '0')
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`
}

function WorkoutTimer({ startedAt, resting = false }: { startedAt: string | null; resting?: boolean }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const className = `live-timer${resting ? ' resting' : ''}`
  if (!startedAt) return <span className={className}><span className="live-dot-mark" aria-hidden="true" />LIVE</span>
  const elapsed = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000))
  return <span className={className}><span className="live-dot-mark" aria-hidden="true" />{formatElapsed(elapsed)}</span>
}

export function LiveWorkoutPage() {
  const { pushNotifications: pushNotificationsRepository, workouts: workoutsRepository } = useDataBackend()
  const { workoutId = '' } = useParams()
  const { actor } = useAuth()
  const { keyboardOpen } = useAppViewport()
  const showRpeByDefault = useRpeDisplay(actor?.userId)
  const showLiveExerciseAnimation = useLiveExerciseAnimation(actor?.userId)
  const clientMode = actor?.role === 'client'
  const navigate = useNavigate()
  const location = useLocation()
  const navigationState = location.state as WorkoutNavigationState | null
  const goBack = useWorkoutBack(`/workouts/${workoutId}`)
  const fromDetail = navigationState?.fromWorkoutDetailId === workoutId
  const sourceReturnTo = safeWorkoutReturnTo(navigationState?.returnTo)
  const completionNavigated = useRef(false)
  const showCompletedWorkout = useCallback((justCompleted: boolean) => {
    // Refetch and StrictMode may repeat the completion effect. POP is not
    // idempotent: a second call would skip the detail and lose the source.
    if (completionNavigated.current) return
    completionNavigated.current = true
    if (fromDetail && hasWorkoutBackEntry()) void navigate(-1)
    else void navigate(`/workouts/${workoutId}`, { replace: true, state: { justCompleted, returnTo: sourceReturnTo } })
  }, [fromDetail, navigate, sourceReturnTo, workoutId])
  const [askConfirm, confirmDialog] = useConfirm()
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['workout', workoutId], queryFn: async () => {
    const incoming = await workoutsRepository.get(workoutId)
    return reconcileLiveWorkout(queryClient.getQueryData<Workout>(['workout', workoutId]), incoming)
  } })
  const reminderPreference = useQuery({
    queryKey: ['push-notifications-status', actor?.userId],
    queryFn: () => pushNotificationsRepository.status(actor!.userId),
    enabled: clientMode && Boolean(actor?.userId),
  })
  // Во время live и тренер, и клиент могут корректировать структуру: добавить
  // или заменить упражнение, подход и порядок. Серверные live-RPC используют
  // тот же authorisation путь с разрешённым выполнением для подключённого
  // клиента; экран не должен скрывать доступные действия по роли.
  const canManageLiveStructure = Boolean(query.data)
  useEffect(() => {
    // Этот маршрут доступен только после старта тренировки. Включаем нативный
    // keep-awake сразу при входе, не дожидаясь ответа БД со статусом: иначе
    // медленный запрос оставлял экран без защиты от гашения.
    void setLiveScreenAwake(true)
    return () => { void setLiveScreenAwake(false) }
  }, [])
  useClientRealtime(query.data?.clientId)
  useEffect(() => {
    if (!keyboardOpen) return
    const target = document.activeElement
    if (!(target instanceof HTMLElement) || !target.matches('.live-set-input, .live-set-rpe')) return

    // focusin приходит раньше, чем WKWebView сообщает новую высоту клавиатуры.
    // Повторяем позиционирование после применения уменьшенного viewport, но
    // прокручиваем только внутренний .content — корневое iOS-окно не сдвигаем.
    const frame = window.requestAnimationFrame(() => keepLiveSetFieldVisible(target))
    const timer = window.setTimeout(() => keepLiveSetFieldVisible(target), 180)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [keyboardOpen])
  const catalog = useExerciseCatalog()
  const clientWorkouts = useQuery({ queryKey: ['client-exercises-frequency', query.data?.clientId], queryFn: () => workoutsRepository.list(undefined, undefined, query.data!.clientId), enabled: Boolean(query.data?.clientId) })
  const previousExerciseResults = useQuery({ queryKey: ['latest-exercise-results', query.data?.clientId, query.data?.exercises.map((exercise) => exercise.ref).join('|')], queryFn: () => workoutsRepository.latestExerciseResults(query.data!.clientId, query.data!.exercises.map((exercise) => exercise.ref)), enabled: Boolean(query.data?.clientId && query.data?.exercises.length) })
  const clientRecentExercises = useMemo(() => recentExercisesForClient(catalog.exercises, clientWorkouts.data ?? []), [catalog.exercises, clientWorkouts.data])
  const [liveSets] = useState(() => createLiveSetCoordinator(
    (id, draft, version) => workoutsRepository.saveLiveSet(id, draft, version),
    (id, version) => workoutsRepository.confirmLiveSet(id, version),
  ))
  const [liveSetAutosave] = useState(() => createLiveSetAutosave())
  const [liveWorkout] = useState(() => createLiveWorkoutCoordinator())
  const completedLocally = useRef(false)
  const skipBlurForSet = useRef<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [techniqueExercise, setTechniqueExercise] = useState<ExerciseSnapshot | null>(null)
  // Сворачивание относится к конкретному упражнению и живёт до выхода из Live.
  // ref входит в ключ, поэтому замена упражнения с тем же id раскрывает новое.
  const [collapsedLiveTechniques, setCollapsedLiveTechniques] = useState<Set<string>>(() => new Set())
  // В обычной тренировке перестановка не нужна постоянно: включается из меню
  // и только тогда показывает стрелки у блоков.
  const [reordering, setReordering] = useState(false)
  // Упражнение, которое заменяем через пикер; null — режим добавления.
  const [replaceExerciseId, setReplaceExerciseId] = useState<string | null>(null)
  // Подтверждённые подходы, временно разблокированные для правки (по карандашику).
  const [editingSets, setEditingSets] = useState<Set<string>>(() => new Set())
  // Выбранный подход определяет подсветку и адресные действия меню.
  const [expandedSetId, setExpandedSetId] = useState<string | null>(null)
  // Активное упражнение относится только к текущему выполнению. Оно не меняет
  // position плана: пользователь может временно перейти к любому упражнению и
  // затем вернуться к частично выполненному.
  const [activeExerciseId, setActiveExerciseId] = useState<string | null>(null)
  useEffect(() => {
    if (!query.data) return
    setActiveExerciseId((current) => {
      if (current && query.data.exercises.some((exercise) => exercise.id === current && exercise.sets.some((set) => !set.confirmedAt))) return current
      return query.data.exercises.find((exercise) => exercise.sets.some((set) => !set.confirmedAt))?.id ?? null
    })
  }, [query.data])
  // Realtime может принести устаревший снимок между вводом и ответом RPC.
  // Держим конкретный введённый факт до тех пор, пока серверная копия не станет
  // такой же — иначе при переходе к следующему подходу строка мигнёт пустой.
  const [localSetDrafts, setLocalSetDrafts] = useState<Map<string, LiveSetDraft>>(() => new Map())
  const pendingSetDrafts = useRef<Map<string, LiveSetDraft>>(new Map())
  const [recoveredSetIds, setRecoveredSetIds] = useState<Set<string>>(() => new Set())
  const [recoveredFormIds, setRecoveredFormIds] = useState<Set<string>>(() => new Set())
  const liveSetForms = useRef<Map<string, HTMLFormElement>>(new Map())
  const [savingSetId, setSavingSetId] = useState<string | null>(null)
  const [savedSetId, setSavedSetId] = useState<string | null>(null)
  const [saveErrorSetId, setSaveErrorSetId] = useState<string | null>(null)
  const retryingSetDrafts = useRef(false)
  const initialRetryWorkoutId = useRef<string | null>(null)
  const recoveryInitializedFor = useRef<string | null>(null)
  const nextExerciseAnchor = useRef<string | null>(null)
  useLayoutEffect(() => {
    const target = nextExerciseAnchor.current
    if (!target) return
    const row = liveSetForms.current.get(target)
    const card = row?.closest<HTMLElement>('.live-exercise')
    const content = row?.closest<HTMLElement>('.content')
    const pinned = content?.querySelector<HTMLElement>('.live-pinned')
    if (!card || !content || !pinned) return
    nextExerciseAnchor.current = null
    // Exactly one adjustment after the final set changes the active card.
    // Regular saves, timer ticks and realtime refreshes never move the page.
    content.scrollTop += card.getBoundingClientRect().top - pinned.getBoundingClientRect().bottom - 12
  }, [activeExerciseId, query.data])
  function exerciseMetaFor(exercise: WorkoutExerciseModel) {
    return findCatalogExercise(catalog.exercises, exercise) ?? exercise
  }
  function techniqueActionFor(exercise: WorkoutExerciseModel) {
    const meta = exerciseMetaFor(exercise)
    return hasExerciseTechnique(meta) ? () => setTechniqueExercise(meta) : undefined
  }
  function liveHeaderThumbnail(exercise: WorkoutExerciseModel, active = false) {
    const meta = exerciseMetaFor(exercise)
    if (active && showLiveExerciseAnimation && hasExerciseMedia(meta)) return undefined
    return <ExerciseThumbnail exercise={meta} />
  }
  function liveTechniqueFor(exercise: WorkoutExerciseModel, active: boolean) {
    if (!showLiveExerciseAnimation || !active) return null
    const meta = exerciseMetaFor(exercise)
    if (!meta || !hasExerciseTechnique(meta)) return null
    const key = `${exercise.id}:${exercise.source}:${exercise.ref}`
    return <LiveExerciseTechnique
      exercise={meta}
      collapsed={collapsedLiveTechniques.has(key)}
      onCollapsedChange={(collapsed) => setCollapsedLiveTechniques((current) => {
        const next = new Set(current)
        if (collapsed) next.add(key)
        else next.delete(key)
        return next
      })}
      onOpenTechnique={() => setTechniqueExercise(meta)}
    />
  }
  useEffect(() => {
    if (!actor?.userId || !query.data) return
    const serverSets = new Map(query.data.exercises.flatMap((exercise) => exercise.sets).map((set) => [set.id, set]))
    const pending = readPendingLiveSetDrafts(actor.userId, workoutId)
    for (const [setId, draft] of pending) {
      const serverSet = serverSets.get(setId)
      if (!serverSet || sameLiveSetDraft(serverSet.fact, draft)) {
        removePendingLiveSetDraft(actor.userId, workoutId, setId)
        pending.delete(setId)
      }
    }
    pendingSetDrafts.current = new Map(pending)
    setRecoveredSetIds(new Set(pending.keys()))
    if (recoveryInitializedFor.current !== workoutId) {
      recoveryInitializedFor.current = workoutId
      setRecoveredFormIds(new Set(pending.keys()))
    }
    setLocalSetDrafts((current) => {
      const next = new Map(current)
      for (const [setId, draft] of pending) next.set(setId, draft)
      for (const [setId, draft] of next) {
        const serverSet = serverSets.get(setId)
        if (!serverSet || sameLiveSetDraft(serverSet.fact, draft)) next.delete(setId)
      }
      return next
    })
  }, [actor?.userId, query.data, workoutId])
  useEffect(() => () => liveSetAutosave.dispose(), [liveSetAutosave])
  useEffect(() => {
    if (query.data?.status !== 'done') return
    if (actor?.userId) clearPendingLiveSetDrafts(actor.userId, workoutId)
    // При обычном успешном finish итоговый экран открывает onSuccess ниже с
    // justCompleted. Этот fallback нужен только когда ответ потерялся, но
    // refetch уже увидел завершённую тренировку, либо после reload live URL.
    if (completedLocally.current) return
    showCompletedWorkout(false)
  }, [actor?.userId, query.data?.status, showCompletedWorkout, workoutId])
  function rememberLiveDraft(setId: string, draft: LiveSetDraft, updateVisibleDraft = true) {
    inactivityReminder.noteActivity(restEndsAt)
    pendingSetDrafts.current.set(setId, draft)
    if (updateVisibleDraft) setLocalSetDrafts((current) => new Map(current).set(setId, draft))
    if (actor?.userId) writePendingLiveSetDraft(actor.userId, workoutId, setId, draft)
  }
  function acknowledgeLiveDraft(setId: string, savedDraft?: LiveSetDraft) {
    const pendingDraft = pendingSetDrafts.current.get(setId)
    if (savedDraft && pendingDraft && !sameLiveSetDraft(pendingDraft, savedDraft)) return
    pendingSetDrafts.current.delete(setId)
    if (actor?.userId) removePendingLiveSetDraft(actor.userId, workoutId, setId)
    setRecoveredSetIds((current) => { const next = new Set(current); next.delete(setId); return next })
    setLocalSetDrafts((current) => {
      if (!current.has(setId)) return current
      const next = new Map(current)
      next.delete(setId)
      return next
    })
  }
  // Завершённые упражнения по умолчанию свёрнуты; id здесь — принудительно раскрытые
  // тренером (тап по свёрнутой карточке), чтобы поправить факт.
  const [expandedExercises, setExpandedExercises] = useState<Set<string>>(() => new Set())
  // Общая настройка не меняет RPE-данные; меню упражнения позволяет временно
  // показать или скрыть поле только для конкретного упражнения.
  const [rpeOverrides, setRpeOverrides] = useState<Map<string, boolean>>(() => new Map())
  const [visiblePlans, setVisiblePlans] = useState<Set<string>>(() => new Set())
  function isRpeVisible(exerciseId: string) {
    return rpeOverrides.get(exerciseId) ?? showRpeByDefault
  }
  function toggleRpe(exerciseId: string) {
    setRpeOverrides((current) => new Map(current).set(exerciseId, !isRpeVisible(exerciseId)))
  }
  function togglePlan(exerciseId: string) {
    setVisiblePlans((current) => {
      const next = new Set(current)
      if (next.has(exerciseId)) next.delete(exerciseId)
      else next.add(exerciseId)
      return next
    })
  }
  // Inline-подтверждение частичного завершения. window.confirm в нативной обёртке
  // (Capacitor/WKWebView) не показывается и блокировал выход из тренировки —
  // используем встроенный диалог в панели вместо нативного confirm.
  const [confirmFinish, setConfirmFinish] = useState(false)
  const [restEndsAt, setRestEndsAt] = useState<number | null>(null)
  const [restContextExerciseId, setRestContextExerciseId] = useState<string | null>(null)
  const [restPickerSeconds, setRestPickerSeconds] = useState(90)
  const inactivityReminder = useWorkoutInactivityReminder({
    userId: actor?.userId,
    workoutId,
    status: !query.data ? 'loading' : query.data.status === 'in_progress' ? 'active' : 'inactive',
    enabled: clientMode ? reminderPreference.data?.workoutReminderEnabled ?? null : false,
    activeUntil: restEndsAt,
    onFinishIntent: () => setConfirmFinish(true),
  })
  const restOverrideKey = `fit:live-rest-settings:${actor?.userId ?? ''}:${workoutId}`
  const [restOverrides, setRestOverrides] = useState<Record<string, number>>({})
  useEffect(() => { setRestOverrides(readLiveRestOverrides(restOverrideKey)) }, [restOverrideKey])
  function setExerciseRest(exerciseId: string, seconds: number) {
    setRestOverrides((current) => {
      const next = { ...current, [exerciseId]: seconds }
      try { sessionStorage.setItem(restOverrideKey, JSON.stringify(next)) } catch { /* The current session still works when storage is unavailable. */ }
      return next
    })
  }
  useEffect(() => {
    const deadline = restoreRestDeadline(workoutId)
    setRestEndsAt(deadline)
    setRestContextExerciseId(null)
    setRestPickerSeconds(90)
  }, [workoutId])
  // При правке ПОДТВЕРЖДЁННОГО подхода (карандаш → «Сохранить») значение пишется
  // в БД, но без refetch локальный set остаётся старым и поле возвращает прежнее
  // число. Освежаем только для подтверждённых (в обычном вводе по blur refetch не
  // нужен и мешал бы: ремоунт полей по key сбросил бы текущий ввод).
  async function runLiveSetMutation(set: WorkoutSet, draft: LiveSetDraft, requireConfirmed: boolean, operation: () => Promise<number>) {
    try {
      return await operation()
    } catch (error) {
      const refreshed = await liveOperationWithTimeout(query.refetch())
        .catch(() => { throw liveWorkoutRecoveryError(error, false) })
      const serverSet = refreshed.data?.exercises.flatMap((exercise) => exercise.sets).find((item) => item.id === set.id)
      if (serverSet) {
        const applied = sameLiveSetDraft(serverSet.fact, draft) && (!requireConfirmed || Boolean(serverSet.confirmedAt))
        liveSets.sync(serverSet, applied ? draft : undefined)
        if (applied) {
          trackGoal(requireConfirmed ? 'live_set_confirm_recovered' : 'live_set_save_recovered')
          return serverSet.version
        }
      }
      throw liveWorkoutRecoveryError(error, !refreshed.error)
    }
  }
  const save = useMutation({
    mutationFn: ({ set, draft }: { set: WorkoutSet; draft: LiveSetDraft }) => runLiveSetMutation(set, draft, false, () => liveSets.save(set, draft)),
    onMutate: ({ set }) => { setSavingSetId(set.id); setSavedSetId(null); setSaveErrorSetId(null) },
    onSuccess: async (version, { set, draft }) => {
      setSavingSetId(null)
      setSavedSetId(set.id)
      // Сразу закрепляем факт и новую версию в кэше для любого подхода. Раньше
      // правка уже подтверждённого подхода ждала refetch и на iOS могла
      // отрисоваться старым значением до второй попытки сохранения.
      queryClient.setQueryData<Workout>(
        ['workout', workoutId],
        (workout) => workout ? applyLiveSetDraft(workout, set.id, draft, version) : workout,
      )
      acknowledgeLiveDraft(set.id, draft)
      if (set.confirmedAt) {
        const exercise = query.data?.exercises.find((item) => item.sets.some((itemSet) => itemSet.id === set.id))
        if (exercise && !editingSets.has(set.id)) setExpandedExercises((previous) => {
          if (!previous.has(exercise.id)) return previous
          const next = new Set(previous)
          next.delete(exercise.id)
          return next
        })
        await query.refetch()
      }
    },
    onError: (_error, { set }) => {
      setSavingSetId(null)
      setSaveErrorSetId(set.id)
      trackGoal('live_set_save_error')
    },
  })
  function persistLiveDraft(set: WorkoutSet, draft: LiveSetDraft, immediate = false) {
    // Запоминаем ввод до RPC и на устройстве. Это не меняет факт на сервере,
    // но не даёт realtime-снимку или reload скрыть его при медленной сети.
    rememberLiveDraft(set.id, draft)
    const send = () => save.mutate({ set, draft })
    if (immediate) liveSetAutosave.flush(set.id, send)
    else liveSetAutosave.schedule(set.id, send)
  }
  function captureLiveDraft(set: WorkoutSet, form: HTMLFormElement) {
    const draft = draftFrom(form)
    // localStorage пишется синхронно на каждом вводе. React-state обновится при
    // debounce/blur, чтобы набор текста не перерисовывал всю тренировку.
    rememberLiveDraft(set.id, draft, false)
    liveSetAutosave.schedule(set.id, () => {
      rememberLiveDraft(set.id, draft)
      save.mutate({ set, draft })
    })
  }
  function liveFormChanged(form: HTMLFormElement) {
    return Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select'))
      .some((field) => field.value !== (field instanceof HTMLInputElement
        ? field.defaultValue
        : field.options[field.selectedIndex]?.defaultSelected ? field.value : ''))
  }
  function openLiveSet(targetSetId: string) {
    setExpandedSetId(targetSetId)
  }
  useEffect(() => {
    if (!savedSetId) return
    const timer = window.setTimeout(() => setSavedSetId(null), 2_500)
    return () => window.clearTimeout(timer)
  }, [savedSetId])
  const confirm = useMutation({
    mutationFn: ({ set, draft }: { set: WorkoutSet; draft: LiveSetDraft }) => runLiveSetMutation(set, draft, true, () => liveSets.confirm(set, draft)),
    onMutate: ({ set, draft }) => { rememberLiveDraft(set.id, draft) },
    onSuccess: (version, { set, draft }) => {
      const before = queryClient.getQueryData<Workout>(['workout', workoutId])
      const owner = before?.exercises.find((exercise) => exercise.sets.some((item) => item.id === set.id))
      if (owner && owner.blockType === 'single' && owner.sets.every((item) => item.id === set.id || item.confirmedAt)) {
        const next = before?.exercises.find((exercise) => exercise.id !== owner.id && exercise.sets.some((item) => !item.confirmedAt))
        nextExerciseAnchor.current = next?.sets.find((item) => !item.confirmedAt)?.id ?? null
        setActiveExerciseId(next?.id ?? null)
      }
      queryClient.setQueryData<Workout>(['workout', workoutId], (workout) => workout
        ? applyLiveSetConfirmation(workout, set.id, draft, version, new Date().toISOString()) : workout)
      acknowledgeLiveDraft(set.id, draft)
      setExpandedSetId(null)
      // Отдых берётся из настроек блока (Этап A), не хардкод:
      // - одиночное упражнение → отдых между подходами;
      // - группа: между упражнениями внутри круга → restBetweenExercisesSec;
      //   после последнего упражнения круга → restBetweenRoundsSec.
      const workout = query.data
      const exercise = workout?.exercises.find((item) => item.sets.some((s) => s.id === set.id))
      if (workout && exercise) {
        const sec = exercise.blockType === 'single'
          ? restOverrides[exercise.id] ?? restSecondsAfterSet(workout, exercise, set)
          : restSecondsAfterSet(workout, exercise, set)
        setRestContextExerciseId(exercise.blockType === 'single' ? exercise.id : null)
        if (sec > 0) setRestPickerSeconds(sec)
        startRestUntil(restDeadline(sec))
      }
      void query.refetch()
      void queryClient.invalidateQueries({ queryKey: ['clients'] })
    },
    onError: () => trackGoal('live_set_confirm_error'),
  })
  async function retryPendingLiveDrafts() {
    if (!actor?.userId || !query.data || retryingSetDrafts.current
      || save.isPending || confirm.isPending || (typeof navigator !== 'undefined' && !navigator.onLine)) return
    const pending = readPendingLiveSetDrafts(actor.userId, workoutId)
    if (!pending.size) return
    retryingSetDrafts.current = true
    trackGoal('live_set_retry_started')
    try {
      const serverSets = new Map(query.data.exercises.flatMap((exercise) => exercise.sets).map((set) => [set.id, set]))
      for (const [setId, draft] of pending) {
        const set = serverSets.get(setId)
        if (!set) { acknowledgeLiveDraft(setId); continue }
        if (sameLiveSetDraft(set.fact, draft)) { acknowledgeLiveDraft(setId, draft); continue }
        try {
          await save.mutateAsync({ set, draft })
        } catch {
          break
        }
      }
      if (pendingSetDrafts.current.size === 0) {
        confirm.reset()
        trackGoal('live_set_retry_completed')
      }
    } finally {
      retryingSetDrafts.current = false
    }
  }
  useEffect(() => {
    const retry = () => {
      if (document.visibilityState === 'visible') void retryPendingLiveDrafts()
    }
    window.addEventListener('online', retry)
    window.addEventListener('pageshow', retry)
    document.addEventListener('visibilitychange', retry)
    const initialRetry = initialRetryWorkoutId.current === workoutId ? undefined : window.setTimeout(retry, 0)
    initialRetryWorkoutId.current = workoutId
    return () => {
      if (initialRetry !== undefined) window.clearTimeout(initialRetry)
      window.removeEventListener('online', retry)
      window.removeEventListener('pageshow', retry)
      document.removeEventListener('visibilitychange', retry)
    }
  }, [actor?.userId, query.data, workoutId, save.isPending, confirm.isPending])
  // Запускает отдых до абсолютного момента endsAt (мс). null — отдыха нет
  // (напр. между упражнениями суперсета, seconds=0): таймер не показываем.
  function startRestUntil(endsAt: number | null) {
    setRestEndsAt(endsAt)
    storeRestDeadline(workoutId, endsAt)
    inactivityReminder.noteActivity(endsAt)
    if (endsAt !== null && endsAt > Date.now()) void scheduleNativeRestTimerNotification(workoutId, endsAt)
    else void cancelNativeRestTimerNotification(workoutId)
  }
  function stopRest() {
    startRestUntil(null)
  }
  function activateLiveExercise(exercise: WorkoutExerciseModel) {
    const nextSet = exercise.sets.find((set) => !set.confirmedAt)
    if (!nextSet) return
    inactivityReminder.noteActivity(restEndsAt)
    nextExerciseAnchor.current = nextSet.id
    setExpandedSetId(nextSet.id)
    setActiveExerciseId(exercise.id)
    trackGoal('live_exercise_selected')
  }
  function runLiveWorkoutMutation(operationKey: string, operation: (workout: Workout) => Promise<number>) {
    inactivityReminder.noteActivity(restEndsAt)
    const snapshot = query.data!
    return liveWorkout.run(snapshot, operationKey, async (expectedVersion) => {
      try {
        return await operation({ ...snapshot, version: expectedVersion })
      } catch (error) {
        const refreshed = await liveOperationWithTimeout(query.refetch())
          .catch(() => { throw liveWorkoutRecoveryError(error, false) })
        if (refreshed.data) liveWorkout.sync(refreshed.data)
        throw liveWorkoutRecoveryError(error, !refreshed.error)
      }
    })
  }
  const appendSet = useMutation({ mutationFn: (exerciseId: string) => runLiveWorkoutMutation(`append-set:${exerciseId}`, (workout) => workoutsRepository.appendLiveSet(workout, exerciseId)), onSuccess: async () => { await query.refetch() } })
  const removeSet = useMutation({ mutationFn: (setId: string) => runLiveWorkoutMutation(`remove-set:${setId}`, (workout) => workoutsRepository.removeLiveSet(workout, setId)), onSuccess: async () => { await query.refetch() } })
  const removeExercise = useMutation({
    mutationFn: async (exercise: WorkoutExerciseModel) => {
      // Let blur saves finish before deleting their parent, including on iOS.
      await liveSets.waitForIdle()
      return runLiveWorkoutMutation(`remove-exercise:${exercise.id}`, (workout) => workoutsRepository.removeLiveExercise(workout, exercise.id))
    },
    onSuccess: async (_version, exercise) => {
      for (const set of exercise.sets) acknowledgeLiveDraft(set.id)
      setExpandedSetId(null)
      stopRest()
      await query.refetch()
      void invalidateWorkoutResults(queryClient)
      void queryClient.invalidateQueries({ queryKey: ['clients'] })
    },
  })
  const appendExercise = useMutation({ mutationFn: (exercise: ExerciseSnapshot) => runLiveWorkoutMutation(`append-exercise:${exercise.ref}`, (workout) => workoutsRepository.appendLiveExercise(workout, exercise)), onSuccess: async () => { await query.refetch() } })
  const reorderBlock = useMutation({
    mutationFn: ({ blockId, direction }: { blockId: string; direction: -1 | 1 }) => runLiveWorkoutMutation(`reorder:${blockId}:${direction}`, (workout) => workoutsRepository.reorderLiveBlock(workout, blockId, direction)),
    onSuccess: async () => {
      const refreshed = await query.refetch()
      const nextExercise = refreshed.data?.exercises.find((exercise) => exercise.sets.some((set) => !set.confirmedAt))
      const nextSet = nextExercise?.sets.find((set) => !set.confirmedAt)
      nextExerciseAnchor.current = nextSet?.id ?? null
      setExpandedSetId(nextSet?.id ?? null)
      setActiveExerciseId(nextExercise?.id ?? null)
    },
  })
  const replaceLive = useMutation({
    mutationFn: async ({ exerciseId, exercise, discardedSetIds }: { exerciseId: string; exercise: ExerciseSnapshot; discardedSetIds: string[] }) => {
      // A blur-save may already be in flight when the picker opens. Let it
      // settle before the structural mutation and cancel only queued drafts;
      // the server then deliberately clears unfinished facts on replacement.
      for (const setId of discardedSetIds) liveSetAutosave.clear(setId)
      await liveSets.waitForIdle()
      return runLiveWorkoutMutation(`replace:${exerciseId}`, (workout) => workoutsRepository.replaceLiveExercise(workout, exerciseId, exercise))
    },
    onSuccess: async (_version, { discardedSetIds }) => {
      for (const setId of discardedSetIds) acknowledgeLiveDraft(setId)
      setExpandedSetId(null)
      stopRest()
      await query.refetch()
      void invalidateWorkoutResults(queryClient)
      void queryClient.invalidateQueries({ queryKey: ['clients'] })
    },
  })
  const commentLive = useMutation({ mutationFn: ({ exerciseId, comment }: { exerciseId: string; comment: string }) => runLiveWorkoutMutation(`comment:${exerciseId}`, (workout) => workoutsRepository.setExerciseComment(workout, exerciseId, comment)), onSuccess: async () => { await query.refetch() } })
  function closePicker() { setPickerOpen(false); setReplaceExerciseId(null) }
  async function pickLiveExercise(exercise: ExerciseSnapshot) {
    const targetId = replaceExerciseId
    if (!targetId) {
      appendExercise.mutate(exercise)
      closePicker()
      return
    }
    const target = query.data?.exercises.find((item) => item.id === targetId)
    closePicker()
    if (!target) return
    const completedCount = target.sets.filter((set) => set.confirmedAt).length
    const unfinishedSets = target.sets.filter((set) => !set.confirmedAt)
    if (completedCount > 0) {
      const remainingText = unfinishedSets.length > 0
        ? `Оставшиеся подходы (${unfinishedSets.length}) продолжатся уже в «${exercise.name}». Их введённые фактические значения будут очищены.`
        : `Для «${exercise.name}» будет создан новый пустой подход.`
      const countTail = completedCount % 100
      const countDigit = completedCount % 10
      const completedText = countTail >= 11 && countTail <= 14
        ? `${completedCount} выполненных подходов останутся`
        : countDigit === 1
          ? `${completedCount} выполненный подход останется`
          : countDigit >= 2 && countDigit <= 4
            ? `${completedCount} выполненных подхода останутся`
            : `${completedCount} выполненных подходов останутся`
      const confirmed = await askConfirm({
        message: `${completedText} в истории как «${target.name}». ${remainingText}`,
        confirmLabel: 'Заменить',
      })
      if (!confirmed) return
    }
    replaceLive.mutate({ exerciseId: targetId, exercise, discardedSetIds: unfinishedSets.map((set) => set.id) })
  }
  async function flushOpenLiveSetDrafts() {
    const sets = new Map((query.data?.exercises ?? []).flatMap((exercise) => exercise.sets).map((set) => [set.id, set]))
    // Snapshot before awaiting: callback refs can reinsert forms during render,
    // which would make a live Map iterator visit the same rows indefinitely.
    for (const [setId, form] of [...liveSetForms.current]) {
      const set = sets.get(setId)
      // Disabled controls are absent from FormData. Never turn a locked fact
      // into an empty draft while finishing a partially completed exercise.
      if (set?.confirmedAt && !editingSets.has(setId)) continue
      if (!set || (!liveFormChanged(form) && !pendingSetDrafts.current.has(setId))) continue
      const draft = draftFrom(form)
      liveSetAutosave.clear(setId)
      rememberLiveDraft(setId, draft)
      await save.mutateAsync({ set, draft })
    }
  }
  const finish = useMutation({ mutationFn: async () => {
    await flushOpenLiveSetDrafts()
    await liveSets.waitForIdle()
    const version = await runLiveWorkoutMutation('finish', (workout) => workoutsRepository.finish(workout))
    completedLocally.current = true
    return version
  }, onSuccess: async () => {
    const clientId = query.data?.clientId
    if (actor?.userId) clearPendingLiveSetDrafts(actor.userId, workoutId)
    stopRest()
    if (actor?.userId) clearWorkoutInactivityReminder(actor.userId, workoutId)
    // Освежаем не только саму тренировку, но и статистику клиента и списки
    // тренировок (карточка, история, расписание), иначе кол-во/% выполнения
    // на карточке клиента обновляются только после перезагрузки.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['workout', workoutId] }),
      invalidateWorkoutResults(queryClient),
      queryClient.invalidateQueries({ queryKey: ['clients'] }),
      clientId ? queryClient.invalidateQueries({ queryKey: ['client-stats', clientId] }) : Promise.resolve(),
    ])
    showCompletedWorkout(true)
  } })
  const hasIncompleteLiveSets = query.data?.exercises.some((exercise) => !exercise.sets.every((set) => set.confirmedAt)) ?? false
  function finishFromInactivityReminder() {
    inactivityReminder.dismiss()
    setConfirmFinish(true)
  }
  const rootMutationPending = appendSet.isPending || removeSet.isPending || removeExercise.isPending || appendExercise.isPending
    || reorderBlock.isPending || replaceLive.isPending || commentLive.isPending || finish.isPending
  function draftFrom(form: HTMLFormElement): LiveSetDraft {
    const values = new FormData(form)
    const runDuration = values.get('runDuration')
    const runDistance = values.get('runDistance')
    const runUnit: RunDistanceUnit = values.get('runDistanceUnit') === 'm' ? 'm' : 'km'
    return {
      weightKg: numberValue(values.get('weightKg')),
      reps: numberValue(values.get('reps')),
      distanceKm: runDistance === null ? numberValue(values.get('distanceKm')) : runDistanceKmFromInput(String(runDistance), runUnit),
      durationSec: runDuration === null ? numberValue(values.get('durationSec')) : parseRunDurationInput(String(runDuration)),
      rpe: numberValue(values.get('rpe')),
    }
  }
  const liveSyncError = save.error ?? confirm.error
  const error = appendSet.error ?? removeSet.error ?? removeExercise.error ?? appendExercise.error ?? reorderBlock.error ?? replaceLive.error ?? commentLive.error ?? finish.error
  // Комментарий тренера к упражнению в live — сохраняется по blur, если изменился.
  function liveCommentField(exercise: WorkoutExerciseModel) {
    const note = (clientMode ? exercise.clientNote : exercise.trainerComment) ?? ''
    return <details className="live-exercise-note">
      <summary>{clientMode ? 'Заметка' : 'Заметка тренера'}{note ? <span className="live-note-preview">{note}</span> : null}</summary>
      <textarea className="exercise-comment" aria-label={`Заметка: ${exercise.name}`} placeholder="Заметка к упражнению…" maxLength={5000} rows={2} defaultValue={note} disabled={rootMutationPending}
        onBlur={(event) => { const next = event.target.value.trim(); if (next !== note) commentLive.mutate({ exerciseId: exercise.id, comment: next }) }} />
    </details>
  }
  // Меню упражнения в live (⋯). Если упражнение уже начато, сервер отделит
  // подтверждённый факт в самостоятельную запись, а заменит лишь остаток.
  function exerciseMenu(exercise: WorkoutExerciseModel, canReorder = false, removableSet?: WorkoutSet) {
    if (!canManageLiveStructure) return null
    const showRpe = isRpeVisible(exercise.id)
    const showPlan = visiblePlans.has(exercise.id)
    return <OverflowMenu items={[
      ...(canReorder && !reordering ? [{ label: 'Изменить порядок', onClick: () => setReordering(true) }] : []),
      { label: showPlan ? 'Скрыть план' : 'Показать план', onClick: () => togglePlan(exercise.id) },
      { label: showRpe ? 'Скрыть RPE' : 'Указать RPE', onClick: () => toggleRpe(exercise.id) },
      { label: 'Заменить', disabled: rootMutationPending || save.isPending || confirm.isPending, onClick: () => { setReplaceExerciseId(exercise.id); setPickerOpen(true) } },
      ...(removableSet ? [{ label: 'Удалить подход', danger: true, disabled: rootMutationPending, onClick: async () => { if (await askConfirm({ message: 'Удалить этот подход?', confirmLabel: 'Удалить', danger: true })) removeSet.mutate(removableSet.id) } }] : []),
      { label: 'Удалить упражнение', danger: true, disabled: rootMutationPending || save.isPending || confirm.isPending, onClick: async () => {
        if (await askConfirm({ message: `Удалить «${exercise.name}» из этой тренировки? Все его подходы, включая выполненные, будут удалены.`, confirmLabel: 'Удалить', danger: true })) removeExercise.mutate(exercise)
      } },
    ]} />
  }
  // Стрелки ↑/↓ видны только во временном режиме перестановки.
  function liveReorder(blockId: string, isFirst: boolean, isLast: boolean) {
    if (!canManageLiveStructure || !reordering) return null
    return <span className="block-reorder">
      <button type="button" className="reorder-btn" aria-label="Вверх" disabled={isFirst || rootMutationPending} onClick={() => reorderBlock.mutate({ blockId, direction: -1 })}><ArrowUpIcon /></button>
      <button type="button" className="reorder-btn" aria-label="Вниз" disabled={isLast || rootMutationPending} onClick={() => reorderBlock.mutate({ blockId, direction: 1 })}><ArrowDownIcon /></button>
    </span>
  }
  // Форма одного подхода в live: подтверждение / правка / удаление / автосейв по blur.
  function renderLiveSet(exercise: WorkoutExerciseModel, set: WorkoutSet, label?: string, current = false) {
    const localDraft = localSetDrafts.get(set.id)
    const displayedSet = setWithCarriedLiveWeight(exercise, set, localDraft)
    const isEditing = editingSets.has(set.id)
    // «Закрыто» (подтверждён) — зелёный; «в работе» (текущий) — серый.
    const stateClass = set.confirmedAt && !isEditing ? 'confirmed' : current && !isEditing ? 'current' : ''
    const saveStatus = savingSetId === set.id ? 'saving' : saveErrorSetId === set.id ? 'error' : savedSetId === set.id ? 'saved' : 'idle'
    const setNumber = label?.match(/\d+/)?.[0]
    const restSeconds = query.data ? restSecondsAfterSet(query.data, exercise, set) : 0
    const confirmLabel = set.confirmedAt
      ? 'Подтверждено'
      : exercise.blockPreset === 'interval' && restSeconds === 0
        ? 'Готово'
        : 'Готово, отдых'
    const showRpe = isRpeVisible(exercise.id)
    const showPlan = visiblePlans.has(exercise.id)
    // Локальный draft меняется на каждом autosave. Он не должен быть частью
    // key активной формы: remount закрывал клавиатуру и менял scrollTop.
    // Однократный recovery-key нужен только после reload, чтобы применить
    // восстановленные defaultValue.
    const recoveryKey = recoveredFormIds.has(set.id) ? 'recovered' : 'stable'
    return <form data-live-set-id={set.id} ref={(node) => { if (node) liveSetForms.current.set(set.id, node); else liveSetForms.current.delete(set.id) }} className={`exercise live-set live-set-expanded ${stateClass} ${isEditing ? 'editing' : ''} ${showRpe ? 'rpe-visible' : ''}`} key={`${set.id}:${recoveryKey}`} onFocusCapture={(event) => {
      if (!set.confirmedAt) openLiveSet(set.id)
      const target = event.target
      if (target instanceof HTMLElement && target.matches('.live-set-input, .live-set-rpe')) keepLiveSetFieldVisible(target)
    }} onInput={(event) => captureLiveDraft(set, event.currentTarget)} onSubmit={(event) => event.preventDefault()} onBlur={(event) => {
      if (set.confirmedAt && !isEditing) return
      if (skipBlurForSet.current === set.id) { skipBlurForSet.current = null; return }
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
      persistLiveDraft(set, draftFrom(event.currentTarget), true)
    }}>
      <WorkoutSetRow state={set.confirmedAt && !isEditing ? 'completed' : 'current'} className="live-set-grid">
        <span className="workout-set-number live-set-number" aria-label={label}>{setNumber ?? '•'}</span>
        <LiveSetFields inputKind={exercise.inputKind} exerciseRef={exercise.ref} set={displayedSet} editing={isEditing} showRpe={showRpe} carriedWeightKey={carriedLiveWeightKey(exercise, set)} />
        <div className="live-set-confirm">
          {set.confirmedAt && isEditing
            ? <button type="button" className="secondary live-set-save" aria-label="Сохранить" disabled={save.isPending}
                onPointerDown={() => { skipBlurForSet.current = set.id; liveSetAutosave.clear(set.id) }}
                onClick={(event) => { const form = event.currentTarget.form; if (form) persistLiveDraft(set, draftFrom(form), true); setEditingSets((prev) => { const next = new Set(prev); next.delete(set.id); return next }); skipBlurForSet.current = null }}><span aria-hidden="true">✓</span></button>
            : set.confirmedAt ? <button type="button" className="secondary live-set-check done" aria-label="Редактировать подход" onClick={() => setEditingSets((prev) => new Set(prev).add(set.id))}><span aria-hidden="true">✓</span></button>
            : <button type="button" className="live-set-check" aria-label={confirmLabel} disabled={confirm.isPending}
                onPointerDown={() => { prepareGong(); skipBlurForSet.current = set.id; liveSetAutosave.clear(set.id) }}
                onClick={(event) => { prepareGong(); liveSetAutosave.clear(set.id); const form = event.currentTarget.form; if (form) confirm.mutate({ set, draft: draftFrom(form) }); skipBlurForSet.current = null }}><span aria-hidden="true">✓</span></button>}
        </div>
      </WorkoutSetRow>
      <div className="live-set-save-feedback"><SaveStatus status={saveStatus} error={saveStatus === 'error' ? save.error?.message : undefined} /></div>
      {showPlan && <small className="live-set-plan-caption">{planLine(exercise.inputKind, set, exercise.ref) ? `План · ${planLine(exercise.inputKind, set, exercise.ref)}` : 'Без плановых значений'}</small>}
    </form>
  }
  const activeLiveExercise = query.data?.exercises.find((exercise) => exercise.id === activeExerciseId && exercise.sets.some((set) => !set.confirmedAt))
    ?? query.data?.exercises.find((exercise) => exercise.sets.some((set) => !set.confirmedAt))
  const sessionProgress = liveSessionProgress(query.data?.exercises ?? [], activeLiveExercise?.id)
  const currentLiveBlock = groupIntoBlocks(query.data?.exercises ?? [])
    .find((block) => block.exercises.some((exercise) => exercise.id === activeLiveExercise?.id))
  const currentSingleExercise = currentLiveBlock && (currentLiveBlock.blockType === 'single' || currentLiveBlock.exercises.length === 1)
    ? currentLiveBlock.exercises.find((exercise) => exercise.sets.some((set) => !set.confirmedAt))
    : undefined
  const contextualSingleExercise = restEndsAt !== null && restContextExerciseId
    ? query.data?.exercises.find((exercise) => exercise.id === restContextExerciseId && exercise.blockType === 'single')
    : currentSingleExercise
  const effectiveRestPickerSeconds = contextualSingleExercise
    ? restOverrides[contextualSingleExercise.id] ?? contextualSingleExercise.restBetweenSetsSec ?? restPickerSeconds
    : restPickerSeconds
  function applyRestDuration(seconds: number) {
    setRestPickerSeconds(seconds)
    if (contextualSingleExercise) setExerciseRest(contextualSingleExercise.id, seconds)
  }
  // Back returns to the entry screen without finishing. A direct Live link
  // falls back to its workout detail because the tab bar is hidden here.
  return <Page title="Live-тренировка" hideTitle className="live-workout-page workout-focused-page" back={`/workouts/${workoutId}`} onBack={goBack}>
    <AsyncView loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>{query.data && <>
      <WorkoutHeader eyebrow="LIVE" title={query.data.clientName} state="current" className="live-session-header" meta={<div className="live-session-progress">
        <span className="live-session-progress-copy"><span>{sessionProgress.complete ? 'Все упражнения выполнены' : activeLiveExercise ? `Сейчас: ${activeLiveExercise.name} · подход ${sessionProgress.activeSetNumber} из ${sessionProgress.activeExerciseSetCount}` : 'Выберите упражнение'}</span><strong>Готово {sessionProgress.completedSetCount} из {sessionProgress.setCount}</strong></span>
        <span className="live-session-progress-track" role="progressbar" aria-label="Выполненные подходы" aria-valuemin={0} aria-valuemax={sessionProgress.setCount} aria-valuenow={sessionProgress.completedSetCount}><span style={{ width: `${sessionProgress.percent}%` }} /></span>
      </div>} />
      {inactivityReminder.visible && <section className="live-inactivity-reminder" role="alert" aria-labelledby="live-inactivity-reminder-title">
        <div><strong id="live-inactivity-reminder-title">Тренировка ещё идёт</strong><span>Продолжить или завершить её?</span></div>
        <div className="actions">
          <button type="button" className="secondary" onClick={inactivityReminder.dismiss}>Продолжить</button>
          <button type="button" onClick={finishFromInactivityReminder}>Завершить</button>
        </div>
      </section>}
      {(() => {
        // Активная круговая (многоэлементный блок с незавершёнными подходами) —
        // её счётчик «Круг N из M» + точки закрепляем вместе с таймером, чтобы при
        // скролле по кругам всегда было видно, на каком круге сейчас.
        const liveBlocks = groupIntoBlocks(query.data.exercises)
        const activeCircuit = liveBlocks.find((block) => block.exercises.length > 1
          && block.exercises.some((exercise) => exercise.id === activeLiveExercise?.id))
        const circuitRounds = activeCircuit ? blockRoundsView(activeCircuit) : null
        const activeCircuitSetId = activeLiveExercise?.sets.find((set) => !set.confirmedAt)?.id
        const selectedCircuitRound = circuitRounds && activeCircuitSetId
          ? circuitRounds.findIndex((round) => round.items.some(({ set }) => set.id === activeCircuitSetId))
          : -1
        const circuitCurrent = circuitRounds ? selectedCircuitRound >= 0 ? selectedCircuitRound : currentRoundIndex(circuitRounds) : 0
        return (
        /* Закреплённый блок: таймер + отдых + прогресс активной круговой. */
        <div className="live-pinned">
          <div className="live-timer-toolbar"><WorkoutTimer startedAt={query.data.startedAt ?? null} />
            <Coachmark id="live-timer-2026-09" userId={actor?.userId} title="Отдых — в кнопке таймера" description="Нажмите, чтобы запустить отдых, добавить время или остановить его. Подходы можно заполнять прямо в таблице.">
              <LiveRestTimer workoutId={workoutId} deadline={restEndsAt} defaultDurationSeconds={effectiveRestPickerSeconds} onChange={startRestUntil} onDurationChange={applyRestDuration} />
            </Coachmark>
          </div>
          {activeCircuit && circuitRounds && <div className="circuit-head pinned">
            <span className="block-badge">{blockLabel(activeCircuit.blockType, activeCircuit.blockPreset)}</span>
            <span className="circuit-counter">Круг {circuitRounds[circuitCurrent]?.round ?? 1} из {circuitRounds.length}</span>
            <span className="circuit-dots" aria-hidden="true">{circuitRounds.map((r, i) => <span key={r.round} className={`circuit-dot ${r.items.every(({ set }) => set.confirmedAt) ? 'done' : i === circuitCurrent ? 'current' : ''}`} />)}</span>
          </div>}
        </div>)
      })()}
      {reordering && <div className="live-reorder-mode" role="status"><span>Изменение порядка</span><button type="button" className="secondary" onClick={() => setReordering(false)}>Готово</button></div>}
      {(() => { const liveBlocks = groupIntoBlocks(query.data.exercises);
        return liveBlocks.map((block, blockIndex) => {
        // ↑/↓ показываем только когда блоков больше одного; двигать можно любые
        // блоки (в т.ч. с завершёнными подходами), кроме упора в границу.
        const canReorder = liveBlocks.length > 1
        const reorder = canReorder ? liveReorder(block.blockId, blockIndex === 0, blockIndex === liveBlocks.length - 1) : null
        const blockDone = block.exercises.every((exercise) => exercise.sets.every((set) => set.confirmedAt))
        const blockStatus = blockDone ? 'done' : block.exercises.some((exercise) => exercise.id === activeLiveExercise?.id) ? 'current' : 'upcoming'
        // Одиночное упражнение (или блок из одного) — как раньше, по подходам.
        // Текущий подход (первый неподтверждённый) подсвечивается серым.
        if (block.blockType === 'single' || block.exercises.length === 1) {
          return block.exercises.map((exercise) => {
            const currentSetIndex = exercise.sets.findIndex((set) => !set.confirmedAt)
            // Все строки доступны для ввода; текущая определяет подсветку и
            // действия меню. При смене строки её черновик сохранён локально.
            const activeSetId = expandedSetId ?? exercise.sets[currentSetIndex]?.id
            const allDone = exercise.sets.every((set) => set.confirmedAt)
            // В live рабочей остаётся только текущая карточка. Завершённые
            // упражнения сжимаются в итог (тап открывает их исключительно для
            // исправления факта), а будущие не показывают таблицу и RPE раньше
            // времени. Это presentation-only: порядок, факт и RPC не меняются.
            const collapsed = allDone && !expandedExercises.has(exercise.id)
            if (collapsed) {
              const doneCount = exercise.sets.length
              const best = exercise.sets.map((set) => factLine(set, true, exercise.ref)).filter(Boolean).slice(-1)[0] ?? null
              return <WorkoutExerciseCompact key={exercise.id} state="completed" className="live-exercise-collapsed" title={exercise.name}
                leading={liveHeaderThumbnail(exercise)}
                meta={`${doneCount} ${doneCount === 1 ? 'подход' : doneCount < 5 ? 'подхода' : 'подходов'}${best ? ` · ${best}` : ''}`}
                onClick={() => setExpandedExercises((prev) => new Set(prev).add(exercise.id))} />
            }
            if (blockStatus === 'upcoming') {
              const firstPlan = exercise.sets.map((set) => planLine(exercise.inputKind, set, exercise.ref)).find(Boolean)
              const completedSets = exercise.sets.filter((set) => set.confirmedAt).length
              const countLabel = exercise.sets.length === 1 ? 'подход' : exercise.sets.length < 5 ? 'подхода' : 'подходов'
              const progressLabel = completedSets > 0 ? `Выполнено ${completedSets} из ${exercise.sets.length}` : `${exercise.sets.length} ${countLabel}`
              return <WorkoutExercise key={exercise.id} state="upcoming" className={`live-exercise-upcoming ${completedSets > 0 ? 'started' : ''}`}>
                <WorkoutExerciseHeader className="live-exercise-head" name={exercise.name} leading={liveHeaderThumbnail(exercise)} onTitleClick={techniqueActionFor(exercise)} showTechniqueLabel={false} actions={<>{exerciseMenu(exercise, canReorder, currentSetIndex >= 0 && exercise.sets.length > 1 ? exercise.sets[currentSetIndex] : undefined)}{reorder}</>} />
                <div className="live-upcoming-row"><p className="live-upcoming-summary"><span>{progressLabel}</span>{firstPlan && <span>План: {firstPlan}</span>}</p>
                  <button type="button" className="secondary live-exercise-start" disabled={rootMutationPending} aria-label={`${completedSets > 0 ? 'Продолжить' : 'Начать'} упражнение «${exercise.name}»`} onClick={() => activateLiveExercise(exercise)}>{completedSets > 0 ? 'Продолжить' : 'Начать'}</button>
                </div>
              </WorkoutExercise>
            }
            return <WorkoutExercise key={exercise.id} state={blockStatus === 'done' ? 'completed' : blockStatus} className={`live-exercise ${blockStatus}`}>
              <WorkoutExerciseHeader className="live-exercise-head" name={exercise.name} leading={liveHeaderThumbnail(exercise, blockStatus === 'current')} onTitleClick={techniqueActionFor(exercise)} showTechniqueLabel={false} actions={<>{exerciseMenu(exercise, canReorder, currentSetIndex >= 0 && exercise.sets.length > 1 ? exercise.sets[currentSetIndex] : undefined)}{reorder}</>} />
              {liveTechniqueFor(exercise, blockStatus === 'current')}
              {clientMode && exercise.trainerComment && <p className="live-trainer-cue">Тренер: {exercise.trainerComment}</p>}
              {(() => { const result = previousExerciseResults.data?.get(exercise.ref); const line = result && previousResultLine(result.sets, exercise.ref); return line ? <p className="live-previous-result">В прошлый раз: {line}</p> : null })()}
              <WorkoutSetTable variant="live" inputKind={exercise.inputKind} showRpe={isRpeVisible(exercise.id)} trailingLabel="Статус">
                {exercise.sets.map((set, index) => renderLiveSet(exercise, set, `Подход ${index + 1}`, set.id === activeSetId))}
              </WorkoutSetTable>
              {canManageLiveStructure && <button type="button" className="secondary live-add-set" disabled={rootMutationPending} onClick={() => appendSet.mutate(exercise.id)}>＋ Подход</button>}
              {liveCommentField(exercise)}
            </WorkoutExercise>
          })
        }
        // Многоэлементный блок — по кругам, со счётчиком «Круг R из N».
        const rounds = blockRoundsView(block)
        const current = currentRoundIndex(rounds)
        const activeCircuitSetId = blockStatus === 'current'
          ? rounds.flatMap((round) => round.items).find(({ set }) => !set.confirmedAt)?.set.id
          : undefined
        // Счётчик «Круг N из M» + точки закреплены сверху (.live-pinned) для
        // активной круговой; здесь в шапке блока — бейдж, счётчик и стрелки.
        // Точки не дублируем (они в закрепе), но счётчик оставляем как заголовок
        // блока (актуален и для неактивных/завершённых круговых при скролле).
        return <div className="exercise-block live" key={block.blockId}>
          <div className="circuit-head">
            <span className="block-badge">{blockLabel(block.blockType, block.blockPreset)}</span>
            <span className="circuit-counter">Круг {rounds[current]?.round ?? 1} из {rounds.length}</span>
            {canManageLiveStructure && canReorder && !reordering && <OverflowMenu items={[{ label: 'Изменить порядок', onClick: () => setReordering(true) }]} />}
            {reorder}
          </div>
          {rounds.map((round, roundIndex) => { const roundDone = round.items.every(({ set }) => set.confirmedAt); return <div className={`circuit-round ${roundDone ? 'done' : roundIndex === current ? 'current' : ''}`} key={round.round}>
            <div className="circuit-round-label">Круг {round.round}</div>
            {round.items.map(({ exercise, set }) => <section key={set.id}>
              <WorkoutExerciseHeader className="live-exercise-head" titleAs="h3" name={exercise.name}
                leading={roundIndex === 0 ? liveHeaderThumbnail(exercise) : undefined}
                onTitleClick={techniqueActionFor(exercise)} showTechniqueLabel={false} actions={roundIndex === 0 ? exerciseMenu(exercise) : undefined} />
              {liveTechniqueFor(exercise, set.id === activeCircuitSetId)}
              {renderLiveSet(exercise, set, undefined, roundIndex === current && !set.confirmedAt)}
            </section>)}
          </div> })}
          <div className="circuit-exercise-notes" aria-label="Заметки к упражнениям">
            {block.exercises.map((exercise) => <section className="circuit-exercise-note" key={exercise.id}>
              <h3>{exercise.name}</h3>
              {liveCommentField(exercise)}
            </section>)}
          </div>
        </div>
      }) })()}
      {canManageLiveStructure && <button type="button" className="secondary wide" disabled={rootMutationPending} onClick={() => { setReplaceExerciseId(null); setPickerOpen(true) }}>＋ Ещё упражнение</button>}
      {error && <p className="error">{error.message}</p>}
      {commentLive.isError && commentLive.variables && <button type="button" className="secondary" onClick={() => commentLive.mutate(commentLive.variables!)}>Повторить сохранение заметки</button>}
      {/* Закреплённая нижняя панель: «Завершить» — вторичная, чтобы не
          конкурировать с primary-подтверждением подхода в карточке.
          Подтверждение частичного завершения — inline (не нативный confirm,
          который не работает в WKWebView и блокировал выход). */}
      <div className="live-bottom-bar">
        {(liveSyncError || recoveredSetIds.size > 0) && <div className={`live-sync-state ${liveSyncError ? 'error' : ''}`} role={liveSyncError ? 'alert' : 'status'}>
          <div>
            <strong>{liveSyncError ? 'Результаты сохранены на телефоне' : 'Восстановили результаты'}</strong>
            <span>{liveSyncError ? 'Не удалось отправить их на сервер.' : 'Отправим их на сервер автоматически.'}</span>
          </div>
          <button type="button" className="secondary" disabled={save.isPending || confirm.isPending} onClick={() => void retryPendingLiveDrafts()}>{save.isPending ? 'Отправляем…' : 'Повторить'}</button>
        </div>}
        {confirmFinish
          ? <div className="finish-confirm">
              <p>{hasIncompleteLiveSets ? 'Есть незавершённые подходы. Завершить частично?' : 'Все подходы выполнены. Завершить тренировку?'}</p>
              <div className="actions workout-action-row">
                <WorkoutCta type="button" variant="tertiary" onClick={() => setConfirmFinish(false)}>Отмена</WorkoutCta>
                <WorkoutCta pending={finish.isPending} pendingLabel="Завершаем…" disabled={rootMutationPending || save.isPending || confirm.isPending} onClick={() => { setConfirmFinish(false); finish.mutate() }}>Завершить</WorkoutCta>
              </div>
            </div>
          : <WorkoutCta variant={hasIncompleteLiveSets ? 'secondary' : 'primary'} className="wide" pending={finish.isPending} pendingLabel="Завершаем…" disabled={rootMutationPending || save.isPending || confirm.isPending} onClick={() => { if (hasIncompleteLiveSets) setConfirmFinish(true); else finish.mutate() }}>Завершить тренировку</WorkoutCta>}
      </div>
    </>}</AsyncView>
    {canManageLiveStructure && pickerOpen && <ExercisePicker catalog={catalog} clientRecent={clientRecentExercises} techniqueActionLabel={replaceExerciseId ? 'Заменить упражнение' : 'Добавить упражнение'} onPick={pickLiveExercise} onClose={closePicker} />}
    {techniqueExercise && <ExerciseTechniqueSheet exercise={techniqueExercise} onClose={() => setTechniqueExercise(null)} />}
    {confirmDialog}
  </Page>
}

function numberValue(value: FormDataEntryValue | null) { return value ? Number(value) : undefined }

type ExerciseCardTab = 'stats' | 'history' | 'how'

export function ExerciseHistoryPage() {
  const { exercises: exercisesRepository, workouts: workoutsRepository } = useDataBackend()
  const { workoutId = '', exerciseRef = '' } = useParams()
  const goBack = useWorkoutBack(`/workouts/${workoutId}`)
  const { actor } = useAuth()
  const showRpe = useRpeDisplay(actor?.userId)
  const [tab, setTab] = useState<ExerciseCardTab>('stats')
  const current = useQuery({ queryKey: ['workout', workoutId], queryFn: () => workoutsRepository.get(workoutId) })
  useClientRealtime(current.data?.clientId)
  const history = useInfiniteQuery({
    queryKey: ['exercise-history', current.data?.clientId, exerciseRef],
    initialPageParam: null as ExerciseProgressCursor | null,
    queryFn: ({ pageParam }) => workoutsRepository.exerciseProgressPage(current.data!.clientId, exerciseRef, pageParam),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: Boolean(current.data),
  })
  const items = useMemo(() => history.data?.pages.flatMap((page) => page.items) ?? [], [history.data])
  const totalCount = history.data?.pages[0]?.totalCount ?? 0
  // Метаданные упражнения из каталога (картинка/оборудование/мышцы/инструкции).
  const meta = exercisesRepository.system.find((exercise) => exercise.ref === exerciseRef)
  const currentExercise = current.data?.exercises.find((exercise) => exercise.ref === exerciseRef)
  const inputKind = meta?.inputKind ?? currentExercise?.inputKind ?? items[0]?.inputKind ?? 'strength'
  const name = meta?.name ?? currentExercise?.name ?? items[0]?.exerciseName ?? 'Упражнение'
  const chart = useMemo(() => items
    .filter((item) => item.primaryValue !== null)
    .map((item) => ({ date: item.workoutDate, completedAt: item.completedAt, value: item.primaryValue! }))
    .sort((a, b) => a.completedAt.localeCompare(b.completedAt)), [items])
  const unit = chartUnitFor(inputKind)
  const instructions = meta?.instructions ?? []
  return <Page title="Упражнение" back={`/workouts/${workoutId}`} onBack={goBack}>
    <AsyncView loading={current.isLoading || history.isLoading} error={current.error ?? history.error} onRetry={() => { void current.refetch(); void history.refetch() }}>
      <section className="exercise-card-head card">
        {hasExerciseAnimation(meta) && <ExerciseImage src={meta.imageUrl} alt={name} variant="detail" />}
        <div className="exercise-card-meta">
          <h2>{name}</h2>
          {meta?.equipment && <p><span className="muted">Оборудование:</span> {meta.equipment}</p>}
          {meta?.primaryMuscleDetail && <p><span className="muted">Основная группа мышц:</span> {meta.primaryMuscleDetail}</p>}
          {meta?.secondaryMuscles?.length ? <p><span className="muted">Вторичная группа мышц:</span> {meta.secondaryMuscles.join(', ')}</p> : null}
        </div>
      </section>

      <div className="tabs exercise-card-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'stats'} className={tab === 'stats' ? 'tab active' : 'tab'} onClick={() => setTab('stats')}>Статистика</button>
        <button type="button" role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'tab active' : 'tab'} onClick={() => setTab('history')}>История</button>
        <button type="button" role="tab" aria-selected={tab === 'how'} className={tab === 'how' ? 'tab active' : 'tab'} onClick={() => setTab('how')}>Техника</button>
      </div>

      {tab === 'stats' && <>
        <ExerciseProgressSummary latest={items[0]} totalCount={totalCount} />
        {chart.length > 1
          ? (() => {
            // Оформление как на вкладке замеров: пунктирная сетка, подписи дат
            // «01 / июль», подписи значений у мин/макс точек, форматированный тултип.
            const values = chart.map((point) => point.value)
            const minValue = Math.min(...values); const maxValue = Math.max(...values)
            const minIndex = values.indexOf(minValue); const maxIndex = values.indexOf(maxValue)
            const chartTitle = inputKind === 'reps' ? 'Динамика повторений' : `Динамика (${unit})`
            return <section className="chart exercise-progress-chart"><h2>{chartTitle}</h2><ResponsiveContainer width="100%" height={260}><LineChart data={chart} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" stroke="var(--muted)" height={40} tick={AxisTick} interval={Math.max(0, Math.ceil(chart.length / 5) - 1)} />
              <YAxis stroke="var(--muted)" style={{ fontSize: '12px' }} domain={computeYDomain(values)} allowDecimals />
              <Tooltip contentStyle={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--fg)' }} labelStyle={{ color: 'var(--fg)', fontWeight: 700 }} itemStyle={{ color: 'var(--fg)' }}
                formatter={(value) => formatTooltipValue(Number(value), unit, 'Результат')} labelFormatter={(date) => formatTooltipLabel(String(date))} />
              <Line type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={3}
                dot={(dotProps: { cx?: number; cy?: number; index?: number }) => renderChartDot(dotProps, minIndex, maxIndex, chart.length)}
                activeDot={{ r: 7 }} isAnimationActive={false} />
            </LineChart></ResponsiveContainer></section>
          })()
          : chart.length === 1
            ? <p className="muted empty-hint">График динамики появится после второго подтверждённого результата.</p>
            : null}
      </>}

      {tab === 'history' && <ExerciseProgressHistory items={items} showRpe={showRpe} exerciseRef={exerciseRef} />}

      {tab === 'how' && <section className="exercise-technique">
        {hasExerciseAnimation(meta) && <ExerciseImage src={meta.imageUrl} motionSrc={meta.motionImageUrl} videoSrc={meta.techniqueVideoUrl} alt={`Техника: ${name}`} variant="technique" />}
        {instructions.length
          ? <ol className="how-steps">{instructions.map((step, index) => <li key={index}>{step}</li>)}</ol>
          : <p className="muted empty-hint">Описание техники пока не добавлено.</p>}
      </section>}
      {tab !== 'how' && <LoadMoreButton hasMore={history.hasNextPage} loading={history.isFetchingNextPage} onLoadMore={() => void history.fetchNextPage()} />}
    </AsyncView>
  </Page>
}
