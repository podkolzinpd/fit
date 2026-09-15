import { isCalendarDate, type ProgramBrief } from './brief.js'
import { PROGRAM_CATALOG } from './catalog.js'
import { PROGRAM_CONTEXT_VERSION } from './context.js'

export const PROGRAM_LOAD_VERSION = 'observed-load-v1'
const dayMs = 86_400_000
const time = (date: string) => Date.parse(`${date}T00:00:00Z`)
const dateAt = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10)
function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function count(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 }

export interface ProgramLoad {
  version: typeof PROGRAM_LOAD_VERSION
  mode: 'recent' | 'starting'
  weeks: { start: string; end: string; workouts: number; catalogSets: number }[]
  lastCompletedDate: string | null
  lastCatalogDate: string | null
  daysSinceCatalogTraining: number | null
  meanWeeklyWorkouts: number
  meanWeeklyCatalogSets: number
  weeklySetCeiling: number | null
  maxSetsPerExercise: number
  rpe: number
  increments: number[]
  familiarRefs: string[]
  summary: string
}

/** Product policy, not an estimate of physiological capacity. Four complete
 * rolling seven-day windows include zero-record weeks; partial weeks are never
 * extrapolated. Only known catalog exercises with positive confirmed facts count.
 * Missing/stale records cannot establish that a person stopped training. */
export function deriveProgramLoad(brief: ProgramBrief, history: unknown, today: string): ProgramLoad {
  if (!isCalendarDate(today) || !object(history) || history.version !== PROGRAM_CONTEXT_VERSION
    || !isCalendarDate(history.periodStart) || !isCalendarDate(history.periodEnd) || history.periodEnd !== today
    || history.periodStart > today || !Array.isArray(history.loadEvidence)
    || !Array.isArray(history.exercises)) throw new Error('program_history_invalid')
  const end = time(today)
  const evidence = history.loadEvidence.map((row: unknown) => {
    if (!object(row) || !isCalendarDate(row.date) || row.date < String(history.periodStart) || row.date > today
      || !count(row.catalogSets) || !count(row.unmappedSets)) throw new Error('program_history_invalid')
    return { date: row.date, catalogSets: row.catalogSets, unmappedSets: row.unmappedSets }
  })
  const weeks = Array.from({ length: 4 }, (_, index) => {
    const start = dateAt(end - (27 - index * 7) * dayMs)
    const finish = dateAt(end - (21 - index * 7) * dayMs)
    const rows = evidence.filter((row) => row.date >= start && row.date <= finish)
    return { start, end: finish, workouts: rows.length, catalogSets: rows.reduce((sum, row) => sum + row.catalogSets, 0) }
  })
  const lastCompletedDate = evidence.map((row) => row.date).sort().at(-1) ?? null
  const lastCatalogDate = evidence.filter((row) => row.catalogSets > 0).map((row) => row.date).sort().at(-1) ?? null
  const daysSinceCatalogTraining = lastCatalogDate ? Math.round((end - time(lastCatalogDate)) / dayMs) : null
  const meanWeeklyWorkouts = weeks.reduce((sum, week) => sum + week.workouts, 0) / 4
  const meanWeeklyCatalogSets = weeks.reduce((sum, week) => sum + week.catalogSets, 0) / 4
  const fullPeriod = history.periodStart <= weeks[0]!.start
  const recent = fullPeriod && daysSinceCatalogTraining !== null && daysSinceCatalogTraining <= 14 && weeks.filter((week) => week.catalogSets > 0).length >= 3
  const incompleteCatalog = brief.historyComplete === false || evidence.some((row) => row.date >= weeks[0]!.start && row.unmappedSets > 0)
  const continuing = recent && brief.experience === 'experienced' && !incompleteCatalog
  const familiarRefs = history.exercises.flatMap((row: unknown) => object(row) && row.source === 'system'
    && typeof row.ref === 'string' && PROGRAM_CATALOG.some((exercise) => exercise.ref === row.ref)
    && Array.isArray(row.recentExecutions) && row.recentExecutions.some((execution: unknown) => object(execution)
      && Array.isArray(execution.sets) && execution.sets.some((set: unknown) => object(set)
        && (typeof set.reps === 'number' && set.reps > 0 || typeof set.durationSec === 'number' && set.durationSec > 0))) ? [row.ref] : [])
  // Sparse / unmapped data describes an incomplete record, not a full volume baseline.
  const weeklySetCeiling = recent && !incompleteCatalog ? Math.floor(meanWeeklyCatalogSets) : null
  const reason = brief.historyComplete === false ? 'Вы указали, что история записана не полностью.' : brief.experience === 'returning' ? 'В анкете указан возврат после перерыва.'
    : !fullPeriod ? 'Нет полного периода наблюдений.' : daysSinceCatalogTraining === null ? 'Нет сопоставимых подтверждённых подходов.'
    : daysSinceCatalogTraining > 14 ? `Последняя сопоставимая запись: ${lastCatalogDate}.` : !recent ? 'Недостаточно регулярно записанных тренировок.'
    : incompleteCatalog ? 'Часть упражнений не размечена для расчёта объёма.' : 'В анкете указан начальный опыт.'
  const summary = `${weeks[0]!.start}–${today}: в среднем ${Number(meanWeeklyWorkouts.toFixed(1))} завершённых тренировок и ${Number(meanWeeklyCatalogSets.toFixed(1))} сопоставимых подходов в неделю. `
    + (continuing ? 'Начальный объём ограничен записанным средним.' : `${reason} Стартовый режим: до двух подходов, усилие 6,5/10; первые две недели без повышения повторов.`)
  return { version: PROGRAM_LOAD_VERSION, mode: continuing ? 'recent' : 'starting', weeks, lastCompletedDate, lastCatalogDate,
    daysSinceCatalogTraining, meanWeeklyWorkouts, meanWeeklyCatalogSets, weeklySetCeiling,
    maxSetsPerExercise: continuing ? 3 : 2, rpe: continuing ? 7 : 6.5,
    increments: continuing ? [0, 1, 2, 2] : [0, 0, 1, 1], familiarRefs, summary }
}

export function programLoadIssues(brief: ProgramBrief, load: ProgramLoad): string[] {
  return brief.frequency && load.weeklySetCeiling !== null && brief.frequency * 5 > load.weeklySetCeiling ? ['history_volume_requires_review'] : []
}
