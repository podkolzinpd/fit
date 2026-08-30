import type { BodyMapData, BodyMapRegion } from './body-progress-map'

export interface BodyMapInsight {
  factId: string
  source: 'llm' | 'deterministic'
  text: string
}

function normalize(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е')
}

function wordStem(value: string): string {
  if (value.length <= 3) return value
  return value.slice(0, value.length <= 5 ? 3 : -2)
}

function subjectAnchors(region: BodyMapRegion): string[] {
  const subject = region.primaryDetail.split(/\s[·:]\s/)[0] ?? ''
  return normalize(subject)
    .split(/[^a-zа-я0-9]+/i)
    .filter((part) => part.length >= 3)
    .map(wordStem)
}

function safeLlmCandidate(candidate: string, region: BodyMapRegion): boolean {
  const text = candidate.trim()
  if (!text || text.length > 180 || text.split(/[.!?]+/).filter(Boolean).length > 2) return false
  if (/(?:нужно|следует|стоит|рекоменду|добавь|увеличь|снизь|измени|программ)/i.test(text)) return false
  const anchors = subjectAnchors(region)
  const value = normalize(region.valueLabel).replace(/\s+/g, '')
  const normalized = normalize(text)
  const matchedAnchors = anchors.filter((anchor) => normalized.includes(anchor)).length
  const requiredAnchors = Math.min(2, anchors.length)
  return Boolean(requiredAnchors > 0
    && matchedAnchors >= requiredAnchors
    && normalized.replace(/\s+/g, '').includes(value))
}

function deterministicConclusion(data: BodyMapData, region: BodyMapRegion): string {
  return data.mode === 'progress'
    ? `В зоне «${region.label}» лучший подтверждённый результат изменился на ${region.valueLabel}.`
    : `На зону «${region.label}» приходится ${region.valueLabel} всех выполненных подходов.`
}

/**
 * LLM copy is optional and never defines the highlighted zone or its value.
 * It is shown only when it names the selected exercise and repeats the exact
 * deterministic value; otherwise the map remains fully useful on fallback.
 */
export function bodyMapInsight(
  data: BodyMapData,
  region: BodyMapRegion,
  candidates: readonly string[],
): BodyMapInsight {
  const candidate = candidates.find((value) => safeLlmCandidate(value, region))
  return {
    factId: `body-map:${data.mode}:${region.group}:${region.valueLabel}`,
    source: candidate ? 'llm' : 'deterministic',
    text: candidate?.trim() ?? deterministicConclusion(data, region),
  }
}
