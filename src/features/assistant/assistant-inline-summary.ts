export type AssistantInlineSummary = {
  summaryId: string
  clientId: string
  clientName: string
  periodStart: string
  periodEnd: string
  periodLabel: string
  trainer: {
    headline: string
    progress: string[]
    consistency: string
    attention: string[]
  }
  metrics: {
    completedWorkouts: number
    workoutsPerWeek: number
    activeWeeks: number
  }
  saved?: boolean
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(nonBlank)
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function parseAssistantInlineSummary(value: unknown): AssistantInlineSummary | undefined {
  const item = record(value)
  const trainer = record(item?.trainer)
  const metrics = record(item?.metrics)
  if (
    item?.status !== 'applied' ||
    !nonBlank(item.summaryId) || !nonBlank(item.clientId) || !nonBlank(item.clientName) ||
    !nonBlank(item.periodStart) || !nonBlank(item.periodEnd) || !nonBlank(item.periodLabel) ||
    !trainer || !metrics || !nonBlank(trainer.headline) || !stringList(trainer.progress) ||
    !nonBlank(trainer.consistency) || !stringList(trainer.attention) ||
    !finiteNumber(metrics.completedWorkouts) || !finiteNumber(metrics.workoutsPerWeek) || !finiteNumber(metrics.activeWeeks)
  ) return undefined
  return {
    summaryId: item.summaryId,
    clientId: item.clientId,
    clientName: item.clientName,
    periodStart: item.periodStart,
    periodEnd: item.periodEnd,
    periodLabel: item.periodLabel,
    trainer: {
      headline: trainer.headline,
      progress: trainer.progress,
      consistency: trainer.consistency,
      attention: trainer.attention,
    },
    metrics: {
      completedWorkouts: metrics.completedWorkouts,
      workoutsPerWeek: metrics.workoutsPerWeek,
      activeWeeks: metrics.activeWeeks,
    },
    ...(typeof item.saved === 'boolean' ? { saved: item.saved } : {}),
  }
}
