import { summaryDiagnosticQuery } from '../queries/summary-diagnostic.queries'

export type SummaryDiagnostic = {
  fingerprint: string
  stats: { workouts: number; exercises: number; sets: number; model_input_chars: number }
  answer?: string
  issues?: string[]
}

export async function getSummaryDiagnostic(clientId: string, mode: 'preflight' | 'run_once', fingerprint?: string): Promise<SummaryDiagnostic> {
  const value = await summaryDiagnosticQuery(clientId, mode, fingerprint)
  if (!value || typeof value !== 'object' || !('diagnostic' in value) || value.diagnostic !== true || !('fingerprint' in value) || typeof value.fingerprint !== 'string' || !('stats' in value) || !value.stats || typeof value.stats !== 'object') throw new Error('Неожиданный ответ диагностики.')
  const stats = value.stats
  if (!('workouts' in stats) || typeof stats.workouts !== 'number' || !('exercises' in stats) || typeof stats.exercises !== 'number' || !('sets' in stats) || typeof stats.sets !== 'number' || !('model_input_chars' in stats) || typeof stats.model_input_chars !== 'number') throw new Error('Нет счётчиков диагностики.')
  return { fingerprint: value.fingerprint, stats: { workouts: stats.workouts, exercises: stats.exercises, sets: stats.sets, model_input_chars: stats.model_input_chars },
    ...('answer' in value && typeof value.answer === 'string' ? { answer: value.answer } : {}),
    ...('issues' in value && Array.isArray(value.issues) ? { issues: value.issues.filter((item): item is string => typeof item === 'string') } : {}),
  }
}
