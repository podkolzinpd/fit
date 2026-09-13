import { supabase } from './client'

// Incident-only transport: intentionally unavailable to migrated Yandex sessions.
export async function summaryDiagnosticQuery(clientId: string, mode: 'preflight' | 'run_once', fingerprint?: string): Promise<unknown> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Нужен вход тестового клиента через Supabase.')
  const response = await fetch('https://functions.yandexcloud.net/d4eq75uad5lps1chbidk', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-supabase-authorization': `Bearer ${session.access_token}` },
    body: JSON.stringify({ client_id: clientId, period_start: '2026-08-12', period_end: '2026-09-11', diagnostic: mode, diagnostic_fingerprint: fingerprint }),
    signal: AbortSignal.timeout(60000),
  })
  if (!response.ok) throw new Error(`Диагностика не завершена (HTTP ${response.status}). Платный запрос не повторяйте.`)
  return response.json() as Promise<unknown>
}
