import type { Json } from '../database.types'
import type {
  ClientTrainingSummary,
  PublishedTrainingSummary,
  TrainerTrainingSummary,
  TrainingSummary,
  TrainingSummaryMetrics,
  TrainingProgressFact,
  TrainingProgressFactChange,
  TrainingProgressMetric,
  InputKind,
} from '../../shared/domain'
import { localDate } from '../../shared/local-date'

interface TrainingSummaryRow {
  id: string
  client_id: string
  period_start: string
  period_end: string
  trainer_summary: Json
  client_summary: Json
  display_metrics: Json
  generated_at: string
  version: number
}

interface PublishedTrainingSummaryRow {
  id: string
  source_summary_id: string
  client_id: string
  period_start: string
  period_end: string
  summary: Json
  display_metrics: Json
  generated_at: string
  published_at: string
}

function record(value: Json): Record<string, Json | undefined> {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('Суммаризация имеет некорректный формат')
  }
  return value
}

function stringValue(value: Json | undefined, field: string): string {
  if (typeof value !== 'string') throw new Error(`В суммаризации отсутствует поле ${field}`)
  return value
}

function stringArray(value: Json | undefined, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`В суммаризации отсутствует список ${field}`)
  }
  return value as string[]
}

function optionalString(value: Json | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function optionalStringArray(value: Json | undefined): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value as string[]
    : undefined
}

function trainerSummary(value: Json): TrainerTrainingSummary {
  const item = record(value)
  return {
    headline: stringValue(item.headline, 'headline'),
    progress: stringArray(item.progress, 'progress'),
    consistency: stringValue(item.consistency, 'consistency'),
    attention: stringArray(item.attention, 'attention'),
  }
}

function clientSummary(value: Json): ClientTrainingSummary {
  const item = record(value)
  return {
    headline: stringValue(item.headline, 'headline'),
    achievements: stringArray(item.achievements, 'achievements'),
    consistency: stringValue(item.consistency, 'consistency'),
    encouragement: stringValue(item.encouragement, 'encouragement'),
    goalAlignment: optionalString(item.goalAlignment),
    nextSteps: optionalStringArray(item.nextSteps),
    missingContext: optionalStringArray(item.missingContext),
    analysisVersion: optionalString(item.analysisVersion),
  }
}

function numericValue(value: Json | undefined): number {
  return typeof value === 'number' ? value : 0
}

const progressMetrics = new Set<TrainingProgressMetric>([
  'max_weight', 'volume', 'total_reps', 'distance', 'duration', 'pace',
])
const inputKinds = new Set<InputKind>(['strength', 'distance', 'reps', 'duration'])

function progressFactChange(value: Json): TrainingProgressFactChange | null {
  if (!value || Array.isArray(value) || typeof value !== 'object') return null
  const item = value as Record<string, Json | undefined>
  if (
    typeof item.metric !== 'string' || !progressMetrics.has(item.metric as TrainingProgressMetric) ||
    typeof item.from !== 'number' || typeof item.to !== 'number' ||
    typeof item.change_percent !== 'number' ||
    (typeof item.favorable !== 'boolean' && item.favorable !== null)
  ) return null
  return {
    metric: item.metric as TrainingProgressMetric,
    from: item.from,
    to: item.to,
    changePercent: item.change_percent,
    favorable: item.favorable,
  }
}

function progressFacts(value: Json | undefined): TrainingProgressFact[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((value): TrainingProgressFact[] => {
    if (!value || Array.isArray(value) || typeof value !== 'object') return []
    const item = value as Record<string, Json | undefined>
    const changes = Array.isArray(item.changes)
      ? item.changes.map(progressFactChange).filter((change): change is TrainingProgressFactChange => change !== null)
      : []
    if (
      typeof item.exercise_name !== 'string' || !item.exercise_name.trim() ||
      typeof item.kind !== 'string' || !inputKinds.has(item.kind as InputKind) ||
      typeof item.session_count !== 'number' || changes.length === 0
    ) return []
    return [{
      exerciseName: item.exercise_name.trim(),
      kind: item.kind as InputKind,
      sessionCount: item.session_count,
      changes,
    }]
  })
}

function metrics(value: Json): TrainingSummaryMetrics {
  const item = record(value)
  return {
    completedWorkouts: numericValue(item.completed_workouts),
    workoutsPerWeek: numericValue(item.workouts_per_week),
    activeWeeks: numericValue(item.active_weeks),
    longestGapDays: typeof item.longest_gap_days === 'number' ? item.longest_gap_days : null,
    progressFacts: progressFacts(item.progress_facts),
  }
}

export function trainingSummaryFromInternalRow(
  row: TrainingSummaryRow,
  publishedSourceIds: ReadonlySet<string>,
): TrainingSummary {
  return {
    id: row.id,
    clientId: row.client_id,
    periodStart: localDate(row.period_start),
    periodEnd: localDate(row.period_end),
    trainer: trainerSummary(row.trainer_summary),
    client: clientSummary(row.client_summary),
    metrics: metrics(row.display_metrics),
    generatedAt: row.generated_at,
    version: row.version,
    published: publishedSourceIds.has(row.id),
  }
}

export function trainingSummaryFromRow(
  row: TrainingSummaryRow,
  published: boolean,
): TrainingSummary {
  return trainingSummaryFromInternalRow(row, published ? new Set([row.id]) : new Set())
}

export function publishedTrainingSummaryFromRow(row: PublishedTrainingSummaryRow): PublishedTrainingSummary {
  return {
    id: row.id,
    sourceSummaryId: row.source_summary_id,
    clientId: row.client_id,
    periodStart: localDate(row.period_start),
    periodEnd: localDate(row.period_end),
    summary: clientSummary(row.summary),
    metrics: metrics(row.display_metrics),
    generatedAt: row.generated_at,
    publishedAt: row.published_at,
  }
}
