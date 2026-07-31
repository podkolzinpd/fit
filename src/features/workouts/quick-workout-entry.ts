import type { ExerciseSnapshot, WorkoutSetDraft } from '../../shared/domain'

export interface ParsedWorkoutExercise {
  line: string
  exercise: ExerciseSnapshot
  sets: WorkoutSetDraft[]
  hasValues: boolean
}

export interface UnparsedWorkoutLine {
  line: string
  reason: 'not-found' | 'ambiguous'
  /** До четырёх наиболее близких вариантов для выбора тренером одним тапом. */
  candidates: ExerciseSnapshot[]
}

export interface QuickWorkoutParseResult {
  parsed: ParsedWorkoutExercise[]
  unparsed: UnparsedWorkoutLine[]
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase('ru')
    .replaceAll('ё', 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

// В полном каталоге оборудование добавлено в имя в скобках, а тренер обычно
// диктует короткое базовое название. Для поиска это один и тот же вариант.
function normalizedExerciseName(value: string): string {
  return normalize(value.replace(/\s*\([^)]*\)\s*$/, ''))
}

function number(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : undefined
}

function exerciseNamePart(line: string): string {
  const metric = /\d+\s*(?:[xх×]|кг|kg|сек|мин|км|km|повт)/iu.exec(line)
  return (metric ? line.slice(0, metric.index) : line).trim()
}

function matchingExercises(name: string, catalog: readonly ExerciseSnapshot[]): ExerciseSnapshot[] {
  const query = normalize(name)
  if (!query) return []
  const tokens = query.split(' ')
  const exact = catalog.filter((exercise) => normalizedExerciseName(exercise.name) === query)
  if (exact.length === 1) return exact
  // Своё упражнение иногда повторяет системное по имени. Для записи без явного
  // уточнения берём единственный встроенный вариант: его тип ввода стабилен.
  // Несколько системных совпадений по-прежнему считаем неоднозначностью.
  const exactSystem = exact.filter((exercise) => exercise.source === 'system')
  if (exactSystem.length === 1) return exactSystem
  // Одно короткое слово («присед») почти всегда скрывает вариацию. Не делаем
  // вид, что знаем намерение тренера: точные «Планка»/«Бег» уже прошли exact.
  if (query.split(' ').length < 2) {
    return catalog.filter((exercise) => normalizedExerciseName(exercise.name).includes(query))
  }
  return catalog.filter((exercise) => {
    const candidate = normalizedExerciseName(exercise.name)
    return tokens.every((token) => candidate.includes(token))
  })
}

function needsTrainerChoice(name: string, catalog: readonly ExerciseSnapshot[]): boolean {
  const query = normalize(name)
  if (query.split(' ').length >= 2) return false
  return !catalog.some((exercise) => normalizedExerciseName(exercise.name) === query)
}

function setDrafts(line: string, inputKind: ExerciseSnapshot['inputKind']): { sets: WorkoutSetDraft[]; hasValues: boolean } {
  const setMatch = /(\d+)\s*[xх×]\s*(\d+(?:[.,]\d+)?)\s*(сек|с|мин|м)?\b/iu.exec(line)
  const count = setMatch ? Number(setMatch[1]) : 1
  const repeatedValue = number(setMatch?.[2])
  const repeatedUnit = setMatch?.[3]?.toLocaleLowerCase('ru')
  const weight = number(/(\d+(?:[.,]\d+)?)\s*(?:кг|kg)/iu.exec(line)?.[1])
  const durationMatch = /(\d+(?:[.,]\d+)?)\s*(сек|с|мин|м)/iu.exec(line)
  const durationValue = number(durationMatch?.[1])
  const durationUnit = durationMatch?.[2]?.toLocaleLowerCase('ru')
  const durationSec = repeatedUnit
    ? repeatedValue! * (repeatedUnit.startsWith('м') ? 60 : 1)
    : durationValue === undefined ? undefined : durationValue * (durationUnit?.startsWith('м') ? 60 : 1)
  const distanceKm = number(/(\d+(?:[.,]\d+)?)\s*(?:км|km)/iu.exec(line)?.[1])
  const explicitReps = number(/(\d+)\s*(?:повт|повтор)/iu.exec(line)?.[1])
  const reps = repeatedUnit ? explicitReps : repeatedValue
  const hasValues = weight !== undefined || reps !== undefined || durationSec !== undefined || distanceKm !== undefined
  return {
    hasValues,
    sets: Array.from({ length: Math.min(Math.max(count, 1), 20) }, (_, position) => ({
      position,
      ...(inputKind === 'strength' && weight !== undefined ? { weightKg: weight } : {}),
      ...(inputKind === 'strength' && reps !== undefined ? { reps } : {}),
      ...(inputKind === 'reps' && durationSec !== undefined ? { durationSec } : {}),
      ...(inputKind === 'reps' && reps !== undefined ? { reps } : {}),
      ...(inputKind === 'duration' && durationSec !== undefined ? { durationSec } : {}),
      ...(inputKind === 'distance' && durationSec !== undefined ? { durationSec } : {}),
      ...(inputKind === 'distance' && distanceKm !== undefined ? { distanceKm } : {}),
    })),
  }
}

export function resolveQuickWorkoutLine(line: string, exercise: ExerciseSnapshot): ParsedWorkoutExercise {
  const values = setDrafts(line, exercise.inputKind)
  return { line, exercise, ...values }
}

/**
 * Строгий локальный разбор записи тренера. Он не угадывает похожие упражнения:
 * неуверенную строку возвращаем в unparsed, чтобы не записать факт не тому движению.
 */
export function parseQuickWorkoutEntry(text: string, catalog: readonly ExerciseSnapshot[]): QuickWorkoutParseResult {
  const parsed: ParsedWorkoutExercise[] = []
  const unparsed: UnparsedWorkoutLine[] = []
  for (const rawLine of text.split(/[\n;]/)) {
    const line = rawLine.trim()
    if (!line) continue
    const name = exerciseNamePart(line)
    const matches = matchingExercises(name, catalog)
    if (needsTrainerChoice(name, catalog) || matches.length !== 1) {
      unparsed.push({ line, reason: matches.length ? 'ambiguous' : 'not-found', candidates: matches.slice(0, 4) })
      continue
    }
    parsed.push(resolveQuickWorkoutLine(line, matches[0]!))
  }
  return { parsed, unparsed }
}
