import type { BlockPreset, BlockType, ExerciseSnapshot, WorkoutSetDraft } from '../../shared/domain'
import { isValidRpe } from '../../shared/rpe'
import { isExerciseSearchAlias, rankExerciseSearch, SEARCH_ALIASES } from '../exercises/exercise-search'

export interface ParsedWorkoutExercise {
  line: string
  exercise: ExerciseSnapshot
  sets: WorkoutSetDraft[]
  hasValues: boolean
  structure?: {
    blockId?: string
    blockType?: BlockType
    blockPreset?: BlockPreset
    blockRounds?: number
    restBetweenExercisesSec?: number
    restBetweenRoundsSec?: number
    restBetweenSetsSec?: number
  }
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

export interface QuickWorkoutEntryOptions {
  /** История клиента влияет только на порядок альтернатив, не на авто-выбор. */
  preferredExerciseRefs?: readonly string[]
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase('ru')
    .replaceAll('ё', 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

// Частые ошибки распознавания спортивной речи. Каноническое упражнение всё
// равно берётся только из актуального каталога Supabase ниже.
const sportSpeechAliases: Record<string, string> = {
  'жим леха': 'жим лежа',
  'жим лежа': 'жим лежа',
  'присед со штангой': 'приседания со штангой',
  'тяга верхнего блока': 'верхний блок',
  'разводка': 'разведение рук',
  'бицепс': 'сгибание рук',
  'жим гантелей в наклонной скамье': 'жим гантелей на наклонной',
}

function exerciseStartPhrases(catalog: readonly ExerciseSnapshot[]): string[] {
  return [...catalog.flatMap((exercise) => [
    exercise.name.replace(/\s*\([^)]*\)\s*$/, ''),
    ...(SEARCH_ALIASES[exercise.ref] ?? []),
  ]), ...Object.keys(sportSpeechAliases)]
    .map((value) => value.trim())
    .filter((value) => value.split(/\s+/).length >= 2)
    .sort((left, right) => right.length - left.length)
}

/**
 * SpeechKit часто отдаёт несколько упражнений одной фразой. Ищем начала
 * упражнений по актуальному каталогу и его алиасам, чтобы и превью, и
 * саджесты работали с каждой частью ввода отдельно.
 */
export function formatWorkoutText(text: string, catalog: readonly ExerciseSnapshot[] = []): string {
  const starts = exerciseStartPhrases(catalog)
  // Поле вызывает форматирование на каждом вводе. Не обрезаем хвост строки:
  // иначе обычный пробел после последнего слова невозможно набрать.
  if (!starts.length) return text.replace(/\n{2,}/g, '\n')
  const matches = starts.flatMap((phrase) => {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
    return [...text.matchAll(new RegExp(`(?:^|\\s)${escaped}(?=\\s|$)`, 'giu'))]
      .map((match) => ({ index: (match.index ?? 0) + match[0].length - match[0].trimStart().length, length: phrase.length }))
  }).sort((left, right) => left.index - right.index || right.length - left.length)
  const startsAt = matches.reduce<number[]>((result, match) => result.some((index) => index === match.index) ? result : [...result, match.index], [])
  if (startsAt.length < 2) return text.replace(/\n{2,}/g, '\n')
  return startsAt.slice(1).reverse().reduce((result, index) => `${result.slice(0, index).trimEnd()}\n${result.slice(index).trimStart()}`, text).replace(/\n{2,}/g, '\n')
}

/**
 * В зале часто говорят «сведение и разведение ног» как одну связку, хотя для
 * истории прогресса это два разных упражнения. Повторяем общие значения для
 * обоих движений, но только для этой однозначной пары и только внутри строки —
 * более общие конструкции с «и» локально не угадываем.
 */
function expandPairedExerciseShorthand(text: string): string {
  return text.split('\n').flatMap((rawLine) => {
    const line = rawLine.trim()
    const direct = /^сведени[ея]\s+(?:и|плюс)\s+разведени[ея]\s+ног\s+(.+)$/iu.exec(line)
    if (direct?.[1]) return [`Сведение ног ${direct[1]}`, `Разведение ног ${direct[1]}`]
    const reverse = /^разведени[ея]\s+(?:и|плюс)\s+сведени[ея]\s+ног\s+(.+)$/iu.exec(line)
    if (reverse?.[1]) return [`Разведение ног ${reverse[1]}`, `Сведение ног ${reverse[1]}`]
    return [rawLine]
  }).join('\n')
}

function normalizeSportSpeech(value: string): string {
  const normalized = normalize(value)
  return sportSpeechAliases[normalized] ?? value
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

function distanceKilometers(line: string): number | undefined {
  const match = /(\d+(?:[.,]\d+)?)\s*(км|km|километр(?:а|ов|ы)?|м\b|метр(?:а|ов|ы)?)/iu.exec(line)
  const value = number(match?.[1])
  if (value === undefined) return undefined
  return match?.[2]?.toLocaleLowerCase('ru').startsWith('к') ? value : value / 1000
}

function clockDurationSeconds(line: string): number | undefined {
  const match = /\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/u.exec(line)
  if (!match) return undefined
  const first = Number(match[1])
  const second = Number(match[2])
  const third = match[3] === undefined ? undefined : Number(match[3])
  if (second > 59 || (third !== undefined && third > 59)) return undefined
  return third === undefined ? first * 60 + second : first * 3600 + second * 60 + third
}

function isImplicitRunningLine(line: string): boolean {
  const value = normalize(line)
  return /^(?:\d+\s*(?:x|х|по)\s*)?\d+(?:[.,]\d+)?\s*(?:км|km|километр|м\b|метр)/u.test(value)
    || /^(?:между\s+)?интервал/u.test(value) && /\d+(?:[.,]\d+)?\s*(?:км|километр|м\b|метр)/u.test(value)
}

export function quickWorkoutExerciseName(line: string): string {
  if (isImplicitRunningLine(line)) return 'Бег'
  const leadingCount = /^\s*\d+\s+([\p{L}][\p{L}\s-]*)$/u.exec(line)
  if (leadingCount?.[1]) return leadingCount[1].trim()
  const metric = /\d+\s*(?:[xх×]|кг|kg|килограмм(?:а|ов)?|сек|мин|км|km|повт|раз\b|на\s*\d|(?:(?:подход(?:а|ов)?|сет(?:а|ов)?)(?:\s+по)?|по)\s*\d)/iu.exec(line)
  return (metric ? line.slice(0, metric.index) : line).trim()
}

function prioritizePreferred(matches: readonly ExerciseSnapshot[], preferredExerciseRefs: readonly string[]): ExerciseSnapshot[] {
  if (!preferredExerciseRefs.length || matches.length < 2) return [...matches]
  const preferredIndex = new Map(preferredExerciseRefs.map((ref, index) => [ref, index]))
  return matches.slice().sort((left, right) => {
    const leftIndex = preferredIndex.get(left.ref)
    const rightIndex = preferredIndex.get(right.ref)
    if (leftIndex === undefined && rightIndex === undefined) return 0
    if (leftIndex === undefined) return 1
    if (rightIndex === undefined) return -1
    return leftIndex - rightIndex
  })
}

function matchingExercises(name: string, catalog: readonly ExerciseSnapshot[], preferredExerciseRefs: readonly string[]): ExerciseSnapshot[] {
  const query = normalize(normalizeSportSpeech(name))
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
  // Но для вариантов вроде «биц», «гакк» и «смит» учитываем алиасы, чтобы
  // тренер хотя бы получил релевантные варианты, а не пустой результат.
  if (query.split(' ').length < 2) {
    return prioritizePreferred(rankExerciseSearch(catalog, name).map(({ exercise }) => exercise), preferredExerciseRefs)
  }
  return prioritizePreferred(rankExerciseSearch(catalog, name).map(({ exercise }) => exercise), preferredExerciseRefs)
}

function canResolveSafely(name: string, matches: readonly ExerciseSnapshot[], catalog: readonly ExerciseSnapshot[]): boolean {
  if (matches.length !== 1 && name.trim().split(/\s+/).length < 2) return false
  if (matches.length === 1) return true
  const ranked = rankExerciseSearch(catalog, name)
  const [first, second] = ranked
  // Для фразы из нескольких слов авто-выбор допустим, когда лучший вариант
  // явно опережает следующий. Тренер всё равно видит итог и может его заменить.
  return Boolean(first && second && first.score >= 84 && first.score - second.score >= 18)
}

function needsTrainerChoice(name: string, catalog: readonly ExerciseSnapshot[]): boolean {
  const query = normalize(name)
  if (query.split(' ').length >= 2) return false
  return !catalog.some((exercise) => normalizedExerciseName(exercise.name) === query || isExerciseSearchAlias(exercise, query))
}

export function splitWorkoutText(text: string, catalog: readonly ExerciseSnapshot[]): string[] {
  // Whisper обычно сохраняет слова-связки, а не переносы. Разделяем только
  // явные «затем/потом» и найденные по каталогу начала упражнений.
  return formatWorkoutText(expandPairedExerciseShorthand(text), catalog)
    .split(/[\n;]+/)
    .flatMap((line) => line.split(/\s+(?:затем|потом|далее|после\s+этого)\s+/iu))
    .flatMap((line) => line.split(/\s*\+\s*/u))
    .map((line) => line.trim())
    .filter(Boolean)
}

/** Кандидаты из каталога для одного фрагмента диктовки, в порядке релевантности. */
export function workoutCandidates(line: string, catalog: readonly ExerciseSnapshot[]): ExerciseSnapshot[] {
  return matchingExercises(quickWorkoutExerciseName(line), catalog, []).slice(0, 8)
}

function setDrafts(line: string, inputKind: ExerciseSnapshot['inputKind']): { sets: WorkoutSetDraft[]; hasValues: boolean } {
  const rpe = number(/\brpe\s*(\d+(?:[.,]\d+)?)/iu.exec(line)?.[1])
  const validRpe = isValidRpe(rpe) ? rpe : undefined
  if (inputKind === 'distance') {
    const interval = /(\d+)\s*(?:[xх×]|по)\s*(\d+(?:[.,]\d+)?)\s*(км|km|километр(?:а|ов|ы)?|м\b|метр(?:а|ов|ы)?)/iu.exec(line)
    const count = interval ? Math.min(Math.max(Number(interval[1]), 1), 20) : 1
    const intervalDistance = interval
      ? number(interval[2])! * (interval[3]?.toLocaleLowerCase('ru').startsWith('к') ? 1 : 0.001)
      : undefined
    const distanceKm = intervalDistance ?? distanceKilometers(line)
    const clockDuration = clockDurationSeconds(line)
    const durationMatch = /(\d+(?:[.,]\d+)?)\s*(секунд(?:а|ы)?|сек|минут(?:а|ы)?|мин|час(?:а|ов)?|ч\b)/iu.exec(line)
    const durationValue = number(durationMatch?.[1])
    const durationUnit = durationMatch?.[2]?.toLocaleLowerCase('ru')
    const durationSec = clockDuration ?? (durationValue === undefined ? undefined
      : durationUnit?.startsWith('ч') ? durationValue * 3600
        : durationUnit?.startsWith('м') ? durationValue * 60 : durationValue)
    const hasValues = distanceKm !== undefined || durationSec !== undefined || validRpe !== undefined
    return {
      hasValues,
      sets: Array.from({ length: count }, (_, position) => ({
        position,
        ...(durationSec !== undefined ? { durationSec } : {}),
        ...(distanceKm !== undefined ? { distanceKm } : {}),
        ...(validRpe !== undefined ? { rpe: validRpe } : {}),
      })),
    }
  }
  // Отдельные пары веса и повторов — естественная запись факта после зала:
  // «80×8, 85×6, 90×5». Берём её только при двух и более парах, чтобы
  // обычное «3×8 80 кг» по-прежнему означало три одинаковых подхода.
  const variableStrengthSets = [...line.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:кг|kg|килограмм(?:а|ов)?)?\s*(?:[xх×]|на)\s*(\d+)/giu)]
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
  const setsByWordsMatch = /(\d+)\s*(?:(?:подход(?:а|ов)?|сет(?:а|ов)?)(?:\s+по)?|по)\s*(\d+(?:[.,]\d+)?)\s*(сек|с|мин|м)?\b/iu.exec(line)
  const setMatch = /(\d+)\s*[xх×]\s*(\d+(?:[.,]\d+)?)\s*(сек|с|мин|м)?\b/iu.exec(line)
  const count = weightRepsSetsMatch ? Number(weightRepsSetsMatch[3]) : setsByWordsMatch ? Number(setsByWordsMatch[1]) : setMatch ? Number(setMatch[1]) : 1
  const repeatedValue = number(weightRepsSetsMatch?.[2] ?? setsByWordsMatch?.[2] ?? setMatch?.[2])
  const repeatedUnit = (setsByWordsMatch?.[3] ?? setMatch?.[3])?.toLocaleLowerCase('ru')
  const weight = number(/(\d+(?:[.,]\d+)?)\s*(?:кг|kg|килограмм(?:а|ов)?)/iu.exec(line)?.[1])
    ?? number(weightRepsSetsMatch?.[1])
  const durationMatch = /(\d+(?:[.,]\d+)?)\s*(сек|с|мин|м)/iu.exec(line)
  const durationValue = number(durationMatch?.[1])
  const durationUnit = durationMatch?.[2]?.toLocaleLowerCase('ru')
  const durationSec = repeatedUnit
    ? repeatedValue! * (repeatedUnit.startsWith('м') ? 60 : 1)
    : durationValue === undefined ? undefined : durationValue * (durationUnit?.startsWith('м') ? 60 : 1)
  const explicitReps = number(/(\d+)\s*(?:повт|повтор|раз\b)/iu.exec(line)?.[1])
    ?? (inputKind === 'reps' ? number(/^\s*(\d+)\s+[\p{L}]/u.exec(line)?.[1]) : undefined)
  const reps = repeatedUnit ? explicitReps : (repeatedValue ?? explicitReps)
  const hasValues = weight !== undefined || reps !== undefined || durationSec !== undefined || validRpe !== undefined
  return {
    hasValues,
    sets: Array.from({ length: Math.min(Math.max(count, 1), 20) }, (_, position) => ({
      position,
      ...(inputKind === 'strength' && weight !== undefined ? { weightKg: weight } : {}),
      ...(inputKind === 'strength' && reps !== undefined ? { reps } : {}),
      ...(inputKind === 'reps' && durationSec !== undefined ? { durationSec } : {}),
      ...(inputKind === 'reps' && reps !== undefined ? { reps } : {}),
      ...(inputKind === 'duration' && durationSec !== undefined ? { durationSec } : {}),
      ...(validRpe !== undefined ? { rpe: validRpe } : {}),
    })),
  }
}

function activeRunningIntervalDrafts(line: string, catalog: readonly ExerciseSnapshot[]): ParsedWorkoutExercise[] | undefined {
  const divider = /,?\s*(?:между\s+интервалами|восстановление)/iu.exec(line)
  if (!divider || divider.index <= 0) return undefined
  const count = Number(/(\d+)\s*(?:[xх×]|по)\s*\d+(?:[.,]\d+)?\s*(?:км|km|километр|м\b|метр)/iu.exec(line.slice(0, divider.index))?.[1])
  if (!Number.isFinite(count) || count < 1 || count > 20) return undefined
  const running = catalog.find((exercise) => exercise.ref === 'running' && exercise.inputKind === 'distance')
  if (!running) return undefined
  const workValues = setDrafts(line.slice(0, divider.index), 'distance')
  const recoveryValues = setDrafts(line.slice(divider.index), 'distance')
  const recoverySet = recoveryValues.sets[0]
  if (!workValues.hasValues || !recoverySet?.distanceKm) return undefined
  const blockId = crypto.randomUUID()
  const structure = {
    blockId,
    blockType: 'group' as const,
    blockPreset: 'interval' as const,
    blockRounds: count,
    restBetweenExercisesSec: 0,
    restBetweenRoundsSec: 0,
  }
  return [
    {
      line: line.slice(0, divider.index).trim(),
      exercise: { ...running, name: 'Бег — быстрый отрезок' },
      ...workValues,
      structure,
    },
    {
      line: line.slice(divider.index).trim(),
      exercise: { ...running, name: 'Бег — восстановление' },
      sets: Array.from({ length: count }, (_, position) => ({ ...recoverySet, position })),
      hasValues: true,
      structure,
    },
  ]
}

export function resolveQuickWorkoutLine(line: string, exercise: ExerciseSnapshot): ParsedWorkoutExercise {
  const values = setDrafts(line, exercise.inputKind)
  if (exercise.ref !== 'running') return { line, exercise, ...values }
  if (/\d+\s*(?:[xх×]|по)\s*\d+(?:[.,]\d+)?\s*(?:км|km|километр|м\b|метр)/iu.test(line)) {
    return {
      line,
      exercise: { ...exercise, name: 'Бег — интервалы' },
      ...values,
      structure: { blockType: 'single', blockPreset: 'interval', blockRounds: 1, restBetweenSetsSec: 90 },
    }
  }
  if (/между\s+интервал|трусц/iu.test(line)) {
    return {
      line,
      exercise: { ...exercise, name: 'Бег — восстановление' },
      ...values,
      structure: { blockType: 'single', blockPreset: 'interval', blockRounds: 1 },
    }
  }
  return { line, exercise, ...values }
}

/**
 * Строгий локальный разбор записи тренера. Он не угадывает похожие упражнения:
 * неуверенную строку возвращаем в unparsed, чтобы не записать факт не тому движению.
 */
export function parseQuickWorkoutEntry(text: string, catalog: readonly ExerciseSnapshot[], options: QuickWorkoutEntryOptions = {}): QuickWorkoutParseResult {
  const parsed: ParsedWorkoutExercise[] = []
  const unparsed: UnparsedWorkoutLine[] = []
  for (const rawLine of splitWorkoutText(text, catalog)) {
    const line = rawLine.trim()
    if (!line) continue
    const activeRunningIntervals = activeRunningIntervalDrafts(line, catalog)
    if (activeRunningIntervals) {
      parsed.push(...activeRunningIntervals)
      continue
    }
    const name = quickWorkoutExerciseName(line)
    const matches = matchingExercises(name, catalog, options.preferredExerciseRefs ?? [])
    if (needsTrainerChoice(name, catalog) || !canResolveSafely(name, matches, catalog)) {
      unparsed.push({ line, reason: matches.length ? 'ambiguous' : 'not-found', candidates: matches.slice(0, 3) })
      continue
    }
    parsed.push(resolveQuickWorkoutLine(line, matches[0]!))
  }
  return { parsed, unparsed }
}
