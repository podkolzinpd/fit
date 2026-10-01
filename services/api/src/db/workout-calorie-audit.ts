import type { QueryResultRow } from 'pg'
import type { DatabasePool } from './types.js'

interface CalorieAuditRow extends QueryResultRow {
  category: string
  total: string
  estimated: string
  missing_duration: string
  missing_weight: string
  high_kcal: string
  more_than_double_v1: string
  median_ratio: string | null
}

export interface CalorieAuditCategory {
  category: string
  total: number
  estimated: number
  missingDuration: number
  missingWeight: number
  highKcal: number | null
  moreThanDoubleV1: number | null
  medianV2ToV1: number | null
}

export interface CalorieAuditResult {
  windowDays: 30
  categories: CalorieAuditCategory[]
}

export interface StageCalorieAuditor {
  read(): Promise<CalorieAuditResult>
}

/** Aggregate-only operational comparison. No workout, user, or set ID leaves
 * the database; small cohorts suppress their magnitude statistics. */
export class DatabaseStageCalorieAuditor implements StageCalorieAuditor {
  constructor(private readonly pool: DatabasePool) {}

  async read(): Promise<CalorieAuditResult> {
    const connection = await this.pool.connect()
    try {
      const rows = await connection.query<CalorieAuditRow>(`
        with recent as (
          select workout.active_calories_kcal v1,
            workout.calorie_v2_shadow_kcal v2,
            workout.calorie_v2_shadow_reason reason,
            coalesce(workout.calorie_v2_shadow_details->'segments', '[]'::jsonb) segments
          from public.workouts workout
          where workout.status = 'done' and workout.deleted_at is null
            and workout.calorie_v2_shadow_at >= now() - interval '30 days'
        ), categorized as (
          select recent.*,
            case
              when (select count(distinct segment->>'activity')
                from jsonb_array_elements(recent.segments) segment) > 1 then 'mixed'
              when recent.segments->0->>'activity' in ('stationary-bike', 'interval-bike') then 'bike'
              when recent.segments->0->>'activity' = 'running' then 'run'
              when recent.segments->0->>'activity' in ('walking', 'interval-walking') then 'walk'
              when recent.segments->0->>'activity' in ('rowing-machine', 'interval-rowing') then 'rowing'
              when recent.segments->0->>'activity' in ('strength', 'strength-heavy', 'strength-circuit') then 'strength'
              when recent.segments->0->>'activity' = 'recovery' then 'recovery'
              else 'other'
            end category
          from recent
        )
        select category,
          count(*)::text total,
          count(*) filter (where v2 is not null)::text estimated,
          count(*) filter (where reason = 'missing_activity_duration')::text missing_duration,
          count(*) filter (where reason = 'missing_weight')::text missing_weight,
          count(*) filter (where v2 > 1000)::text high_kcal,
          count(*) filter (where v1 > 0 and v2 > 2 * v1)::text more_than_double_v1,
          round((percentile_cont(0.5) within group (
            order by v2::double precision / nullif(v1, 0)
          ) filter (where v1 > 0 and v2 is not null))::numeric, 2)::text median_ratio
        from categorized
        group by category
        order by category
      `)
      return {
        windowDays: 30,
        categories: rows.map((row) => {
          const total = Number(row.total)
          const showMagnitude = total >= 5
          return {
            category: row.category,
            total,
            estimated: Number(row.estimated),
            missingDuration: Number(row.missing_duration),
            missingWeight: Number(row.missing_weight),
            highKcal: showMagnitude ? Number(row.high_kcal) : null,
            moreThanDoubleV1: showMagnitude ? Number(row.more_than_double_v1) : null,
            medianV2ToV1: showMagnitude && row.median_ratio !== null ? Number(row.median_ratio) : null,
          }
        }),
      }
    } finally {
      connection.release()
    }
  }
}
