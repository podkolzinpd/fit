import { summaryDiagnosticQuery } from '../queries/summary-diagnostic.queries'

export type SummaryDiagnostic = {
  fingerprint?: string
  ready: boolean
  code: string
  stats: { workouts: number; exercises: number; sets: number; model_input_chars: number }
  checks?: { cache?: string; generation_enabled?: boolean; input_within_limit?: boolean; guard_decision?: string; calls_today?: number; last_failure_code?: string | null }
  requestId: string
  releaseId: string
}

export async function getSummaryDiagnostic(apiBaseUrl: string, sessionToken: string, clientId: string, periodStart: string, periodEnd: string): Promise<SummaryDiagnostic> {
  const value = await summaryDiagnosticQuery(apiBaseUrl, sessionToken, clientId, periodStart, periodEnd)
  if (!value || typeof value !== 'object' || !('diagnostic' in value) || value.diagnostic !== true || !('ready' in value) || typeof value.ready !== 'boolean' || !('code' in value) || typeof value.code !== 'string') throw new Error('Неожиданный ответ диагностики.')
  if (!('request_id' in value) || typeof value.request_id !== 'string' || !('release_id' in value) || typeof value.release_id !== 'string') throw new Error('Нет ID трассировки.')
  if (!('stats' in value)) {
    return { ready: value.ready, code: value.code, stats: { workouts: 0, exercises: 0, sets: 0, model_input_chars: 0 }, requestId: value.request_id, releaseId: value.release_id }
  }
  if (!value.stats || typeof value.stats !== 'object') throw new Error('Неожиданный ответ диагностики.')
  const stats = value.stats
  if (!('workouts' in stats) || typeof stats.workouts !== 'number' || !('exercises' in stats) || typeof stats.exercises !== 'number' || !('sets' in stats) || typeof stats.sets !== 'number' || !('model_input_chars' in stats) || typeof stats.model_input_chars !== 'number') throw new Error('Нет счётчиков диагностики.')
  return {
    ...('fingerprint' in value && typeof value.fingerprint === 'string' ? { fingerprint: value.fingerprint } : {}),
    ready: value.ready,
    code: value.code,
    stats: { workouts: stats.workouts, exercises: stats.exercises, sets: stats.sets, model_input_chars: stats.model_input_chars },
    ...('checks' in value && value.checks && typeof value.checks === 'object' ? { checks: value.checks as SummaryDiagnostic['checks'] } : {}),
    requestId: value.request_id,
    releaseId: value.release_id,
  }
}
