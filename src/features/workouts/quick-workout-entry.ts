import type { BlockPreset, BlockType, ExerciseSnapshot, WorkoutSetDraft } from '../../shared/domain'
import { isValidRpe } from '../../shared/rpe'
import { resolveExerciseSearch, SEARCH_ALIASES, type ExerciseSearchResolution } from '../exercises/exercise-search'
import { selectableExercises } from '../exercises/selectable-exercises'
import { normalizeWorkoutSpeech, parseWorkoutNumber, WORKOUT_NUMBER_SOURCE } from './workout-speech-normalizer'

export interface ParsedWorkoutExercise {
  line: string
  exercise: ExerciseSnapshot
  sets: WorkoutSetDraft[]
  hasValues: boolean
  trainerComment?: string
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
  'жим гантелей на наклонной скамье': 'жим гантелей на наклонной',
  'жим на наклонной со штангой': 'жим на наклонной',
  'жим штанги на наклонной скамье': 'жим на наклонной',
}

function explicitEquipmentRefs(value: string): string[] {
  const tokens = normalize(value).split(/\s+/).filter(Boolean)
  const hasStem = (stem: string) => tokens.some((token) => token.startsWith(stem))
  return [
    ...(hasStem('гантел') ? ['dumbbell'] : []),
    ...(hasStem('штанг') ? ['barbell'] : []),
    ...(hasStem('гир') ? ['kettlebells'] : []),
    ...(tokens.some((token) => token.startsWith('блок') || token.startsWith('кроссовер') || token.startsWith('трос')) ? ['cable'] : []),
    ...(hasStem('смит') || tokens.some((token, index) => token.startsWith('тренажер') && (tokens[index - 1] === 'в' || tokens[index - 1] === 'на')) ? ['machine'] : []),
  ]
}

/**
 * Явно названное оборудование — строгая часть намерения пользователя.
 * Если сказано «гантели», вариант со штангой нельзя подставлять даже при
 * высокой текстовой похожести или уверенности LLM.
 */
export function matchesExplicitWorkoutEquipment(value: string, exercise: ExerciseSnapshot): boolean {
  const requested = explicitEquipmentRefs(value)
  if (!requested.length) return true
  const exerciseRefs = new Set([
    ...(exercise.equipmentRef ? [exercise.equipmentRef] : []),
    ...explicitEquipmentRefs(`${exercise.equipment ?? ''} ${exercise.name}`),
  ])
  return requested.every((ref) => exerciseRefs.has(ref))
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

function equipmentNeutralExerciseName(value: string): string {
  const equipmentWords = new Set([
    'штанга', 'штанги', 'гантель', 'гантели', 'гантелей', 'тренажер', 'тренажере',
    'машина', 'машине', 'смит', 'смита', 'гиря', 'гири', 'гирей', 'блок', 'блоке',
  ])
  const words = normalizedExerciseName(value).split(' ').filter((word) => !equipmentWords.has(word))
  return words.filter((word, index) => !['с', 'со', 'в', 'на'].includes(word) || (index > 0 && index < words.length - 1)).join(' ')
}

function equipmentVariantMatches(name: string, catalog: readonly ExerciseSnapshot[]): ExerciseSnapshot[] {
  if (explicitEquipmentRefs(name).length) return []
  const neutralName = equipmentNeutralExerciseName(name)
  if (!neutralName) return []
  return catalog.filter((exercise) => {
    const equipment = explicitEquipmentRefs(`${exercise.name} ${exercise.equipment ?? ''}`)
    return equipment.length > 0 && equipmentNeutralExerciseName(exercise.name) === neutralName
  })
}

function rankAmbiguousVariants(exercises: readonly ExerciseSnapshot[], preferredExerciseRefs: readonly string[]): ExerciseSearchResolution['matches'] {
  const preferredIndex = new Map(preferredExerciseRefs.map((ref, index) => [ref, index]))
  return exercises.map((exercise) => ({ exercise, score: 0, match: 'search' as const }))
    .sort((left, right) => {
      const leftPreferred = preferredIndex.get(left.exercise.ref)
      const rightPreferred = preferredIndex.get(right.exercise.ref)
      if (leftPreferred !== undefined || rightPreferred !== undefined) {
        if (leftPreferred === undefined) return 1
        if (rightPreferred === undefined) return -1
        if (leftPreferred !== rightPreferred) return leftPreferred - rightPreferred
      }
      if (left.exercise.source !== right.exercise.source) return left.exercise.source === 'custom' ? -1 : 1
      return left.exercise.name.localeCompare(right.exercise.name, 'ru')
    })
}

function number(value: string | undefined): number | undefined {
  return parseWorkoutNumber(value)
}

function boundedCount(value: string | undefined, fallback = 1): number {
  const parsed = number(value)
  if (parsed === undefined) return fallback
  return Math.min(Math.max(Math.trunc(parsed), 1), 20)
}

function distanceKilometers(line: string): number | undefined {
  const match = new RegExp(`(${WORKOUT_NUMBER_SOURCE})\\s*(км|km|километр(?:а|ов|ы)?|м\\b|метр(?:а|ов|ы)?)`, 'iu').exec(line)
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
  const distance = new RegExp(`${WORKOUT_NUMBER_SOURCE}\\s*(?:км|km|километр|м\\b|метр)`, 'iu')
  const interval = new RegExp(`^(?:${WORKOUT_NUMBER_SOURCE}\\s*(?:x|х|по)\\s*)?${WORKOUT_NUMBER_SOURCE}\\s*(?:км|km|километр|м\\b|метр)`, 'iu')
  return interval.test(value) || /^(?:между\s+)?интервал/u.test(value) && distance.test(value)
}

export function quickWorkoutExerciseName(line: string): string {
  if (isImplicitRunningLine(line)) return 'Бег'
  const leadingCount = new RegExp(`^\\s*${WORKOUT_NUMBER_SOURCE}\\s+([\\p{L}][\\p{L}\\s-]*)$`, 'iu').exec(line)
  if (leadingCount?.[1]) return leadingCount[1].trim()
  const metric = new RegExp(`${WORKOUT_NUMBER_SOURCE}\\s*(?:[xх×]|кг|kg|кило|килограмм(?:а|ов|ы)?|сек|мин|км|km|повт|раз\\b|на\\s*${WORKOUT_NUMBER_SOURCE}|(?:(?:подход(?:а|ов)?|сет(?:а|ов)?)(?:\\s+по)?|по)\\s*${WORKOUT_NUMBER_SOURCE})`, 'iu').exec(line)
  return (metric ? line.slice(0, metric.index) : line)
    .replace(/\s+(?:вес|весом)\s*$/iu, '')
    .trim()
}

/** Сохраняет важные уточнения техники как заметку, а не теряет их при разборе. */
export function workoutTrainerComment(line: string): string | undefined {
  const normalized = line.toLocaleLowerCase('ru').replaceAll('ё', 'е')
  const comments: string[] = []
  if (/на\s+кажд(?:ую|ой)\s+ног[уе]/u.test(normalized)) comments.push('На каждую ногу')
  if (/на\s+прям(?:ую|ой)(?:\s|\)|,|$)/u.test(normalized)) comments.push('На прямую ногу')
  const negative = /негативн\p{L}*\s+фаз\p{L}*\s*(\d+(?:[.,]\d+)?)\s*(?:сек\p{L}*|с)(?:\s|[,.]|$)/u.exec(normalized)
  if (negative?.[1]) comments.push(`Негативная фаза — ${negative[1].replace(',', '.')} сек.`)
  if (/(?:хват\s+узк\p{L}*|узк\p{L}*\s+хват\p{L}*)/u.test(normalized)) comments.push('Узкий хват')
  if (/(?:хват\s+широк\p{L}*|широк\p{L}*\s+хват\p{L}*)/u.test(normalized)) comments.push('Широкий хват')
  if (/(?:w|в)[\s-]*образн\p{L}*\s+рукоят\p{L}*/u.test(normalized)) comments.push('W-образная рукоять')
  if (/(?:поочередн\p{L}*|попеременн\p{L}*)/u.test(normalized)) comments.push('Поочерёдно')
  if (/кист\p{L}*\s+(?:смотр\p{L}*|направл\p{L}*)\s+в\s+пол/u.test(normalized)) comments.push('Кисти направлены в пол')
  return comments.length ? comments.join(' · ') : undefined
}

function matchingExerciseResolution(name: string, catalog: readonly ExerciseSnapshot[], preferredExerciseRefs: readonly string[]): ExerciseSearchResolution {
  if (!normalize(name)) return { level: 'search', matches: [] }
  // Старые системные ref остаются доступны истории, но не должны создавать
  // ложную неоднозначность при разборе новой тренировки.
  const scopedCatalog = selectableExercises(catalog).filter((exercise) => matchesExplicitWorkoutEquipment(name, exercise))
  const equipmentVariants = equipmentVariantMatches(name, scopedCatalog)
  const options = { preferredExerciseRefs, customFirst: true }
  // Точное каталожное название уже однозначно: «Жим лёжа» означает базовый
  // вариант, а гантели/тренажёр пользователь называет отдельно. Иначе каждый
  // такой ввод попадал бы на лишний экран выбора из-за существования вариантов.
  const direct = resolveExerciseSearch(scopedCatalog, name, options)
  if (direct.level === 'exact') return direct
  // Picker показывает оборудование в скобках и может вернуть его в текст.
  // После строгой фильтрации по оборудованию скобки не должны лишать точное
  // каталожное название права на безопасную подстановку.
  const nameWithoutEquipmentLabel = name.replace(/\s*\((?:штанга|гантел(?:ь|и)|гир(?:я|и)|блок|тренаж[её]р(?:\s+смита)?|сво[её]\s+тело|резина|петли|фитбол|блин)\)\s*$/iu, '').trim()
  if (nameWithoutEquipmentLabel !== name) {
    const withoutEquipmentLabel = resolveExerciseSearch(scopedCatalog, nameWithoutEquipmentLabel, options)
    if (withoutEquipmentLabel.level === 'exact') return withoutEquipmentLabel
  }
  if (equipmentVariants.length > 1) {
    return { level: 'ambiguous', matches: rankAmbiguousVariants(equipmentVariants, preferredExerciseRefs) }
  }
  if (direct.matches.length) return direct
  const speechNormalized = normalizeSportSpeech(name)
  return normalize(speechNormalized) === normalize(name)
    ? direct
    : resolveExerciseSearch(scopedCatalog, speechNormalized, options)
}

export function splitWorkoutText(text: string, catalog: readonly ExerciseSnapshot[]): string[] {
  // Whisper обычно сохраняет слова-связки, а не переносы. Разделяем только
  // явные «затем/потом» и найденные по каталогу начала упражнений.
  return formatWorkoutText(expandPairedExerciseShorthand(normalizeWorkoutSpeech(text)), catalog)
    .split(/[\n;]+/)
    .flatMap((line) => line.split(/\s+(?:затем|потом|далее|дальше|после\s+этого)\s*,?\s*/iu))
    .flatMap((line) => line.split(/\s*\+\s*/u))
    .map((line) => line.trim().replace(/^\d+\s*[.)]\s*/u, ''))
    .filter((line) => Boolean(line) && !/^(?:ягодицы|ноги|спина|плечи|грудь|руки|кор|пресс|кардио)(?:\s*[/+]\s*(?:ягодицы|ноги|спина|плечи|грудь|руки|кор|пресс|кардио))*\s*:?$/iu.test(line))
}

/** Кандидаты из каталога для одного фрагмента диктовки, в порядке релевантности. */
export function workoutCandidates(line: string, catalog: readonly ExerciseSnapshot[]): ExerciseSnapshot[] {
  return matchingExerciseResolution(quickWorkoutExerciseName(line), catalog, []).matches
    .map(({ exercise }) => exercise)
    .slice(0, 8)
}

function setDrafts(line: string, inputKind: ExerciseSnapshot['inputKind']): { sets: WorkoutSetDraft[]; hasValues: boolean } {
  const rpe = number(new RegExp(`\\brpe\\s*(${WORKOUT_NUMBER_SOURCE})`, 'iu').exec(line)?.[1])
  const validRpe = isValidRpe(rpe) ? rpe : undefined
  if (inputKind === 'distance') {
    const interval = new RegExp(`(${WORKOUT_NUMBER_SOURCE})\\s*(?:[xх×]|по)\\s*(${WORKOUT_NUMBER_SOURCE})\\s*(км|km|километр(?:а|ов|ы)?|м\\b|метр(?:а|ов|ы)?)`, 'iu').exec(line)
    const count = interval ? boundedCount(interval[1]) : 1
    const intervalDistance = interval
      ? number(interval[2])! * (interval[3]?.toLocaleLowerCase('ru').startsWith('к') ? 1 : 0.001)
      : undefined
    const distanceKm = intervalDistance ?? distanceKilometers(line)
    const clockDuration = clockDurationSeconds(line)
    const durationMatch = new RegExp(`(${WORKOUT_NUMBER_SOURCE})\\s*(секунд(?:а|ы)?|сек|минут(?:а|ы)?|мин|час(?:а|ов)?|ч\\b)`, 'iu').exec(line)
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
  const variableStrengthSets = [...line.matchAll(new RegExp(`(${WORKOUT_NUMBER_SOURCE})\\s*(?:кг|kg|кило|килограмм(?:а|ов|ы)?)?\\s*(?:[xх×]|на)\\s*(${WORKOUT_NUMBER_SOURCE})`, 'giu'))]
    .map((match) => ({ weightKg: number(match[1]), reps: number(match[2]) }))
    .filter((set): set is { weightKg: number; reps: number } => set.weightKg !== undefined && set.reps !== undefined)
  if (inputKind === 'strength' && variableStrengthSets.length >= 2) {
    return {
      hasValues: true,
      sets: variableStrengthSets.slice(0, 20).map((set, position) => ({ position, ...set, ...(validRpe !== undefined ? { rpe: validRpe } : {}) })),
    }
  }
  // Тренеры записывают и «3×8», и «3 подхода по 8». В тройной записи
  // «80×8×3» порядок привычный для зала: вес × повторы × подходы.
  const weightRepsSetsMatch = new RegExp(`(${WORKOUT_NUMBER_SOURCE})\\s*[xх×]\\s*(${WORKOUT_NUMBER_SOURCE})\\s*[xх×]\\s*(${WORKOUT_NUMBER_SOURCE})`, 'iu').exec(line)
  const metricBoundary = '(?=$|[\\s,.;:!?—-])'
  const setsByWordsMatch = new RegExp(`(${WORKOUT_NUMBER_SOURCE})\\s*(?:(?:подход(?:а|ов)?|сет(?:а|ов)?)\\s+по|по)\\s*(${WORKOUT_NUMBER_SOURCE})\\s*(сек|с|мин|м)?${metricBoundary}`, 'iu').exec(line)
  const setMatch = new RegExp(`(${WORKOUT_NUMBER_SOURCE})\\s*[xх×]\\s*(${WORKOUT_NUMBER_SOURCE})\\s*(сек|с|мин|м)?${metricBoundary}`, 'iu').exec(line)
  const explicitCountMatch = new RegExp(`(${WORKOUT_NUMBER_SOURCE})\\s*(?:подход(?:а|ов)?|сет(?:а|ов)?)${metricBoundary}`, 'iu').exec(line)
  const singleWeightRepsMatch = new RegExp(`(${WORKOUT_NUMBER_SOURCE})\\s*(?:кг|kg|кило|килограмм(?:а|ов|ы)?)?\\s+на\\s+(${WORKOUT_NUMBER_SOURCE})`, 'iu').exec(line)
  const count = weightRepsSetsMatch ? boundedCount(weightRepsSetsMatch[3])
    : setsByWordsMatch ? boundedCount(setsByWordsMatch[1])
      : setMatch ? boundedCount(setMatch[1])
        : boundedCount(explicitCountMatch?.[1])
  const repeatedValue = number(weightRepsSetsMatch?.[2] ?? setsByWordsMatch?.[2] ?? setMatch?.[2])
  const repeatedUnit = (setsByWordsMatch?.[3] ?? setMatch?.[3])?.toLocaleLowerCase('ru')
  const weight = number(new RegExp(`(${WORKOUT_NUMBER_SOURCE})\\s*(?:кг|kg|кило|килограмм(?:а|ов|ы)?)`, 'iu').exec(line)?.[1])
    ?? number(weightRepsSetsMatch?.[1])
    ?? number(singleWeightRepsMatch?.[1])
  const durationMatch = new RegExp(`(${WORKOUT_NUMBER_SOURCE})\\s*(сек|с|мин|м)`, 'iu').exec(line)
  const durationValue = number(durationMatch?.[1])
  const durationUnit = durationMatch?.[2]?.toLocaleLowerCase('ru')
  const durationSec = repeatedUnit
    ? repeatedValue! * (repeatedUnit.startsWith('м') ? 60 : 1)
    : durationValue === undefined ? undefined : durationValue * (durationUnit?.startsWith('м') ? 60 : 1)
  const explicitReps = number(new RegExp(`(${WORKOUT_NUMBER_SOURCE})\\s*(?:повт|повтор(?:а|ов|ение|ения|ений)?|раз(?:а|ов)?)${metricBoundary}`, 'iu').exec(line)?.[1])
    ?? (inputKind === 'reps' ? number(new RegExp(`^\\s*(${WORKOUT_NUMBER_SOURCE})\\s+[\\p{L}]`, 'iu').exec(line)?.[1]) : undefined)
  const reps = repeatedUnit ? explicitReps : (repeatedValue ?? explicitReps ?? number(singleWeightRepsMatch?.[2]))
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
  const count = number(new RegExp(`(${WORKOUT_NUMBER_SOURCE})\\s*(?:[xх×]|по)\\s*${WORKOUT_NUMBER_SOURCE}\\s*(?:км|km|километр|м\\b|метр)`, 'iu').exec(line.slice(0, divider.index))?.[1])
  if (count === undefined || !Number.isFinite(count) || count < 1 || count > 20) return undefined
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
  const trainerComment = workoutTrainerComment(line)
  if (exercise.ref !== 'running') return { line, exercise, ...values, trainerComment }
  if (new RegExp(`${WORKOUT_NUMBER_SOURCE}\\s*(?:[xх×]|по)\\s*${WORKOUT_NUMBER_SOURCE}\\s*(?:км|km|километр|м\\b|метр)`, 'iu').test(line)) {
    return {
      line,
      exercise: { ...exercise, name: 'Бег — интервалы' },
      ...values,
      trainerComment,
      structure: { blockType: 'single', blockPreset: 'interval', blockRounds: 1, restBetweenSetsSec: 90 },
    }
  }
  if (/между\s+интервал|трусц/iu.test(line)) {
    return {
      line,
      exercise: { ...exercise, name: 'Бег — восстановление' },
      ...values,
      trainerComment,
      structure: { blockType: 'single', blockPreset: 'interval', blockRounds: 1 },
    }
  }
  return { line, exercise, ...values, trainerComment }
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
    const resolution = matchingExerciseResolution(name, catalog, options.preferredExerciseRefs ?? [])
    const matches = resolution.matches.map(({ exercise }) => exercise)
    if (resolution.level !== 'exact') {
      unparsed.push({ line, reason: matches.length ? 'ambiguous' : 'not-found', candidates: matches.slice(0, 3) })
      continue
    }
    parsed.push(resolveQuickWorkoutLine(line, matches[0]!))
  }
  return { parsed, unparsed }
}
