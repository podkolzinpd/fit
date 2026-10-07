import type { WorkoutExercise, WorkoutSet } from '../../shared/domain'

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
  | { kind: 'work'; setId: string; startedAt: number; endsAt: number }

/**
 * Плановая длительность подхода с таймером: на время или на повторы со
 * временем в плане. null — таймера нет (силовые, дистанция, нет времени в плане).
 */
export function timedSetSeconds(exercise: Pick<WorkoutExercise, 'inputKind'>, set: Pick<WorkoutSet, 'durationSec' | 'durationMin' | 'confirmedAt'>): number | null {
  if ((exercise.inputKind !== 'duration' && exercise.inputKind !== 'reps') || set.confirmedAt) return null
  const seconds = set.durationSec ?? (set.durationMin === undefined ? undefined : Math.round(set.durationMin * 60))
  return seconds !== undefined && seconds > 0 ? seconds : null
}

/** Фактическое время подхода по таймеру: не меньше секунды и не больше плана — таймер останавливается на нуле. */
export function elapsedWorkSeconds(timer: { startedAt: number; endsAt: number }, now: number): number {
  const planned = Math.round((timer.endsAt - timer.startedAt) / 1000)
  const elapsed = Math.round((Math.min(now, timer.endsAt) - timer.startedAt) / 1000)
  return Math.max(1, Math.min(planned, elapsed))
}

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

/** Автостарт (подготовка или первый подход) происходит один раз за тренировку, а не при каждом входе в Live. */
export function claimLiveAutostart(workoutId: string): boolean {
  try {
    if (localStorage.getItem(autostartKey(workoutId)) === '1') return false
    localStorage.setItem(autostartKey(workoutId), '1')
    return true
  } catch { return false }
}
