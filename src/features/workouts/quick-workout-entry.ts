import type { ExerciseSnapshot, WorkoutSetDraft } from '../../shared/domain'
import { isValidRpe } from '../../shared/rpe'
import { isExerciseSearchAlias, matchesExerciseSearch } from '../exercises/exercise-search'

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
  const metric = /\d+\s*(?:[xх×]|кг|kg|сек|мин|км|km|повт|на\s*\d|(?:подход(?:а|ов)?|сет(?:а|ов)?)?\s*по\s*\d)/iu.exec(line)
  return (metric ? line.slice(0, metric.index) : line).trim()
}

function matchingExercises(name: string, catalog: readonly ExerciseSnapshot[]): ExerciseSnapshot[] {
  const query = normalize(name)
  if (!query) return []
  const exact = catalog.filter((exercise) => normalizedExerciseName(exercise.name) === query)
  if (exact.length === 1) return exact
  // Своё упражнение иногда повторяет системное по имени. Для записи без явного
  // уточнения берём единственный встроенный вариант: его тип ввода стабилен.
  // Несколько системных совпадений по-прежнему считаем неоднозначностью.
  const exactSystem = exact.filter((exercise) => exercise.source === 'system')
  if (exactSystem.length === 1) return exactSystem
  const aliases = catalog.filter((exercise) => isExerciseSearchAlias(exercise, query))
  if (aliases.length === 1) return aliases
  // Одно короткое слово («присед») почти всегда скрывает вариацию. Не делаем
  // вид, что знаем намерение тренера: точные «Планка»/«Бег» уже прошли exact.
  if (query.split(' ').length < 2) {
    return catalog.filter((exercise) => normalizedExerciseName(exercise.name).includes(query))
  }
  return catalog.filter((exercise) => matchesExerciseSearch(exercise, name))
}

function needsTrainerChoice(name: string, catalog: readonly ExerciseSnapshot[]): boolean {
  const query = normalize(name)
  if (query.split(' ').length >= 2) return false
  return !catalog.some((exercise) => normalizedExerciseName(exercise.name) === query || isExerciseSearchAlias(exercise, query))
}

function quickWorkoutLines(text: string): string[] {
  // Whisper обычно сохраняет слова-связки, а не переносы. Разделяем только
  // явные «затем/потом», чтобы не разрезать список подходов через запятую.
  return text.split(/[\n;]+/).flatMap((line) => line.split(/\s+(?:затем|потом|далее|после\s+этого)\s+/iu)).map((line) => line.trim()).filter(Boolean)
}

function setDrafts(line: string, inputKind: ExerciseSnapshot['inputKind']): { sets: WorkoutSetDraft[]; hasValues: boolean } {
  const rpe = number(/\brpe\s*(\d+(?:[.,]\d+)?)/iu.exec(line)?.[1])
  const validRpe = isValidRpe(rpe) ? rpe : undefined
  // Отдельные пары веса и повторов — естественная запись факта после зала:
  // «80×8, 85×6, 90×5». Берём её только при двух и более парах, чтобы
  // обычное «3×8 80 кг» по-прежнему означало три одинаковых подхода.
  const variableStrengthSets = [...line.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:кг|kg)?\s*(?:[xх×]|на)\s*(\d+)/giu)]
    .map((match) => ({ weightKg: number(match[1]), reps: number(match[2]) }))
    .filter((set): set is { weightKg: number; reps: number } => set.weightKg !== undefined && set.reps !== undefined)
  const spokenWeightReps = /\d+(?:[.,]\d+)?\s*на\s*\d+/iu.test(line)
  if (inputKind === 'strength' && (variableStrengthSets.length >= 2 || spokenWeightReps)) {
    return {
      hasValues: true,
      sets: variableStrengthSets.slice(0, 20).map((set, position) => ({ position, ...set, ...(validRpe !== undefined ? { rpe: validRpe } : {}) })),
    }
  }
  // Тренеры записывают и «3×8», и «3 подхода по 8». В тройной записи
  // «80×8×3» порядок привычный для зала: вес × повторы × подходы.
  const weightRepsSetsMatch = /(\d+(?:[.,]\d+)?)\s*[xх×]\s*(\d+(?:[.,]\d+)?)\s*[xх×]\s*(\d+)/iu.exec(line)
  const setsByWordsMatch = /(\d+)\s*(?:подход(?:а|ов)?|сет(?:а|ов)?)?\s*по\s*(\d+(?:[.,]\d+)?)\s*(сек|с|мин|м)?\b/iu.exec(line)
  const setMatch = /(\d+)\s*[xх×]\s*(\d+(?:[.,]\d+)?)\s*(сек|с|мин|м)?\b/iu.exec(line)
  const count = weightRepsSetsMatch ? Number(weightRepsSetsMatch[3]) : setsByWordsMatch ? Number(setsByWordsMatch[1]) : setMatch ? Number(setMatch[1]) : 1
  const repeatedValue = number(weightRepsSetsMatch?.[2] ?? setsByWordsMatch?.[2] ?? setMatch?.[2])
  const repeatedUnit = (setsByWordsMatch?.[3] ?? setMatch?.[3])?.toLocaleLowerCase('ru')
  const weight = number(/(\d+(?:[.,]\d+)?)\s*(?:кг|kg)/iu.exec(line)?.[1])
    ?? number(weightRepsSetsMatch?.[1])
  const durationMatch = /(\d+(?:[.,]\d+)?)\s*(сек|с|мин|м)/iu.exec(line)
  const durationValue = number(durationMatch?.[1])
  const durationUnit = durationMatch?.[2]?.toLocaleLowerCase('ru')
  const durationSec = repeatedUnit
    ? repeatedValue! * (repeatedUnit.startsWith('м') ? 60 : 1)
    : durationValue === undefined ? undefined : durationValue * (durationUnit?.startsWith('м') ? 60 : 1)
  const distanceKm = number(/(\d+(?:[.,]\d+)?)\s*(?:км|km)/iu.exec(line)?.[1])
  const explicitReps = number(/(\d+)\s*(?:повт|повтор)/iu.exec(line)?.[1])
  const reps = repeatedUnit ? explicitReps : repeatedValue
  const hasValues = weight !== undefined || reps !== undefined || durationSec !== undefined || distanceKm !== undefined || validRpe !== undefined
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
      ...(validRpe !== undefined ? { rpe: validRpe } : {}),
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
  for (const rawLine of quickWorkoutLines(text)) {
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
