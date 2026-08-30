import type { ClientProgressPresentation } from './client-progress-presentation'

export type ProgressNextStepAction =
  | 'add_measurement'
  | 'schedule_workout'
  | 'continue_rhythm'
  | 'clarify_criterion'
  | 'check_metric'
  | 'open_workout'
  | 'discuss_with_trainer'

export type ProgressNextStepCandidate = {
  id: string
  action: ProgressNextStepAction
  title: string
  explanation: string
  evidence: string
  actionLabel?: string
  targetId?: string
  priority: number
  anchors: string[]
}

export type ProgressNextStepRecommendation = ProgressNextStepCandidate & {
  source: 'llm' | 'deterministic' | 'user'
}

export type ProgressNextStepResult = {
  recommendation: ProgressNextStepRecommendation
  alternatives: ProgressNextStepCandidate[]
}

export type ProgressNextStepInput = {
  goal?: ClientProgressPresentation['goal']
  nextWorkout?: ClientProgressPresentation['nextWorkout']
  completedWorkouts: number
  activeWeeks: number
  totalWeeks: number
  llmSuggestions?: readonly string[]
  role: 'client' | 'trainer'
}

const unsafeRecommendation = /(?:увелич(?:ить|ивай)|сниз(?:ить|ь)|измени(?:ть| программу)|скорректир|назнач|диагноз|калори|боль|травм|необходимо|следует)/iu

const actionPatterns: Record<ProgressNextStepAction, RegExp[]> = {
  add_measurement: [/замер/iu, /измер/iu, /собрат[ь\s]+данн/iu],
  schedule_workout: [/заплан/iu, /расписан/iu, /добавить трениров/iu],
  continue_rhythm: [/ритм/iu, /регуляр/iu, /частот/iu],
  clarify_criterion: [/критери/iu, /формулировк.*цел/iu, /ориентир/iu],
  check_metric: [/сравн/iu, /отслед/iu, /показател/iu, /результат/iu],
  open_workout: [/ближайш.*тренир/iu, /следующ.*тренир/iu, /открыть.*тренир/iu],
  discuss_with_trainer: [/обсуд/iu, /тренер/iu],
}

function normalize(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()
}

function words(value: string): string[] {
  return normalize(value).split(/[^а-яa-z0-9]+/u).filter((word) => word.length >= 4)
}

function numbers(value: string): string[] {
  return normalize(value).match(/\d+(?:[.,]\d+)?/gu)?.map((item) => item.replace('.', ',')) ?? []
}

function safeLlmSuggestion(value: string, allowedNumbers: ReadonlySet<string>): string | null {
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text || text.length > 180 || unsafeRecommendation.test(text)) return null
  if (text.split(/[.!?]+/u).filter(Boolean).length > 2) return null
  const textNumbers = numbers(text)
  if (textNumbers.some((item) => !allowedNumbers.has(item))) return null
  return text
}

function matchScore(candidate: ProgressNextStepCandidate, text: string): number {
  const normalized = normalize(text)
  const patternScore = actionPatterns[candidate.action]
    .reduce((score, pattern) => score + (pattern.test(normalized) ? 4 : 0), 0)
  const anchorScore = candidate.anchors
    .flatMap(words)
    .filter((anchor, index, anchors) => anchors.indexOf(anchor) === index)
    .reduce((score, anchor) => score + (normalized.includes(anchor) ? 1 : 0), 0)
  return patternScore + Math.min(anchorScore, 3)
}

function candidate(
  value: Omit<ProgressNextStepCandidate, 'anchors'> & { anchors?: string[] },
): ProgressNextStepCandidate {
  return { ...value, anchors: value.anchors ?? [value.title, value.evidence] }
}

function goalCandidates(input: ProgressNextStepInput): ProgressNextStepCandidate[] {
  const goal = input.goal
  if (!goal) return [candidate({
    id: 'clarify-criterion:no-goal', action: 'clarify_criterion', priority: 122,
    title: input.role === 'client' ? 'Сформулировать цель и критерий' : 'Уточнить цель и критерий клиента',
    explanation: 'Без подтверждённого критерия следующий результат нельзя честно связать с целью.',
    evidence: 'Измеримый критерий пока не настроен', actionLabel: 'Открыть цель',
  })]
  if (goal.state === 'unconfigured' || goal.state === 'needs_review') return [candidate({
    id: `clarify-criterion:${goal.state}`, action: 'clarify_criterion', priority: 121,
    title: goal.state === 'needs_review' ? 'Проверить критерий цели' : 'Настроить критерий цели',
    explanation: goal.state === 'needs_review'
      ? 'Формулировка цели изменилась, поэтому критерий нужно подтвердить заново.'
      : 'Цель сохранена как текст и пока не связана с проверяемым показателем.',
    evidence: goal.title, actionLabel: 'Открыть цель', anchors: [goal.title, goal.criterionLabel ?? ''],
  })]
  const primary = goal.criteria?.[0]
  if (primary?.action === 'measurement') return [candidate({
    id: `add-measurement:${primary.id}`, action: 'add_measurement', priority: 116,
    title: `Добавить замер · ${primary.label}`,
    explanation: 'Новый результат нужен, чтобы обновить положение относительно ориентира.',
    evidence: `${primary.freshness} · ${primary.sufficiency}`, actionLabel: 'Добавить замер',
    anchors: [goal.title, primary.label],
  })]
  if (primary?.action === 'workout') return []
  if (!primary) return []
  return [candidate({
    id: `check-metric:${primary.id}`, action: 'check_metric', priority: 96,
    title: `Проверить показатель · ${primary.label}`,
    explanation: 'Так следующий подтверждённый результат можно будет сопоставить с ориентиром цели.',
    evidence: `${primary.current} · ${primary.status}`, actionLabel: 'Открыть показатель',
    anchors: [goal.title, primary.label, primary.current, primary.target],
  })]
}

function workoutCandidates(input: ProgressNextStepInput): ProgressNextStepCandidate[] {
  if (input.nextWorkout) return [candidate({
    id: `open-workout:${input.nextWorkout.id}`, action: 'open_workout', priority: 92,
    title: `Открыть ближайшую тренировку · ${input.nextWorkout.date}`,
    explanation: 'План уже создан, поэтому следующий конкретный шаг доступен без изменения программы.',
    evidence: input.nextWorkout.title, actionLabel: 'Открыть тренировку',
    targetId: input.nextWorkout.id,
    anchors: [input.nextWorkout.title, ...input.nextWorkout.exercises.map((exercise) => exercise.name)],
  })]
  return [candidate({
    id: 'schedule-workout:no-plan', action: 'schedule_workout', priority: 88,
    title: 'Запланировать ближайшую тренировку',
    explanation: 'В ближайшие 45 дней нет плана, с которым можно связать следующий результат.',
    evidence: 'Ближайшая тренировка не запланирована', actionLabel: 'Открыть планирование',
  })]
}

function regularityCandidates(input: ProgressNextStepInput): ProgressNextStepCandidate[] {
  if (input.completedWorkouts <= 0) return []
  return [candidate({
    id: `continue-rhythm:${input.completedWorkouts}:${input.activeWeeks}:${input.totalWeeks}`,
    action: 'continue_rhythm', priority: 72,
    title: 'Продолжить текущий тренировочный ритм',
    explanation: 'Этот шаг не меняет план и сохраняет наблюдаемую последовательность тренировок.',
    evidence: `${input.completedWorkouts} тренировок · ${input.activeWeeks} из ${input.totalWeeks} активных недель`,
    actionLabel: 'Открыть тренировки', anchors: ['ритм', 'тренировки', 'активные недели'],
  })]
}

function discussionCandidates(input: ProgressNextStepInput): ProgressNextStepCandidate[] {
  if (!input.goal || input.goal.state !== 'configured') return []
  return [candidate({
    id: `discuss:${input.goal.title}`, action: 'discuss_with_trainer', priority: 48,
    title: input.role === 'client' ? 'Обсудить вывод с тренером' : 'Обсудить вывод с клиентом',
    explanation: 'Можно сначала сверить смысл рекомендации, не меняя цель или план автоматически.',
    evidence: input.goal.title, anchors: [input.goal.title, 'тренер', 'обсудить'],
  })]
}

export function buildProgressNextStep(input: ProgressNextStepInput): ProgressNextStepResult {
  const candidates = [
    ...goalCandidates(input),
    ...workoutCandidates(input),
    ...regularityCandidates(input),
    ...discussionCandidates(input),
  ].sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))
  const fallback = candidates[0]!
  const allowedNumbers = new Set(candidates.flatMap((item) => numbers(`${item.title} ${item.explanation} ${item.evidence}`)))
  const matches = (input.llmSuggestions ?? []).flatMap((raw, suggestionIndex) => {
    const text = safeLlmSuggestion(raw, allowedNumbers)
    if (!text) return []
    return candidates.map((item) => ({ item, text, suggestionIndex, score: matchScore(item, text) }))
      .filter((item) => item.score >= 4)
  }).sort((left, right) =>
    left.suggestionIndex - right.suggestionIndex || right.score - left.score || right.item.priority - left.item.priority)
  const llm = matches[0]
  const criticalFallback = fallback.priority >= 110 && llm?.item.action !== fallback.action
  const selected = criticalFallback || !llm ? fallback : llm.item
  return {
    recommendation: {
      ...selected,
      ...(llm && selected === llm.item ? { title: llm.text, source: 'llm' as const } : { source: 'deterministic' as const }),
    },
    alternatives: candidates.filter((item) => item.id !== selected.id),
  }
}
