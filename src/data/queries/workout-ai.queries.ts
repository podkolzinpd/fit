import type { ExerciseSnapshot } from '../../shared/domain'
import type { CustomMetric } from '../../shared/domain'
import { isActiveCatalogExercise } from '../../shared/exercise-catalog-retirement'
import { yandexAppSessionTransport } from '../yandex-app-session-transport'
import { fetchWithRequestDiagnostics } from './request-diagnostics'

import type { WorkoutParseResponse } from '../../shared/workout-parse-response'
export type { WorkoutParseResponse } from '../../shared/workout-parse-response'

export type GoalCriteriaSuggestionResponse = {
  criteria: unknown[]
  needsInput: Array<{ message: string; exerciseRefs: string[] }>
  unsupportedReason: string | null
}

export const parseWorkout = (text: string, systemCatalog: readonly ExerciseSnapshot[]) => {
  const appSession = yandexAppSessionTransport()
  if (appSession) {
    return fetchWithRequestDiagnostics(globalThis.fetch, `${appSession.apiBaseUrl}/v1/assistant/yandex/parse-workout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-fit-session': appSession.sessionToken },
      body: JSON.stringify({ text, systemCatalog }),
    }).then(async (response) => response.ok
      ? { data: await response.json() as WorkoutParseResponse, error: null }
      : { data: null, error: { context: response } })
      .catch((error) => ({ data: null, error: error instanceof Error ? error : new Error('parse_workout_request_failed') }))
  }
  return Promise.resolve({ data: null, error: new Error('authentication_required') })
}

export const suggestGoalCriteria = (text: string, catalog: readonly ExerciseSnapshot[], metrics: readonly CustomMetric[]) => {
  const body = { kind: 'goal_criteria', text, systemCatalog: catalog.filter((item) => item.source === 'system' && isActiveCatalogExercise(item)), customMetrics: metrics }
  const appSession = yandexAppSessionTransport()
  if (appSession) {
    return fetchWithRequestDiagnostics(globalThis.fetch, `${appSession.apiBaseUrl}/v1/assistant/yandex/parse-workout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-fit-session': appSession.sessionToken },
      body: JSON.stringify(body),
    }).then(async (response) => response.ok
      ? { data: await response.json() as GoalCriteriaSuggestionResponse, error: null }
      : { data: null, error: { context: response } })
      .catch((error) => ({ data: null, error: error instanceof Error ? error : new Error('goal_suggestion_request_failed') }))
  }
  return Promise.resolve({ data: null, error: new Error('authentication_required') })
}
