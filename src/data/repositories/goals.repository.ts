import type { ClientGoal, GoalCriterion, GoalStage, SaveClientGoalInput, SaveGoalStageInput } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { goalsQueries } from '../queries/goals.queries'
import { repositoryError } from './error'

type RawStage = {
  id: string; goalId: string; title: string; startsOn: string; endsOn: string; position: number; version: number
}
type RawGoal = {
  id: string; clientId: string; title: string; targetDate: string | null
  status: 'active' | 'archived'; version: number; stages: RawStage[]; criteria?: RawCriterion[]
}
type RawCriterion = {
  id: string; goalId: string; metric: GoalCriterion['metric']; operation: GoalCriterion['operation']
  targetValue: number | null; rangeMin: number | null; rangeMax: number | null; unit: string
  baselineValue?: number | null; baselineRecordedOn?: string | null
  secondaryTargetValue?: number | null; secondaryUnit?: string | null
  exerciseSource?: GoalCriterion['exerciseSource']; exerciseRef?: string | null; exerciseName?: string | null
  customExerciseId?: string | null; customMetricId?: string | null; customMetricName?: string | null
  regularityPeriod?: GoalCriterion['regularityPeriod']; regularityMode?: GoalCriterion['regularityMode']
  confirmationStatus: GoalCriterion['confirmationStatus']; position: number; version: number
}

function toStage(raw: RawStage): GoalStage {
  return {
    id: raw.id, goalId: raw.goalId, title: raw.title,
    startsOn: localDate(raw.startsOn), endsOn: localDate(raw.endsOn),
    position: raw.position, version: raw.version,
  }
}

function toCriterion(raw: RawCriterion): GoalCriterion {
  return {
    id: raw.id, goalId: raw.goalId, metric: raw.metric, operation: raw.operation,
    targetValue: raw.targetValue, rangeMin: raw.rangeMin, rangeMax: raw.rangeMax,
    unit: raw.unit, baselineValue: raw.baselineValue ?? null,
    baselineRecordedOn: raw.baselineRecordedOn ? localDate(raw.baselineRecordedOn) : null,
    secondaryTargetValue: raw.secondaryTargetValue ?? null, secondaryUnit: raw.secondaryUnit ?? null,
    exerciseSource: raw.exerciseSource ?? null, exerciseRef: raw.exerciseRef ?? null,
    exerciseName: raw.exerciseName ?? null, customExerciseId: raw.customExerciseId ?? null,
    customMetricId: raw.customMetricId ?? null, customMetricName: raw.customMetricName ?? null,
    regularityPeriod: raw.regularityPeriod ?? null, regularityMode: raw.regularityMode ?? null,
    confirmationStatus: raw.confirmationStatus,
    position: raw.position, version: raw.version,
  }
}

function toGoal(raw: RawGoal): ClientGoal {
  return {
    id: raw.id, clientId: raw.clientId, title: raw.title,
    targetDate: raw.targetDate === null ? null : localDate(raw.targetDate),
    status: raw.status, version: raw.version,
    stages: (raw.stages ?? []).map(toStage),
    criteria: (raw.criteria ?? []).map(toCriterion),
  }
}

export const goalsRepository = {
  async get(clientId: string): Promise<ClientGoal | null> {
    const result = await goalsQueries.get(clientId)
    if (result.error) throw repositoryError(result.error)
    return result.data ? toGoal(result.data as RawGoal) : null
  },
  async save(input: SaveClientGoalInput): Promise<string> {
    const result = await goalsQueries.save(input)
    if (result.error) throw repositoryError(result.error)
    return result.data as string
  },
  async archive(goalId: string, version: number): Promise<void> {
    const result = await goalsQueries.archive(goalId, version)
    if (result.error) throw repositoryError(result.error)
  },
  async saveStage(input: SaveGoalStageInput): Promise<string> {
    const result = await goalsQueries.saveStage(input)
    if (result.error) throw repositoryError(result.error)
    return result.data as string
  },
  async deleteStage(stageId: string): Promise<void> {
    const result = await goalsQueries.deleteStage(stageId)
    if (result.error) throw repositoryError(result.error)
  },
}
