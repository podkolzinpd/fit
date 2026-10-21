import type { TrainingGoalContext } from '../../legacy-summary/summary-goal.js'
import type { ProgramHistoryContext } from './context.js'

export type ProgramSourceSnapshot = {
  fingerprint: string
  context: ProgramHistoryContext
  capturedAt: string
  profile: {
    ageYears: number | null
    goal: TrainingGoalContext
    latestWeight: { date: string; weightKg: number | null } | null
  }
  plannedWorkouts: { id: string; date: string }[]
}
