import type { PublishedTrainingSummary, TrainingSummary } from '../../shared/domain'
import { formatSummaryText } from './summary-format'

export type ProgressDetailedAnalysisSectionId = 'result' | 'goal' | 'attention'

export type ProgressDetailedAnalysisSection = {
  id: ProgressDetailedAnalysisSectionId
  title: string
  items: string[]
  emptyMessage: string
}

type ProgressSummary = PublishedTrainingSummary | TrainingSummary

type BuildProgressDetailedAnalysisOptions = {
  summary: ProgressSummary
  role: 'client' | 'trainer'
  goalTitle?: string | null
  visibleTexts: readonly string[]
}

const CLIENT_UNSAFE = /(?:риск|провер(?:ить|ка)|уточн(?:ить|ение)|тренер(?:у|ом|а)?|необходимо увеличить|следует повысить|корректировать программу)/iu
const LOW_VALUE = /(?:служебн|показатель равен|продолжать отслеживать|поддерживать регулярность|на верном пути)/iu
const STOP_WORDS = new Set(['этот', 'этого', 'этом', 'после', 'перед', 'между', 'когда', 'котор', 'только', 'пока', 'данн'])

function normalized(value: string): string {
  return value
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[^а-яa-z0-9%]+/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function numbers(value: string): string[] {
  return value.match(/\d+(?:[.,]\d+)?/gu)?.map((item) => item.replace('.', ',')) ?? []
}

function words(value: string): Set<string> {
  return new Set(normalized(value).split(' ')
    .filter((word) => word.length >= 4 && !/^\d/u.test(word) && !STOP_WORDS.has(word.slice(0, 5)))
    .map((word) => word.slice(0, 5)))
}

function sameFact(candidate: string, visible: string): boolean {
  const left = normalized(candidate)
  const right = normalized(visible)
  if (!left || !right) return false
  if (left === right) return true
  if (Math.min(left.length, right.length) >= 32 && (left.includes(right) || right.includes(left))) return true

  const leftWords = words(candidate)
  const rightWords = words(visible)
  const denominator = Math.min(leftWords.size, rightWords.size)
  if (denominator === 0) return false
  const shared = [...leftWords].filter((word) => rightWords.has(word)).length
  const leftNumbers = numbers(candidate)
  if (leftNumbers.length === 0) return denominator >= 3 && shared / denominator >= 0.75
  if (!leftNumbers.every((value) => numbers(visible).includes(value))) return false
  return shared / denominator >= 0.5
}

function concise(value: string): string | null {
  const formatted = formatSummaryText(value)
    .replace(/^[\s•*-]+/u, '')
    .replace(/[*_`#]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!formatted || LOW_VALUE.test(formatted)) return null
  const sentences = formatted.match(/[^.!?]+[.!?]?/gu)?.map((item) => item.trim()).filter(Boolean) ?? []
  const result = sentences.slice(0, 2).join(' ')
  return result.length > 0 && result.length <= 280 ? result : null
}

function exerciseAnchors(summary: ProgressSummary): string[] {
  return summary.metrics.progressFacts
    .flatMap((fact) => fact.exerciseName.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').split(/[^а-яa-z0-9]+/u))
    .filter((word) => word.length >= 4)
    .map((word) => word.slice(0, 4))
}

function knownNumbers(summary: ProgressSummary, visibleTexts: readonly string[]): Set<string> {
  const numericValues = [
    summary.metrics.completedWorkouts,
    summary.metrics.workoutsPerWeek,
    summary.metrics.activeWeeks,
    summary.metrics.longestGapDays,
    ...summary.metrics.progressFacts.flatMap((fact) => [
      fact.sessionCount,
      ...fact.changes.flatMap((change) => [change.from, change.to, change.changePercent]),
    ]),
  ].filter((value): value is number => value !== null)
  return new Set([
    ...visibleTexts.flatMap(numbers),
    ...numericValues.flatMap((value) => numbers(`${value} ${formatSummaryText(String(value))}`)),
  ])
}

function groundedNumbers(value: string, allowedNumbers: ReadonlySet<string>): boolean {
  return numbers(value).every((item) => allowedNumbers.has(item))
}

function groundedResult(value: string, summary: ProgressSummary, allowedNumbers: ReadonlySet<string>): boolean {
  if (numbers(value).length === 0 || !groundedNumbers(value, allowedNumbers)) return false
  const anchors = exerciseAnchors(summary)
  if (anchors.length === 0) return true
  const text = normalized(value)
  return anchors.some((anchor) => text.includes(anchor))
}

function uniqueItems(
  values: readonly string[],
  visibleTexts: readonly string[],
  role: 'client' | 'trainer',
  validate: (value: string) => boolean,
  limit: number,
): string[] {
  const accepted: string[] = []
  for (const raw of values) {
    const value = concise(raw)
    if (!value || !validate(value) || (role === 'client' && CLIENT_UNSAFE.test(value))) continue
    if ([...visibleTexts, ...accepted].some((visible) => sameFact(value, visible))) continue
    accepted.push(value)
    if (accepted.length === limit) break
  }
  return accepted
}

export function buildProgressDetailedAnalysis({ summary, role, goalTitle, visibleTexts }: BuildProgressDetailedAnalysisOptions): ProgressDetailedAnalysisSection[] {
  const client = 'summary' in summary ? summary.summary : summary.client
  const resultCopy = 'summary' in summary || role === 'client'
    ? [client.headline, ...client.achievements]
    : [summary.trainer.headline, ...summary.trainer.progress]
  const attentionCopy = 'summary' in summary || role === 'client'
    ? [client.consistency, ...(client.nextSteps ?? [])]
    : [summary.trainer.consistency, ...(client.nextSteps ?? [])]
  const goalCopy = goalTitle?.trim() && client.goalAlignment?.trim() ? [client.goalAlignment] : []
  const allowedNumbers = knownNumbers(summary, [...visibleTexts, goalTitle ?? ''])

  return [
    {
      id: 'result',
      title: 'Результат периода',
      items: uniqueItems(resultCopy, visibleTexts, role, (value) => groundedResult(value, summary, allowedNumbers), 2),
      emptyMessage: 'Все подтверждённые результаты уже показаны в карточках выше.',
    },
    {
      id: 'goal',
      title: 'Связь с целью',
      items: uniqueItems(goalCopy, visibleTexts, role, (value) => groundedNumbers(value, allowedNumbers), 1),
      emptyMessage: goalTitle?.trim()
        ? 'Дополнительной подтверждённой связи с целью нет.'
        : 'Цель не настроена, поэтому отдельная интерпретация не добавлена.',
    },
    {
      id: 'attention',
      title: 'На что обратить внимание',
      items: uniqueItems(attentionCopy, visibleTexts, role, (value) => groundedNumbers(value, allowedNumbers) && (numbers(value).length > 0 || exerciseAnchors(summary).some((anchor) => normalized(value).includes(anchor))), 2),
      emptyMessage: 'Дополнительных наблюдений за период нет.',
    },
  ]
}
