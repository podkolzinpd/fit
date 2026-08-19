import type { ClientTrainingSummary } from '../../shared/domain'
import { supabase } from './client'
import { toJson } from './json'

const internalColumns = 'id,client_id,period_start,period_end,trainer_summary,client_summary,display_metrics,generated_at,version'

const publishedColumns = 'id,source_summary_id,client_id,period_start,period_end,summary,display_metrics,generated_at,published_at'

export const trainingSummaryQueries = {
  firstCompletedWorkoutDate: (clientId: string) => supabase.from('workouts')
    .select('workout_date')
    .eq('client_id', clientId)
    .eq('status', 'done')
    .is('deleted_at', null)
    .order('workout_date', { ascending: true })
    .limit(1)
    .maybeSingle(),
  listInternal: (clientId: string) => supabase.from('client_training_summaries')
    .select(internalColumns)
    .eq('client_id', clientId)
    .order('period_end', { ascending: false })
    .order('generated_at', { ascending: false }),
  listPublished: (clientId: string) => supabase.from('client_published_training_summaries')
    .select(publishedColumns)
    .eq('client_id', clientId)
    .order('period_end', { ascending: false }),
  generate: async (clientId: string, periodStart: string, periodEnd: string, force: boolean) => {
    const { data: { session } } = await supabase.auth.getSession()
    return supabase.functions.invoke('summarize-client-training', {
      headers: session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : undefined,
      body: {
        client_id: clientId,
        period_start: periodStart,
        period_end: periodEnd,
        force,
      },
    })
  },
  publish: (
    summaryId: string,
    clientSummary: ClientTrainingSummary,
    expectedVersion: number,
  ) => supabase.rpc('publish_training_summary', {
    p_summary_id: summaryId,
    p_client_summary: toJson(clientSummary),
    p_expected_version: expectedVersion,
  }),
  unpublish: (summaryId: string, expectedVersion: number) =>
    supabase.rpc('unpublish_training_summary', {
      p_summary_id: summaryId,
      p_expected_version: expectedVersion,
    }),
}
