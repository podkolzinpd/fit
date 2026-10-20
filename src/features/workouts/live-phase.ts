import type { LiveSetDraft, WorkoutExecutionMode, WorkoutSet } from '../../shared/domain'

export const WORKOUT_PREP_OPTIONS = [0, 10, 15, 20, 30, 45, 60, 90, 120] as const

export function formatPrepOption(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes === 0) return `${rest} сек`
  return rest === 0 ? `${minutes} мин` : `${minutes} мин ${rest} сек`
}

/** Подготовка и подход; отдых живёт в отдельном restEndsAt, фазы никогда не идут одновременно. */
export type LivePhaseTimer =
  | { kind: 'prep'; startedAt: number; endsAt: number }
  // manual — подход в режиме «Веду сам»: таймер только отсчитывает, на нуле
  // даёт сигнал и считает дальше в плюс, засчитывает подход человек.
  | { kind: 'work'; setId: string; startedAt: number; endsAt: number; manual?: true }

/**
 * Плановая длительность подхода для режима «Ведёт таймер» (YAFIT-627): любой
 * неподтверждённый подход со временем в плане — на время, повторы, дистанция.
 * null — времени нет, такой подход человек подтверждает сам.
 */
export function timedSetSeconds(set: Pick<WorkoutSet, 'durationSec' | 'durationMin' | 'confirmedAt'>): number | null {
  if (set.confirmedAt) return null
  const seconds = set.durationSec ?? (set.durationMin === undefined ? undefined : Math.round(set.durationMin * 60))
  return seconds !== undefined && seconds > 0 ? seconds : null
}

/**
 * Засчитанный на нуле подход требует проверки, только если таймер подставил
 * из плана то, чего он не измеряет: повторы, вес или дистанцию. Подход только
 * на время таймер измерил сам — лишнее «Подтвердить» приучило бы жать не глядя.
 */
export function timerAssumesPlannedValues(draft: Pick<LiveSetDraft, 'reps' | 'weightKg' | 'distanceKm'>): boolean {
  return [draft.reps, draft.weightKg, draft.distanceKm].some((value) => value !== undefined && value !== null)
}

/** Новая тренировка по умолчанию ведётся человеком; «Ведёт таймер» включают явно в конструкторе или в Live. */
export const DEFAULT_EXECUTION_MODE: WorkoutExecutionMode = 'manual'

/** Действующий режим Live: выбор в этой сессии, затем режим тренировки; старые тренировки — «manual». */
export function effectiveExecutionMode(workoutMode: WorkoutExecutionMode | undefined, sessionOverride: WorkoutExecutionMode | null): WorkoutExecutionMode {
  return sessionOverride ?? workoutMode ?? 'manual'
}

export const EXECUTION_MODE_LABELS: Record<WorkoutExecutionMode, string> = {
  timer: 'Ведёт таймер',
  manual: 'Веду сам',
}

/** Фактическое время подхода по таймеру: не меньше секунды и не больше плана — таймер останавливается на нуле. */
export function elapsedWorkSeconds(timer: { startedAt: number; endsAt: number }, now: number): number {
  const planned = Math.round((timer.endsAt - timer.startedAt) / 1000)
  const elapsed = Math.round((Math.min(now, timer.endsAt) - timer.startedAt) / 1000)
  return Math.max(1, Math.min(planned, elapsed))
}

/** Фактическое время подхода, который ведёт человек: без потолка — после нуля счёт идёт в плюс. */
export function personWorkSeconds(timer: { startedAt: number }, now: number): number {
  return Math.max(1, Math.round((now - timer.startedAt) / 1000))
}

/** Повторное нажатие сразу после «Старт» — случайное, а не конец подхода. */
export const PERSON_WORK_FINISH_GUARD_MS = 2000

export type LivePhasePrimaryAction = 'skip-prep' | 'confirm-work' | 'stop-rest' | 'clear-rest' | 'start-work' | 'open-settings'

/** Короткое нажатие — следующее логичное действие для текущей фазы. */
export function livePhasePrimaryAction(state: {
  phase: LivePhaseTimer | null
  restEndsAt: number | null
  now: number
  currentSetTimed: boolean
}): LivePhasePrimaryAction {
  if (state.phase?.kind === 'prep') return 'skip-prep'
  if (state.phase?.kind === 'work') return 'confirm-work'
  if (state.restEndsAt !== null) return state.now < state.restEndsAt ? 'stop-rest' : 'clear-rest'
  return state.currentSetTimed ? 'start-work' : 'open-settings'
}

const phaseKey = (workoutId: string) => `fit:live-phase:${workoutId}`
const modeKey = (workoutId: string) => `fit:live-execution-mode:${workoutId}`
const autostartKey = (workoutId: string) => `fit:live-autostart:${workoutId}`

function isPhase(value: unknown): value is LivePhaseTimer {
  if (!value || typeof value !== 'object') return false
  const phase = value as Partial<LivePhaseTimer> & { setId?: unknown }
  const times = typeof phase.startedAt === 'number' && typeof phase.endsAt === 'number' && phase.endsAt > phase.startedAt
  return times && (phase.kind === 'prep' || (phase.kind === 'work' && typeof phase.setId === 'string'))
}

// Как и отдых — краткоживущее состояние одной live-сессии: переживает навигацию
// и reload WebView, но не возвращает старый таймер в следующую сессию.
export function restoreLivePhase(workoutId: string): LivePhaseTimer | null {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(phaseKey(workoutId)) ?? 'null')
    return isPhase(parsed) ? parsed : null
  } catch { return null }
}

export function storeLivePhase(workoutId: string, phase: LivePhaseTimer | null) {
  try {
    if (phase === null) sessionStorage.removeItem(phaseKey(workoutId))
    else sessionStorage.setItem(phaseKey(workoutId), JSON.stringify(phase))
  } catch { /* The timer keeps working for the current screen without storage. */ }
}

// Режим, выбранный прямо в Live, живёт до конца этой сессии тренировки и не
// меняет сохранённую тренировку.
export function restoreLiveExecutionMode(workoutId: string): WorkoutExecutionMode | null {
  try {
    const value = sessionStorage.getItem(modeKey(workoutId))
    return value === 'timer' || value === 'manual' ? value : null
  } catch { return null }
}

export function storeLiveExecutionMode(workoutId: string, mode: WorkoutExecutionMode) {
  try { sessionStorage.setItem(modeKey(workoutId), mode) } catch { /* Выбор действует до перезагрузки экрана. */ }
}

/** Автостарт (подготовка или первый подход) происходит один раз за тренировку, а не при каждом входе в Live. */
export function claimLiveAutostart(workoutId: string): boolean {
  try {
    if (localStorage.getItem(autostartKey(workoutId)) === '1') return false
    localStorage.setItem(autostartKey(workoutId), '1')
    return true
  } catch { return false }
}
