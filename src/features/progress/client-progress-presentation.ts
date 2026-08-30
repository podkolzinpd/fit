import { compactPlannedSetSummary } from '../../data/repositories/workout-rules'
import type { ClientGoal, GoalCriterionMetric, ProgressEntry, PublishedTrainingSummary, TrainingSummary, Workout, WorkoutPersonalRecord } from '../../shared/domain'
import { GOAL_CRITERION_METRICS, goalCriterionTargetLabel, isStandardGoalCriterionMetric, type GoalCriterionFoundationState } from '../../shared/goal-criterion-rules'
import { calculateStandardGoalProgress, type GoalProgressDirection, type GoalProgressStatus } from '../../shared/goal-progress'
import { calculateTrainingGoalProgress } from '../../shared/goal-training-progress'
import { addDays, daysBetween, formatLocalDate, formatLocalDateShort, type LocalDate } from '../../shared/local-date'
import { buildPeriodComparison, type PeriodComparison, type PeriodComparisonFactKind } from './period-comparison'
import { progressFactChangeLabel } from './progress-facts'
import { progressMetricNoun } from './summary-format'

type ProgressSummary = PublishedTrainingSummary | TrainingSummary

export type StoryOptions = {
  currentWorkouts?: readonly Workout[]
  previousWorkouts?: readonly Workout[]
  measurements?: readonly ProgressEntry[]
  goal?: ClientGoal | null
  profileGoal?: string | null
  upcomingWorkouts?: readonly Workout[]
  personalRecords?: readonly WorkoutPersonalRecord[]
  personalRecordWorkout?: Pick<Workout, 'id' | 'workoutDate'>
  today?: LocalDate
  role?: 'client' | 'trainer'
}

export type ClientProgressPresentation = {
  hero?: { value: string; exerciseName: string; detail: string }
  stats: Array<{ value: string; label: string }>
  wins: Array<{ title: string; detail: string }>
  comparison: PeriodComparison
  goal?: {
    title: string
    state: GoalCriterionFoundationState
    statusLabel: string
    criterionLabel?: string
    targetLabel?: string
    currentLabel?: string
    periodEndLabel?: string
    dynamicsLabel?: string
    lastMeasurementLabel?: string
    sufficiencyLabel?: string
    freshnessLabel?: string
    baselineLabel?: string
    message?: string
    measurementAction?: boolean
    completedCriteria?: number
    totalCriteria?: number
    criteria?: Array<{ id: string; label: string; target: string; status: string; current: string; dynamics: string; lastDate?: string; freshness: string; sufficiency: string; dataOwner: 'measurement' | 'workout'; action: 'measurement' | 'workout' | 'configure' | null }>
  }
  nextWorkout?: { id: string; date: string; title: string; exercises: Array<{ name: string; plan?: string }> }
  mainNow: {
    factId: string
    kind: 'goal' | 'measurement' | 'personal_record' | 'exercise' | 'regularity' | 'gap' | 'data' | 'plan'
    title: string
    explanation: string
    evidence: string
    source: 'llm' | 'deterministic'
    action?: 'goal' | 'measurement' | 'workout'
    subject?: string
  }
  orientations: string[]
}

const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })

function improvedExerciseLabel(value: number): string {
  const mod100 = Math.abs(value) % 100
  const mod10 = Math.abs(value) % 10
  if (mod100 >= 11 && mod100 <= 14) return 'упражнений улучшено'
  if (mod10 === 1) return 'упражнение улучшено'
  if (mod10 >= 2 && mod10 <= 4) return 'упражнения улучшены'
  return 'упражнений улучшено'
}

function done(workouts: readonly Workout[]): Workout[] {
  return workouts.filter((workout) => workout.status === 'done')
}

function mondayKey(value: LocalDate): string {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1))
  const offset = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - offset)
  return date.toISOString().slice(0, 10)
}

function activeWeeks(workouts: readonly Workout[]): number {
  return new Set(done(workouts).map((workout) => mondayKey(workout.workoutDate))).size
}

function periodWeeks(start: LocalDate, end: LocalDate): number {
  const startKey = mondayKey(start)
  const endKey = mondayKey(end)
  const startDate = new Date(`${startKey}T00:00:00Z`)
  const endDate = new Date(`${endKey}T00:00:00Z`)
  return Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 604_800_000) + 1)
}

const GOAL_STATE_LABELS: Record<GoalCriterionFoundationState, string> = {
  unconfigured: 'Не настроено',
  needs_review: 'Нужно проверить',
  needs_data: 'Нужны данные',
  configured: 'Настроено',
}

const GOAL_PROGRESS_STATUS_LABELS: Record<GoalProgressStatus, string> = {
  target_reached: 'Ориентир достигнут',
  target_not_reached: 'Движение к ориентиру',
  in_range_now: 'В диапазоне сейчас',
  range_maintained: 'Диапазон удерживается',
  outside_range: 'Вне диапазона',
  tracking: 'Отслеживается',
  needs_data: 'Нужны данные',
  needs_baseline: 'Нужна отправная точка',
}

const DIRECTION_LABELS: Record<GoalProgressDirection, string> = {
  toward_target: 'ближе к ориентиру',
  away_from_target: 'дальше от ориентира',
  stable: 'положение не изменилось',
  increased: 'значение выросло',
  decreased: 'значение снизилось',
  unchanged: 'без изменения',
  insufficient_data: 'недостаточно данных для динамики',
}

function goalProgressStatusLabel(status: GoalProgressStatus, direction: GoalProgressDirection): string {
  if (status === 'target_not_reached' && direction === 'away_from_target') return 'Дальше от ориентира'
  return GOAL_PROGRESS_STATUS_LABELS[status]
}

function signed(value: number, unit: string): string {
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${number.format(Math.abs(value))} ${unit}`
}

function goalStory(summary: ProgressSummary, options: StoryOptions): ClientProgressPresentation['goal'] {
  const title = options.goal?.title ?? options.profileGoal?.trim()
  if (!title) return undefined
  const criteria = options.goal?.criteria ?? []
  if (!criteria.length) return { title, state: 'unconfigured', statusLabel: GOAL_STATE_LABELS.unconfigured }
  if (criteria.some((criterion) => criterion.confirmationStatus !== 'confirmed')) {
    return { title, state: 'needs_review', statusLabel: GOAL_STATE_LABELS.needs_review, totalCriteria: criteria.length }
  }
  if (!options.today) {
    const criterion = criteria[0]!
    return { title, state: 'configured', statusLabel: GOAL_STATE_LABELS.configured,
      criterionLabel: GOAL_CRITERION_METRICS[criterion.metric].label, targetLabel: goalCriterionTargetLabel(criterion) }
  }
  const calculated = criteria.map((criterion) => {
    const result = isStandardGoalCriterionMetric(criterion.metric)
      ? calculateStandardGoalProgress(criterion, options.measurements ?? [], summary.periodStart, summary.periodEnd, options.today!)
      : calculateTrainingGoalProgress(criterion, [...(options.previousWorkouts ?? []), ...(options.currentWorkouts ?? []), ...(options.upcomingWorkouts ?? [])], options.measurements ?? [], summary.periodStart, summary.periodEnd, options.today!)
    const dynamics = result.dynamics.first && result.dynamics.last && result.dynamics.delta !== null
      ? `${number.format(result.dynamics.first.value)} → ${number.format(result.dynamics.last.value)} ${criterion.unit} (${signed(result.dynamics.delta, criterion.unit)}) · ${DIRECTION_LABELS[result.dynamics.direction]}`
      : DIRECTION_LABELS[result.dynamics.direction]
    const freshness = result.freshness === 'fresh' ? result.ageDays === 0 ? 'Свежие данные · сегодня' : `Свежие данные · ${result.ageDays} дн. назад`
      : result.freshness === 'stale' ? `Данные устарели · ${result.ageDays} дн. назад` : 'Нет данных'
    const sufficiency = { none: 'Нет замеров', position_only: 'Достаточно только для текущего положения', enough_for_dynamics: 'Достаточно для динамики периода', enough_for_maintenance: 'Достаточно для проверки удержания' }[result.sufficiency]
    return {
      criterion,
      result,
      presentation: {
        id: criterion.id,
        dataOwner: isStandardGoalCriterionMetric(criterion.metric) || criterion.metric === 'custom' ? 'measurement' as const : 'workout' as const,
        label: `${GOAL_CRITERION_METRICS[criterion.metric].label}${criterion.exerciseName ? ` · ${criterion.exerciseName}` : ''}${criterion.customMetricName ? ` · ${criterion.customMetricName}` : ''}`,
        target: goalCriterionTargetLabel(criterion), status: goalProgressStatusLabel(result.status, result.dynamics.direction),
        current: result.latestNow ? `${number.format(result.latestNow.value)} ${criterion.unit}${'secondaryCurrent' in result && result.secondaryCurrent != null ? ` за ${number.format(result.secondaryCurrent)} мин` : ''}` : 'Нет данных',
        dynamics, lastDate: result.latestNow ? formatLocalDate(result.latestNow.recordedOn) : undefined,
        freshness, sufficiency,
        action: result.status === 'needs_data' || result.status === 'needs_baseline'
          ? isStandardGoalCriterionMetric(criterion.metric) || criterion.metric === 'custom' ? 'measurement' as const : 'workout' as const
          : result.freshness === 'stale' ? isStandardGoalCriterionMetric(criterion.metric) || criterion.metric === 'custom' ? 'measurement' as const : 'workout' as const : null,
      },
    }
  })
  const completed = calculated.filter(({ result }) => result.status === 'target_reached' || result.status === 'range_maintained').length
  const primary = calculated[0]!
  const message = criteria.length > 1
    ? 'Каждый критерий оценивается отдельно по подтверждённым данным.'
    : primary.result.freshness === 'stale'
      ? 'Текущее положение рассчитано по устаревшему результату. Добавьте новые данные, чтобы обновить вывод.'
      : primary.result.status === 'in_range_now'
        ? primary.result.sufficiency === 'enough_for_maintenance'
          ? 'Значение находится в диапазоне сейчас, но в окне удержания был замер за его пределами.'
          : 'Значение находится в диапазоне сейчас. Для подтверждения удержания нужны минимум два замера с интервалом не менее 7 дней.'
        : primary.result.status === 'needs_baseline'
          ? 'Первый замер станет отправной точкой для относительной цели.'
          : primary.result.status === 'range_maintained'
            ? 'Все замеры окна удержания находятся в заданном диапазоне.'
            : primary.result.status === 'target_reached'
              ? 'Последний актуальный результат соответствует заданному ориентиру.'
              : primary.result.status === 'needs_data'
                ? 'Пока недостаточно подтверждённых данных.'
                : primary.result.status === 'target_not_reached'
                  ? 'Последний актуальный результат пока не достиг заданного ориентира.'
                  : 'Показатель отслеживается без оценки направления улучшения.'
  return {
    title, state: 'configured', statusLabel: criteria.length === 1 ? goalProgressStatusLabel(primary.result.status, primary.result.dynamics.direction) : `${completed} из ${criteria.length} выполнено`,
    criterionLabel: primary.presentation.label, targetLabel: primary.presentation.target, currentLabel: primary.presentation.current,
    periodEndLabel: primary.result.periodEnd ? `${number.format(primary.result.periodEnd.value)} ${primary.criterion.unit} · ${formatLocalDateShort(primary.result.periodEnd.recordedOn)}` : 'Нет данных к концу периода',
    dynamicsLabel: primary.presentation.dynamics, lastMeasurementLabel: primary.presentation.lastDate,
    sufficiencyLabel: primary.presentation.sufficiency, freshnessLabel: primary.presentation.freshness,
    baselineLabel: 'baseline' in primary.result && primary.result.baseline ? `${number.format(primary.result.baseline.value)} ${primary.criterion.unit} · ${formatLocalDateShort(primary.result.baseline.recordedOn)}` : undefined,
    message,
    measurementAction: primary.presentation.action !== null, completedCriteria: completed, totalCriteria: criteria.length,
    criteria: calculated.map((item) => item.presentation),
  }
}

function nextWorkoutStory(workouts: readonly Workout[], today?: LocalDate): ClientProgressPresentation['nextWorkout'] {
  const next = [...workouts]
    .filter((workout) => workout.status === 'planned' && (!today || workout.workoutDate >= today))
    .sort((left, right) => left.workoutDate.localeCompare(right.workoutDate) || (left.startTime ?? '').localeCompare(right.startTime ?? ''))[0]
  if (!next) return undefined
  return {
    id: next.id,
    date: `${formatLocalDate(next.workoutDate)}${next.startTime ? ` · ${next.startTime}` : ''}`,
    title: next.stageTitle ?? 'Ближайшая тренировка',
    exercises: next.exercises.slice(0, 3).map((exercise) => ({
      name: exercise.name,
      plan: compactPlannedSetSummary(exercise.sets) ?? undefined,
    })),
  }
}

type StoryChange = { exerciseName: string; detail: string; percent: number }

function parseNumber(value: string): number {
  return Number(value.replace(/\s/g, '').replace(',', '.'))
}

function legacyStoryChanges(summary: ProgressSummary): StoryChange[] {
  return (clientCopy(summary).achievements ?? []).flatMap((raw) => {
    const text = raw.trim()
    const movement = text.match(/^([^:]+):\s*(.+?)\s+(?:вырос(?:ла|ло)?|увеличил(?:ся|ась|ось))\s+с\s+([\d\s.,]+)\s+до\s+([\d\s.,]+)\s*(кг|км|повт\.?|мин)?(?:\s*\(\+?([\d.,]+)%\))?/i)
    const arrow = text.match(/^([^:]+):\s*(.+?):?\s+([\d\s.,]+)\s*→\s*([\d\s.,]+)\s*(кг|км|повт\.?|мин)?(?:.*?\+([\d.,]+)%)?/i)
    const match = movement ?? arrow
    if (!match) return []
    const from = parseNumber(match[3] ?? '')
    const to = parseNumber(match[4] ?? '')
    if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to <= from) return []
    const percent = Math.round(match[6] ? parseNumber(match[6]) : ((to - from) / from) * 100)
    const metric = (match[2] ?? 'Результат').trim().replace(/^./u, (letter) => letter.toLocaleUpperCase('ru-RU'))
    const unit = match[5] ? ` ${match[5].replace(/\.$/, '')}` : ''
    return [{
      exerciseName: (match[1] ?? '').trim(),
      detail: `${metric}: ${number.format(from)} → ${number.format(to)}${unit} · +${percent}%`,
      percent,
    }]
  })
}

function storyChanges(summary: ProgressSummary): StoryChange[] {
  const structured = summary.metrics.progressFacts
    .flatMap((fact) => fact.changes
      .filter((change) => change.favorable === true)
      .map((change) => ({
        exerciseName: fact.exerciseName,
        detail: progressFactChangeLabel(change),
        percent: Math.abs(Math.round(change.changePercent)),
      })))
  return (structured.length > 0 ? structured : legacyStoryChanges(summary))
    .sort((left, right) => right.percent - left.percent)
}

function presentationWins(summary: ProgressSummary): ClientProgressPresentation['wins'] {
  return storyChanges(summary)
    .map((item) => ({ title: item.exerciseName, detail: item.detail }))
    .slice(0, 3)
}

function clientCopy(summary: ProgressSummary) {
  return 'summary' in summary ? summary.summary : summary.client
}

function comparisonCopyCandidates(summary: ProgressSummary, role: StoryOptions['role']): string[] {
  if ('summary' in summary) {
    return [
      summary.summary.headline,
      ...summary.summary.achievements,
      summary.summary.consistency,
      summary.summary.goalAlignment ?? '',
    ].filter(Boolean)
  }
  return role === 'trainer'
    ? [summary.trainer.headline, ...summary.trainer.progress, summary.trainer.consistency]
    : [summary.client.headline, ...summary.client.achievements, summary.client.consistency, summary.client.goalAlignment ?? '']
}

function usefulOrientations(summary: ProgressSummary): string[] {
  const copy = clientCopy(summary)
  const generic = /продолжать отслеживать|поддерживать регулярность|сравнивать текущие результаты|на верном пути/i
  const exerciseTokens = summary.metrics.progressFacts
    .flatMap((fact) => fact.exerciseName.toLocaleLowerCase('ru-RU').split(' (')[0]?.split(/[^а-яё]+/u) ?? [])
    .filter((word) => word.length >= 4)
    .map((word) => word.slice(0, Math.max(4, word.length - 2)))
  return (copy.nextSteps ?? [])
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && !generic.test(item))
    .filter((item) => {
      const normalized = item.toLocaleLowerCase('ru-RU')
      return /\d/u.test(normalized) || exerciseTokens.some((token) => normalized.includes(token))
    })
    .slice(0, 2)
}

type MainNow = ClientProgressPresentation['mainNow']
type MainNowCandidate = Omit<MainNow, 'source'> & {
  priority: number
  anchors: string[]
  numbers: string[]
  llmKinds: Array<'headline' | 'goal' | 'consistency'>
}

const MEASUREMENT_METRICS: Array<{
  metric: Extract<GoalCriterionMetric, 'weight' | 'waist' | 'chest' | 'hips'>
  key: 'weightKg' | 'waistCm' | 'chestCm' | 'hipCm'
  label: string
  unit: string
}> = [
  { metric: 'weight', key: 'weightKg', label: 'Вес', unit: 'кг' },
  { metric: 'waist', key: 'waistCm', label: 'Талия', unit: 'см' },
  { metric: 'chest', key: 'chestCm', label: 'Грудь', unit: 'см' },
  { metric: 'hips', key: 'hipCm', label: 'Бёдра', unit: 'см' },
]

function searchable(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/[.,]/g, ',').replace(/\s+/g, ' ').trim()
}

function anchorWords(value: string): string[] {
  return searchable(value).split(/[^а-яa-z0-9]+/u).filter((word) => word.length >= 4)
}

function numericAnchors(...values: Array<number | null | undefined>): string[] {
  return values
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .flatMap((value) => {
      const formatted = number.format(Math.abs(value))
      const raw = String(Math.abs(value)).replace('.', ',')
      return formatted === raw ? [formatted] : [formatted, raw]
    })
}

function conciseLlmText(text: string | undefined): string | undefined {
  const value = text?.replace(/\s+/g, ' ').trim()
  if (!value || value.length > 240) return undefined
  const sentenceCount = value.split(/[.!?]+/u).filter(Boolean).length
  return sentenceCount <= 2 ? value : undefined
}

function groundedText(candidate: MainNowCandidate, texts: Record<'headline' | 'goal' | 'consistency', string | undefined>): string | undefined {
  for (const kind of candidate.llmKinds) {
    const text = conciseLlmText(texts[kind])
    if (!text) continue
    const normalized = searchable(text)
    const hasAnchor = candidate.anchors.some((anchor) => normalized.includes(searchable(anchor)))
    const textNumbers: string[] = normalized.match(/\d+(?:,\d+)?/g) ?? []
    const hasNumber = candidate.numbers.length === 0 || candidate.numbers.some((value) => textNumbers.includes(searchable(value).replace(/\s/g, '')))
    if (hasAnchor && hasNumber) return text
  }
  return undefined
}

function personalRecordLabel(record: WorkoutPersonalRecord): string {
  if (record.inputKind === 'strength' && record.weightKg !== null) {
    return `${number.format(record.weightKg)} кг${record.reps === null ? '' : ` × ${record.reps} повт.`}`
  }
  const unit = record.inputKind === 'distance' ? 'км' : record.inputKind === 'duration' ? 'мин' : 'повт.'
  return `${number.format(record.primaryValue)} ${unit}`
}

function measurementCandidates(summary: ProgressSummary, options: StoryOptions): MainNowCandidate[] {
  const entries = [...(options.measurements ?? [])]
    .filter((entry) => entry.recordedOn >= summary.periodStart && entry.recordedOn <= summary.periodEnd)
    .sort((left, right) => left.recordedOn.localeCompare(right.recordedOn))
  const goalMetrics = new Set(options.goal?.criteria.map((criterion) => criterion.metric) ?? [])
  return MEASUREMENT_METRICS.flatMap(({ metric, key, label, unit }) => {
    const points = entries.flatMap((entry) => typeof entry[key] === 'number' ? [{ value: entry[key]!, date: entry.recordedOn }] : [])
    const first = points[0]
    const last = points.at(-1)
    if (!first || !last || first.date === last.date || first.value === last.value) return []
    const delta = last.value - first.value
    return [{
      factId: `measurement:${metric}:${first.date}:${last.date}`,
      kind: 'measurement' as const,
      priority: goalMetrics.has(metric) ? 86 : 66,
      title: `${label}: ${delta > 0 ? 'рост' : 'снижение'} за период`,
      explanation: goalMetrics.has(metric)
        ? 'Изменение относится к подтверждённому критерию цели.'
        : 'Это самое свежее сопоставимое изменение показателя за выбранный период.',
      evidence: `${number.format(first.value)} → ${number.format(last.value)} ${unit} · ${signed(delta, unit)}`,
      subject: label,
      anchors: [label, ...anchorWords(label)],
      numbers: numericAnchors(first.value, last.value, delta),
      llmKinds: goalMetrics.has(metric) ? ['goal', 'headline'] : ['headline'],
    }]
  })
}

function goalCandidates(goal: ClientProgressPresentation['goal']): MainNowCandidate[] {
  if (!goal) return []
  const anchors = [goal.title, ...(goal.criterionLabel ? [goal.criterionLabel] : []), ...anchorWords(goal.title)]
  if (goal.state === 'unconfigured') return [{
    factId: 'goal:unconfigured', kind: 'goal', priority: 110,
    title: 'Настрой оценку цели', explanation: 'Цель сохранена, но пока не связана с измеримым критерием.',
    evidence: goal.title, action: 'goal', anchors, numbers: [], llmKinds: [],
  }]
  if (goal.state === 'needs_review') return [{
    factId: 'goal:needs-review', kind: 'goal', priority: 111,
    title: 'Проверь критерий цели', explanation: 'Формулировка цели изменилась, поэтому старый критерий нельзя применять без подтверждения.',
    evidence: goal.title, action: 'goal', anchors, numbers: [], llmKinds: [],
  }]
  const primary = goal.criteria?.[0]
  if (primary?.action) {
    const action = primary.action === 'configure' ? 'goal' : primary.action
    return [{
      factId: `goal:${primary.id}:${action}`, kind: 'data', priority: 112,
      title: primary.action === 'measurement' ? 'Добавь актуальный замер' : 'Нужен подтверждённый результат',
      explanation: primary.action === 'measurement'
        ? 'Без нового замера нельзя честно оценить движение к цели.'
        : 'Без результата тренировки нельзя обновить положение относительно ориентира.',
      evidence: `${primary.label} · ${primary.freshness} · ${primary.sufficiency}`,
      action, anchors: [primary.label, ...anchorWords(primary.label)], numbers: [], llmKinds: [],
    }]
  }
  if (!primary) return []
  const reached = /достигнут|удерживается|в диапазоне/u.test(primary.status.toLocaleLowerCase('ru-RU'))
  const away = primary.dynamics.toLocaleLowerCase('ru-RU').includes('дальше от ориентира')
  const toward = primary.dynamics.toLocaleLowerCase('ru-RU').includes('ближе к ориентиру')
  const numeric = `${primary.current} ${primary.target}`.match(/\d+(?:[.,]\d+)?/g)?.map((value) => value.replace('.', ',')) ?? []
  return [{
    factId: `goal:${primary.id}:${reached ? 'reached' : 'tracking'}`, kind: 'goal', priority: reached ? 106 : 103,
    title: reached
      ? 'Текущий результат соответствует ориентиру'
      : away
        ? 'Положение стало дальше от ориентира'
        : toward
          ? 'Есть движение к ориентиру цели'
          : 'Положение относительно цели обновлено',
    explanation: reached ? 'Вывод основан на последнем актуальном результате.' : 'Текущее положение рассчитано по подтверждённому показателю.',
    evidence: `${primary.label} · ${primary.current} · ${primary.status}`,
    subject: primary.label,
    anchors: [primary.label, goal.title, ...anchorWords(primary.label), ...anchorWords(goal.title)],
    numbers: numeric, llmKinds: ['goal'],
  }]
}

function mainNow(summary: ProgressSummary, options: StoryOptions, goal: ClientProgressPresentation['goal'], totalWeeks: number): MainNow {
  const candidates: MainNowCandidate[] = [...goalCandidates(goal), ...measurementCandidates(summary, options)]
  const record = options.personalRecords?.[0]
  if (record && options.personalRecordWorkout) {
    const value = personalRecordLabel(record)
    candidates.push({
      factId: `personal-record:${options.personalRecordWorkout.id}:${record.exerciseRef}:${record.metric}`,
      kind: 'personal_record', priority: 102, title: `Новый личный рекорд · ${record.exerciseName}`,
      explanation: 'Результат подтверждён в завершённой тренировке.',
      evidence: `${value} · ${formatLocalDateShort(options.personalRecordWorkout.workoutDate)}`,
      subject: record.exerciseName,
      anchors: [record.exerciseName, 'личный рекорд', ...anchorWords(record.exerciseName)],
      numbers: numericAnchors(record.primaryValue, record.weightKg, record.reps), llmKinds: ['headline'],
    })
  }
  if (summary.metrics.longestGapDays !== null && summary.metrics.longestGapDays >= 14) {
    candidates.push({
      factId: `regularity:gap:${summary.metrics.longestGapDays}`, kind: 'gap', priority: 96,
      title: 'В ритме была длинная пауза', explanation: 'Это важнее общих изменений нагрузки за выбранный период.',
      evidence: `${summary.metrics.longestGapDays} ${progressMetricNoun(summary.metrics.longestGapDays, 'gapDay')}`,
      anchors: ['пауза', 'перерыв'], numbers: numericAnchors(summary.metrics.longestGapDays), llmKinds: ['consistency'],
    })
  }
  for (const change of storyChanges(summary)) {
    candidates.push({
      factId: `exercise:${searchable(change.exerciseName)}:${change.percent}`,
      kind: 'exercise', priority: 76 + Math.min(change.percent, 20) / 10,
      title: `Заметное изменение · ${change.exerciseName}`,
      explanation: 'Это наиболее выраженное подтверждённое изменение упражнения за период.',
      evidence: change.detail, anchors: [change.exerciseName, ...anchorWords(change.exerciseName)],
      subject: change.exerciseName,
      numbers: numericAnchors(change.percent), llmKinds: ['headline'],
    })
  }
  const current = done(options.currentWorkouts ?? []).length
  const useFetched = options.currentWorkouts !== undefined && (current > 0 || summary.metrics.completedWorkouts === 0)
  const completed = useFetched ? current : summary.metrics.completedWorkouts
  const weeks = useFetched ? activeWeeks(options.currentWorkouts ?? []) : summary.metrics.activeWeeks
  if (completed > 0) candidates.push({
    factId: `regularity:${completed}:${weeks}:${totalWeeks}`, kind: 'regularity', priority: 62,
    title: weeks === totalWeeks ? 'Ритм удержан весь период' : 'Тренировочный ритм зафиксирован',
    explanation: weeks === totalWeeks ? 'Тренировки были в каждой неделе выбранного периода.' : 'Это отправная точка для сравнения регулярности дальше.',
    evidence: `${completed} ${progressMetricNoun(completed, 'workout')} · ${weeks} из ${totalWeeks} активных недель`,
    anchors: ['трениров', 'недел', 'ритм'], numbers: numericAnchors(completed, weeks, totalWeeks), llmKinds: ['consistency'],
  })
  if (!nextWorkoutStory(options.upcomingWorkouts ?? [], options.today)) candidates.push({
    factId: 'plan:missing', kind: 'plan', priority: 58,
    title: 'Ближайшая тренировка не запланирована', explanation: 'План поможет связать следующий шаг с текущими результатами.',
    evidence: 'В ближайшие 45 дней нет запланированной тренировки', action: 'workout',
    anchors: [], numbers: [], llmKinds: [],
  })
  candidates.push({
    factId: 'data:baseline', kind: 'data', priority: 1,
    title: 'Период сохранён как отправная точка', explanation: 'Сопоставимый вывод появится после следующего периода с подтверждёнными результатами.',
    evidence: `${completed} ${progressMetricNoun(completed, 'workout')} · ${weeks} из ${totalWeeks} активных недель`,
    anchors: [], numbers: [], llmKinds: [],
  })
  candidates.sort((left, right) => right.priority - left.priority || left.factId.localeCompare(right.factId))
  const copy = clientCopy(summary)
  const texts = {
    headline: 'summary' in summary ? copy.headline : summary.trainer.headline,
    goal: copy.goalAlignment,
    consistency: 'summary' in summary ? copy.consistency : summary.trainer.consistency,
  }
  const critical = candidates[0]!
  const grounded = candidates
    .map((candidate) => ({ candidate, text: groundedText(candidate, texts) }))
    .filter((item): item is { candidate: MainNowCandidate; text: string } => Boolean(item.text))
    .sort((left, right) => right.candidate.priority - left.candidate.priority)[0]
  const selected = critical.priority >= 90 ? critical : grounded?.candidate ?? critical
  const llmText = selected === grounded?.candidate ? grounded.text : undefined
  return {
    factId: selected.factId, kind: selected.kind, title: selected.title,
    explanation: llmText ?? selected.explanation, evidence: selected.evidence,
    source: llmText ? 'llm' : 'deterministic',
    ...(selected.action ? { action: selected.action } : {}),
    ...(selected.subject ? { subject: selected.subject } : {}),
  }
}

export function progressStoryPresentation(summary: ProgressSummary, options: StoryOptions = {}): ClientProgressPresentation {
  const changes = storyChanges(summary)
  const favorableCount = new Set(changes.map((item) => item.exerciseName)).size
  const fetchedCompletedWorkouts = done(options.currentWorkouts ?? []).length
  const useFetchedWorkouts = options.currentWorkouts !== undefined
    && (fetchedCompletedWorkouts > 0 || summary.metrics.completedWorkouts === 0)
  const completedWorkouts = useFetchedWorkouts ? fetchedCompletedWorkouts : summary.metrics.completedWorkouts
  const currentActiveWeeks = useFetchedWorkouts ? activeWeeks(options.currentWorkouts ?? []) : summary.metrics.activeWeeks
  const totalWeeks = periodWeeks(summary.periodStart, summary.periodEnd)
  const best = changes[0]
  const stats: ClientProgressPresentation['stats'] = [
    { value: String(completedWorkouts), label: progressMetricNoun(completedWorkouts, 'workout') },
    { value: `${currentActiveWeeks}/${totalWeeks}`, label: 'недель с тренировками' },
  ]
  if (favorableCount > 0) stats.push({ value: String(favorableCount), label: improvedExerciseLabel(favorableCount) })
  const goal = goalStory(summary, options)
  const main = mainNow(summary, options, goal, totalWeeks)
  const periodDays = daysBetween(summary.periodStart, summary.periodEnd) + 1
  const currentPeriod = { start: summary.periodStart, end: summary.periodEnd }
  const previousPeriod = { start: addDays(summary.periodStart, -periodDays), end: addDays(summary.periodStart, -1) }
  const excludedKinds: PeriodComparisonFactKind[] = main.kind === 'regularity' || main.kind === 'gap'
    ? ['regularity']
    : []
  const periodComparison = buildPeriodComparison({
    currentPeriod,
    previousPeriod,
    currentWorkouts: options.currentWorkouts ?? [],
    previousWorkouts: options.previousWorkouts ?? [],
    measurements: options.measurements,
    goal: options.goal,
    llmCandidates: comparisonCopyCandidates(summary, options.role),
    excludedSubject: main.kind === 'exercise' || main.kind === 'personal_record' || main.kind === 'measurement' || main.kind === 'goal'
      ? main.subject
      : undefined,
    excludedKinds,
  })
  return {
    hero: best ? {
      value: `+${best.percent}%`,
      exerciseName: best.exerciseName,
      detail: best.detail,
    } : undefined,
    stats,
    wins: presentationWins(summary),
    comparison: periodComparison,
    goal,
    nextWorkout: nextWorkoutStory(options.upcomingWorkouts ?? [], options.today),
    mainNow: main,
    orientations: usefulOrientations(summary),
  }
}

export function clientProgressPresentation(summary: PublishedTrainingSummary, options: StoryOptions = {}): ClientProgressPresentation {
  return progressStoryPresentation(summary, options)
}
