export type WorkoutParserExercise = {
  source: 'system' | 'custom'
  ref: string
  name: string
  inputKind: string
  equipment?: string
  muscleGroup?: string
  primaryMuscleDetail?: string
}

export type WorkoutSet = {
  weightKg?: number
  reps?: number
  durationMin?: number
  distanceKm?: number
}

export type ParsedWorkoutItem = {
  sourceText: string
  exerciseRef: string
  confidence: number
  sets: WorkoutSet[]
  position?: number
}

export type UnmatchedWorkoutItem = {
  sourceText: string
  reason: string
  suggestedExerciseRefs: string[]
  sets?: WorkoutSet[]
  position?: number
}

export type WorkoutParseResponse = {
  items: ParsedWorkoutItem[]
  unmatched: UnmatchedWorkoutItem[]
}

type ExtractedWorkoutItem = {
  sourceText: string
  exerciseName: string
  equipment?: string
  muscle?: string
  sets: WorkoutSet[]
  position: number
}

type ExtractedUnmatchedItem = {
  sourceText: string
  reason: string
  position: number
}

export type ExtractedWorkout = {
  items: ExtractedWorkoutItem[]
  unmatched: ExtractedUnmatchedItem[]
}

export const workoutExtractionSchema = {
  type: 'object', additionalProperties: false, required: ['items', 'unmatched'], properties: {
    items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['sourceText', 'exerciseName', 'equipment', 'muscle', 'sets', 'repeatCount', 'position'], properties: {
      sourceText: { type: 'string' }, exerciseName: { type: 'string' }, equipment: { type: ['string', 'null'] }, muscle: { type: ['string', 'null'] }, position: { type: 'integer' },
      repeatCount: { type: 'integer', minimum: 1, maximum: 20 },
      sets: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
        weightKg: { type: 'number' }, reps: { type: 'number' }, durationMin: { type: 'number' }, distanceKm: { type: 'number' },
      } } },
    } } },
    unmatched: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['sourceText', 'reason', 'position'], properties: {
      sourceText: { type: 'string' }, reason: { type: 'string' }, position: { type: 'integer' },
    } } },
  },
}

export function workoutExtractionPrompt(text: string): string {
  return [
    'Разбери запись тренировки после диктовки и верни JSON строго по schema. Каталога упражнений у тебя нет: не придумывай идентификаторы и не выбирай карточку.',
    'Для каждого упражнения сохрани точный исходный фрагмент в sourceText, а в exerciseName дай короткое нормализованное спортивное название. Не теряй названные оборудование, положение тела и целевую мышцу: вынеси явно названные оборудование и мышцу в equipment и muscle, иначе верни null.',
    'Не объединяй разные упражнения. position — порядковый номер упражнения с нуля. Если фрагмент невозможно уверенно выделить как упражнение, верни его в unmatched с исходной позицией.',
    'Если сказано N одинаковых подходов (например, «3 подхода по 15 на 100»), верни один объект в sets и repeatCount=N. Если подходы различаются, перечисли их в sets и верни repeatCount=1. Порядок чисел в речи не важен. Не придумывай значения и не добавляй нули для отсутствующих повторов, веса, времени или дистанции.',
    `Текст: ${text}`,
  ].join('\n')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readSystemExercise(value: unknown): WorkoutParserExercise | undefined {
  if (!isRecord(value) || value.source !== 'system' || typeof value.ref !== 'string'
    || typeof value.name !== 'string' || typeof value.inputKind !== 'string') return undefined
  return {
    source: 'system', ref: value.ref, name: value.name, inputKind: value.inputKind,
    ...(typeof value.equipment === 'string' ? { equipment: value.equipment } : {}),
    ...(typeof value.muscleGroup === 'string' ? { muscleGroup: value.muscleGroup } : {}),
    ...(typeof value.primaryMuscleDetail === 'string' ? { primaryMuscleDetail: value.primaryMuscleDetail } : {}),
  }
}

function isSetValue(key: string, value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && (key === 'weightKg' ? value >= 0 : value > 0)
}

function validatedSets(value: unknown): WorkoutSet[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter(isRecord).map((set) => Object.fromEntries(
    ['weightKg', 'reps', 'durationMin', 'distanceKm'].flatMap((key) => isSetValue(key, set[key]) ? [[key, set[key]]] : []),
  ))
}

function validPosition(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 1_000 ? value : fallback
}

export function validateWorkoutExtraction(value: unknown): ExtractedWorkout {
  if (!isRecord(value) || !Array.isArray(value.items) || !Array.isArray(value.unmatched)) throw new Error('invalid_output')
  const items = value.items.flatMap((raw, index): ExtractedWorkoutItem[] => {
    if (!isRecord(raw) || typeof raw.sourceText !== 'string' || typeof raw.exerciseName !== 'string') return []
    const sourceText = raw.sourceText.trim()
    const exerciseName = raw.exerciseName.trim()
    const sets = validatedSets(raw.sets)
    if (!sourceText || !exerciseName || sets === undefined) return []
    const repeatCount = typeof raw.repeatCount === 'number' && Number.isInteger(raw.repeatCount) && raw.repeatCount > 1 && raw.repeatCount <= 20 && sets.length === 1
      ? raw.repeatCount
      : 1
    return [{
      sourceText,
      exerciseName,
      ...(typeof raw.equipment === 'string' && raw.equipment.trim() ? { equipment: raw.equipment.trim() } : {}),
      ...(typeof raw.muscle === 'string' && raw.muscle.trim() ? { muscle: raw.muscle.trim() } : {}),
      sets: repeatCount > 1 ? Array.from({ length: repeatCount }, () => ({ ...sets[0]! })) : sets,
      position: validPosition(raw.position, index),
    }]
  })
  const unmatched = value.unmatched.flatMap((raw, index): ExtractedUnmatchedItem[] => {
    if (!isRecord(raw) || typeof raw.sourceText !== 'string') return []
    const sourceText = raw.sourceText.trim()
    if (!sourceText) return []
    return [{
      sourceText,
      reason: typeof raw.reason === 'string' && raw.reason.trim() ? raw.reason.trim() : 'Не удалось выделить упражнение',
      position: validPosition(raw.position, items.length + index),
    }]
  })
  if (items.length + unmatched.length === 0 && value.items.length + value.unmatched.length > 0) throw new Error('invalid_output')
  return { items, unmatched }
}

const phraseReplacements: ReadonlyArray<readonly [RegExp, string]> = [
  [/(?<!\p{L})(?:кроссовер\p{L}*|блочн\p{L}*)(?!\p{L})/giu, 'блок'],
  [/(?<!\p{L})(?:гантел\p{L}*)(?!\p{L})/giu, 'гантели'],
  [/(?<!\p{L})(?:штанг\p{L}*)(?!\p{L})/giu, 'штанга'],
  [/(?<!\p{L})(?:гир\p{L}*)(?!\p{L})/giu, 'гиря'],
  [/(?<!\p{L})(?:тренаж[её]р\p{L}*)(?!\p{L})/giu, 'тренажер'],
  [/(?<!\p{L})(?:разводк\p{L}*|разведени\p{L}*|отведени\p{L}*)(?!\p{L})/giu, 'разведение'],
  [/(?<!\p{L})(?:подъ[её]м\p{L}*)(?!\p{L})/giu, 'подъем'],
  [/(?<!\p{L})(?:повтор\p{L}*|повт)(?!\p{L})/giu, ' '],
  [/(?<!\p{L})(?:подход\p{L}*|сет\p{L}*)(?!\p{L})/giu, ' '],
]

const ignoredTokens = new Set([
  'в', 'во', 'на', 'с', 'со', 'из', 'к', 'ко', 'по', 'для', 'и', 'или', 'за',
  'кг', 'kg', 'килограмм', 'раз', 'минута', 'мин', 'секунда', 'сек', 'метр', 'км',
])

function normalize(value: string): string {
  let result = value.toLocaleLowerCase('ru').replaceAll('ё', 'е')
  for (const [pattern, replacement] of phraseReplacements) result = result.replace(pattern, replacement)
  return result.replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim()
}

function stem(token: string): string {
  if (token.length < 6) return token
  const suffixes = ['иями', 'ями', 'ами', 'его', 'ого', 'ему', 'ому', 'ыми', 'ими', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ой', 'ей', 'ую', 'юю', 'ах', 'ях', 'ам', 'ям', 'ом', 'ем', 'ов', 'ев', 'ы', 'и', 'а', 'я', 'у', 'ю', 'е']
  const suffix = suffixes.find((candidate) => token.endsWith(candidate) && token.length - candidate.length >= 4)
  return suffix ? token.slice(0, -suffix.length) : token
}

function tokens(value: string): string[] {
  return normalize(value).split(/\s+/).filter((token) => token && !ignoredTokens.has(token) && !/^\d+(?:[.,]\d+)?$/u.test(token)).map(stem)
}

function editDistanceAtMostOne(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) > 1) return false
  let leftIndex = 0
  let rightIndex = 0
  let edits = 0
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1
      rightIndex += 1
      continue
    }
    edits += 1
    if (edits > 1) return false
    if (left.length > right.length) leftIndex += 1
    else if (right.length > left.length) rightIndex += 1
    else {
      leftIndex += 1
      rightIndex += 1
    }
  }
  return edits + Number(leftIndex < left.length || rightIndex < right.length) <= 1
}

function tokenMatches(left: string, right: string): boolean {
  return left === right
    || (left.length >= 5 && right.length >= 5 && (left.includes(right) || right.includes(left) || editDistanceAtMostOne(left, right)))
}

const equipmentFamilies: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['гантели', ['гантели']], ['штанга', ['штанга', 'гриф']], ['гиря', ['гиря']],
  ['блок', ['блок']], ['смит', ['смит']], ['резина', ['резин', 'эспандер']],
  ['тренажер', ['тренажер', 'машин']],
]

function mentionedEquipment(value: string): string[] {
  const normalized = normalize(value)
  return equipmentFamilies.flatMap(([family, variants]) => variants.some((variant) => normalized.includes(variant)) ? [family] : [])
}

type RankedMatch = {
  exercise: WorkoutParserExercise
  score: number
  queryCoverage: number
  nameCoverage: number
  matchedQueryTokens: number
  queryTokenCount: number
  equipmentMatch: boolean
  exact: boolean
}

function rankExercise(item: Pick<ExtractedWorkoutItem, 'sourceText' | 'exerciseName' | 'equipment' | 'muscle'>, exercise: WorkoutParserExercise): RankedMatch | undefined {
  const name = normalize(exercise.name)
  const queries = [item.exerciseName, item.sourceText].map(normalize).filter(Boolean)
  const exact = queries.some((query) => query === name)
  const nameTokens = tokens(exercise.name)
  const metadataTokens = tokens([exercise.equipment, exercise.muscleGroup, exercise.primaryMuscleDetail].filter(Boolean).join(' '))
  const searchable = [...new Set([...nameTokens, ...metadataTokens])]
  const queryTokens = [...new Set(tokens([item.exerciseName, item.sourceText, item.equipment, item.muscle].filter(Boolean).join(' ')))]
  if (!queryTokens.length) return exact ? { exercise, score: 1_000, queryCoverage: 1, nameCoverage: 1, matchedQueryTokens: 0, queryTokenCount: 0, equipmentMatch: false, exact } : undefined
  const matchedQueryTokens = queryTokens.filter((queryToken) => searchable.some((candidateToken) => tokenMatches(queryToken, candidateToken))).length
  if (!exact && matchedQueryTokens === 0) return undefined
  const matchedNameTokens = nameTokens.filter((candidateToken) => queryTokens.some((queryToken) => tokenMatches(queryToken, candidateToken))).length
  const queryCoverage = matchedQueryTokens / queryTokens.length
  const nameCoverage = nameTokens.length ? matchedNameTokens / nameTokens.length : 0
  const requestedEquipment = mentionedEquipment([item.exerciseName, item.sourceText, item.equipment].filter(Boolean).join(' '))
  const candidateEquipment = mentionedEquipment(exercise.equipment ?? exercise.name)
  const equipmentMatch = requestedEquipment.some((family) => candidateEquipment.includes(family))
  const equipmentConflict = requestedEquipment.length > 0 && candidateEquipment.length > 0 && !equipmentMatch
  if (!exact && equipmentConflict) return undefined
  const extraNameTokens = Math.max(0, nameTokens.length - matchedNameTokens)
  const score = (exact ? 1_000 : 0)
    + matchedNameTokens * 34
    + (matchedQueryTokens - matchedNameTokens) * 12
    + Math.round(queryCoverage * 30)
    + Math.round(nameCoverage * 24)
    + (equipmentMatch ? 28 : 0)
    - extraNameTokens * 4
    + (exercise.source === 'custom' ? 2 : 0)
  return { exercise, score, queryCoverage, nameCoverage, matchedQueryTokens, queryTokenCount: queryTokens.length, equipmentMatch, exact }
}

function rankedMatches(item: Pick<ExtractedWorkoutItem, 'sourceText' | 'exerciseName' | 'equipment' | 'muscle'>, catalog: readonly WorkoutParserExercise[]): RankedMatch[] {
  return catalog.flatMap((exercise) => {
    const match = rankExercise(item, exercise)
    return match ? [match] : []
  }).sort((left, right) => right.score - left.score || left.exercise.name.localeCompare(right.exercise.name, 'ru'))
}

function matchExtractedItem(item: ExtractedWorkoutItem, catalog: readonly WorkoutParserExercise[]): ParsedWorkoutItem | UnmatchedWorkoutItem {
  const matches = rankedMatches(item, catalog)
  const exact = matches.filter((match) => match.exact)
  if (exact.length === 1) return { sourceText: item.sourceText, exerciseRef: exact[0]!.exercise.ref, confidence: 1, sets: item.sets, position: item.position }
  const [first, second] = matches
  const safelyDistinct = first !== undefined
    && !first.exact
    && first.matchedQueryTokens >= 2
    && first.queryCoverage >= 0.6
    && (first.nameCoverage >= 0.7 || (first.equipmentMatch && first.queryTokenCount >= 3 && first.nameCoverage >= 0.6))
    && first.score >= 85
    && (second === undefined || first.score - second.score >= 20)
  if (safelyDistinct) return { sourceText: item.sourceText, exerciseRef: first.exercise.ref, confidence: 0.99, sets: item.sets, position: item.position }
  return {
    sourceText: item.sourceText,
    reason: exact.length > 1 || matches.length > 1 ? 'Нужно уточнить вариант упражнения' : 'Не найдено в каталоге',
    suggestedExerciseRefs: (exact.length > 1 ? exact : matches).slice(0, 4).map((match) => match.exercise.ref),
    sets: item.sets,
    position: item.position,
  }
}

export function matchWorkoutExtraction(extracted: ExtractedWorkout, catalog: readonly WorkoutParserExercise[]): WorkoutParseResponse {
  const items: ParsedWorkoutItem[] = []
  const unmatched: UnmatchedWorkoutItem[] = []
  for (const item of extracted.items) {
    const match = matchExtractedItem(item, catalog)
    if ('exerciseRef' in match) items.push(match)
    else unmatched.push(match)
  }
  for (const item of extracted.unmatched) {
    const suggestions = rankedMatches({ sourceText: item.sourceText, exerciseName: item.sourceText }, catalog).slice(0, 4)
    unmatched.push({
      sourceText: item.sourceText,
      reason: item.reason,
      suggestedExerciseRefs: suggestions.map((match) => match.exercise.ref),
      position: item.position,
    })
  }
  return {
    items: items.sort((left, right) => (left.position ?? 0) - (right.position ?? 0)),
    unmatched: unmatched.sort((left, right) => (left.position ?? 0) - (right.position ?? 0)),
  }
}
