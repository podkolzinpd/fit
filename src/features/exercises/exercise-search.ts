import type { ExerciseSnapshot } from '../../shared/domain'
import { MUSCLE_GROUP_LABELS } from '../../shared/system-exercises'

// Разговорные варианты, которыми тренеры обычно называют базовые упражнения.
// Каталожное название не меняем: эти слова участвуют только в поиске.
export const SEARCH_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'barbell-squat': ['классический присед', 'приседания', 'присед штанга', 'скват'],
  'front-squat': ['фронтальный', 'фронт скват'],
  'leg-press': ['платформа', 'жим платформы'],
  'romanian-deadlift': ['румынка', 'рдл'],
  'stiff-leg-deadlift': ['тяга на прямых', 'мертвая тяга'],
  'bulgarian-split-squat': ['болгарские', 'сплит присед'],
  'leg-curl': ['сгибания лежа', 'бицепс бедра'],
  'leg-extension': ['разгибания', 'квадрицепс'],
  'calf-raise': ['икры', 'подъемы на икры'],
  hyperextension: ['гипер', 'гиперы'],
  'bench-press': ['жим штанги лежа', 'горизонтальный жим'],
  'dumbbell-bench-press': ['жим гантелей', 'гантели лежа'],
  'incline-bench-press': ['наклонный жим', 'верх груди'],
  'fedb-incline-dumbbell-press': ['жим гантелей на наклон', 'жим гантелей наклон', 'наклон гантели', 'гантели на наклонной', 'гантели верх груди', 'наклонные гантели', 'инклайн гантели', 'дб инклайн жим'],
  'fedb-hammer-grip-incline-db-bench-press': ['жим гантелей на наклон нейтральным', 'наклонные гантели нейтральным хватом', 'жим гантелей молотком на наклонной'],
  'fedb-incline-dumbbell-bench-with-palms-facing-in': ['жим гантелей на наклон ладонями внутрь', 'наклонные гантели ладони внутрь'],
  'dumbbell-fly': ['разводки', 'махи на грудь'],
  'push-ups': ['отжимашки'],
  dips: ['брусья'],
  'pec-deck': ['бабочка', 'пек дек'],
  'barbell-row': ['тяга в наклоне', 'горизонтальная тяга'],
  'dumbbell-row': ['тяга гантели одной рукой'],
  'pull-ups': ['турник'],
  'lat-pulldown': ['вертикальная тяга', 'верхняя тяга'],
  'seated-cable-row': ['горизонтальный блок', 'нижняя тяга'],
  deadlift: ['становая', 'классическая тяга'],
  'overhead-press': ['армейский жим', 'жим над головой'],
  'seated-dumbbell-press': ['жим гантелей вверх'],
  'lateral-raise': ['махи в стороны', 'средняя дельта'],
  'rear-delt-fly': ['задняя дельта', 'махи в наклоне'],
  'upright-row': ['протяжка'],
  'biceps-curl': ['бицепс', 'сгибания рук'],
  'hammer-curl': ['молотки'],
  'barbell-curl': ['подъем на бицепс', 'пшнб'],
  'french-press': ['француз', 'френч пресс'],
  'triceps-pushdown': ['разгибание блока', 'канат на трицепс'],
  plank: ['планка на локтях'],
  crunches: ['пресс', 'скручивания на пресс'],
  'leg-raise': ['подъемы ног', 'пресс ноги'],
  'side-plank': ['планка боковая'],
  running: [
    'беговая дорожка', 'дорожка', 'беговая', 'тредмил', 'тредмилл',
    'интервальный бег', 'интервалы бег', 'легкий бег', 'лёгкий бег',
    'длительный бег', 'темповый бег', 'восстановительный бег',
  ],
  'running-high-knees': ['сбу высокое бедро', 'высокое поднимание бедра'],
  'running-butt-kicks': ['сбу захлест', 'сбу захлёст', 'захлест голени'],
  'running-ankling': ['сбу семенящий', 'семенящий'],
  'running-bounds': ['сбу прыжки', 'многоскоки'],
  'stationary-bike': ['велосипед', 'вело', 'велик', 'сайкл', 'спинбайк', 'airbike', 'ассолт байк'],
  elliptical: ['эллипсоид', 'эллипс', 'орбитрек'],
  'rowing-machine': ['гребля', 'гребной', 'гребной тренажер', 'гребной эргометр', 'эргометр', 'роуэр', 'rower'],
  walking: ['дорожка ходьба'],
  'jump-rope': ['скакалка'],
  'fedb-smith-machine-squat': ['присед в смите', 'смит присед', 'присед смит'],
  'fedb-smith-machine-bench-press': ['жим в смите', 'смит жим'],
  'fedb-leg-press': ['жим в тренажере', 'платформа ногами'],
  'fedb-hack-squat': ['хак', 'хак присед', 'гакк присед'],
  'fedb-barbell-hip-thrust': ['хиптраст', 'хип траст', 'ягодичный мост со штангой'],
  'fedb-butt-lift-bridge': ['ягодичный мост', 'глют бридж'],
  'fedb-cable-pull-through': ['пултру', 'пул тру', 'тяга между ног'],
  'fedb-sumo-deadlift': ['сумо', 'сумо тяга'],
  'fedb-lat-pulldown': ['верхний блок', 'тяга сверху'],
  'fedb-chest-supported-row': ['тяга с упором грудью', 'тяга к груди в тренажере'],
  'fedb-bent-over-two-arm-long-bar-row': ['т-гриф', 'т тяга', 'тяга т грифа', 'т бар', 'тяга т бар'],
  'fedb-face-pull': ['фейс пул', 'фейспул', 'тяга к лицу'],
  'fedb-cable-lateral-raise': ['мах в кроссовере', 'разводка в кроссовере'],
  'fedb-reverse-pec-deck': ['обратная бабочка', 'задняя дельта в бабочке'],
  'fedb-triceps-rope-pushdown': ['канат', 'канат трицепс', 'разгибание канатом'],
  'fedb-overhead-rope-extension': ['канат из-за головы', 'разгибание из за головы'],
  'fedb-preacher-curl': ['скамья скотта', 'бицепс скотт'],
  'fedb-concentration-curl': ['концентрированный бицепс', 'концентрированные сгибания'],
}

// Латиница и сокращения приходят как из заметок тренера, так и из голосового
// ввода. Приводим их к одному языку до поиска, не меняя названия в каталоге.
const SEARCH_PHRASE_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bhip\s*thrust\b/giu, 'хип траст'],
  [/\bface\s*pull\b/giu, 'фейс пул'],
  [/\blat\s*pull\s*down\b/giu, 'верхний блок'],
  [/\bt[\s-]*bar(?:\s*row)?\b/giu, 'тяга т грифа'],
  [/\bhack\s*squat\b/giu, 'хак присед'],
  [/\bromanian\s*deadlift\b/giu, 'румынка'],
]

const SEARCH_TOKEN_REPLACEMENTS: Readonly<Record<string, string>> = {
  db: 'гантели', dumbbell: 'гантели', dumbbells: 'гантели',
  bb: 'штанга', barbell: 'штанга',
  smith: 'смит', hack: 'хак', squat: 'присед', press: 'жим', incline: 'наклон', row: 'тяга', curl: 'сгибания', extension: 'разгибание',
  гант: 'гантели', гантель: 'гантели', гантелями: 'гантели',
  накл: 'наклон', инклайн: 'наклон',
  биц: 'бицепс', триц: 'трицепс',
  гакк: 'хак', гак: 'хак',
}

export function normalizeExerciseSearch(value: string): string {
  let normalized = value
    .toLocaleLowerCase('ru')
    .replaceAll('ё', 'е')
  for (const [pattern, replacement] of SEARCH_PHRASE_REPLACEMENTS) normalized = normalized.replace(pattern, replacement)
  return normalized
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .map((token) => SEARCH_TOKEN_REPLACEMENTS[token] ?? token)
    .join(' ')
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
  return true
}

function tokenMatches(queryToken: string, searchableTokens: readonly string[]): boolean {
  return searchableTokens.some((token) => token.includes(queryToken)
    || (queryToken.length >= 5 && token.length >= 5 && editDistanceAtMostOne(queryToken, token)))
}

const OPTIONAL_VARIANT_TOKENS = new Set([
  'нейтральным', 'нейтральный', 'ладонями', 'внутрь', 'наружу', 'отрицательным',
  'узким', 'широким', 'обратным', 'попеременный', 'одной', 'стоя', 'сидя',
])

// У общих названий есть ожидаемое базовое движение. Без этого большой
// импортированный каталог может поставить выше редкий вариант лишь по алфавиту.
// Это влияет только на порядок подсказок: короткий запрос всё равно не
// подставляется автоматически и требует подтверждения тренера.
const DEFAULT_GENERIC_QUERY_REFS: Readonly<Record<string, string>> = {
  присед: 'barbell-squat',
}

export interface RankedExerciseMatch {
  exercise: ExerciseSnapshot
  score: number
}

/**
 * Ранжирование для свободного ввода. В отличие от фильтра, оно выбирает
 * базовый вариант, если тренер не назвал специальный хват/угол/технику.
 */
export function rankExerciseSearch(catalog: readonly ExerciseSnapshot[], search: string): RankedExerciseMatch[] {
  const query = normalizeExerciseSearch(search)
  const queryTokens = query.split(/\s+/).filter(Boolean)
  if (!queryTokens.length) return []
  return catalog.flatMap((exercise) => {
    const name = normalizeExerciseSearch(exercise.name.replace(/\s*\([^)]*\)\s*$/, ''))
    const aliases = SEARCH_ALIASES[exercise.ref] ?? []
    const normalizedAliases = aliases.map(normalizeExerciseSearch)
    // Используем тот же набор полей, что и обычный фильтр каталога: запрос
    // «ноги тренажёр» должен находить упражнение даже если «ноги» указано
    // только как группа, а не в самом названии.
    const searchableTokens = normalizeExerciseSearch([
      name,
      exercise.equipment ?? '',
      exercise.primaryMuscleDetail ?? '',
      MUSCLE_GROUP_LABELS[exercise.muscleGroup],
      ...normalizedAliases,
    ].join(' ')).split(/\s+/).filter(Boolean)
    const matchedTokens = queryTokens.filter((token) => tokenMatches(token, searchableTokens))
    if (matchedTokens.length !== queryTokens.length) return []

    const exactAlias = normalizedAliases.includes(query)
    const exactName = name === query
    const inOrder = name.includes(query) || normalizedAliases.some((alias) => alias.includes(query))
    // Для короткого общего названия сперва показываем базовое движение:
    // «присед» → «Присед со штангой», а не один из частных вариантов.
    const startsWithQuery = name.startsWith(query)
    const nameTokens = name.split(/\s+/)
    const omittedVariantTokens = nameTokens.filter((token) => OPTIONAL_VARIANT_TOKENS.has(token) && !queryTokens.some((queryToken) => tokenMatches(queryToken, [token])))
    const genericDefault = DEFAULT_GENERIC_QUERY_REFS[query] === exercise.ref
    const score = (exactName ? 240 : 0) + (exactAlias ? 220 : 0) + (genericDefault ? 180 : 0) + matchedTokens.length * 30 + (inOrder ? 24 : 0) + (startsWithQuery ? 28 : 0) - omittedVariantTokens.length * 18
    return [{ exercise, score }]
  }).sort((left, right) => right.score - left.score || left.exercise.name.localeCompare(right.exercise.name, 'ru'))
}

export function matchesExerciseSearch(exercise: ExerciseSnapshot, search: string): boolean {
  const queryTokens = normalizeExerciseSearch(search).split(/\s+/).filter(Boolean)
  if (queryTokens.length === 0) return true
  const searchableText = [
    exercise.name,
    exercise.equipment,
    exercise.primaryMuscleDetail,
    MUSCLE_GROUP_LABELS[exercise.muscleGroup],
    ...(SEARCH_ALIASES[exercise.ref] ?? []),
  ].filter(Boolean).join(' ')
  const searchableTokens = normalizeExerciseSearch(searchableText).split(/\s+/).filter(Boolean)
  return queryTokens.every((token) => tokenMatches(token, searchableTokens))
}

// Точное разговорное имя — достаточное основание для разбора записи без
// лишнего экрана выбора. Например «гребля 10 мин».
export function isExerciseSearchAlias(exercise: ExerciseSnapshot, search: string): boolean {
  const query = normalizeExerciseSearch(search)
  return Boolean(query) && (SEARCH_ALIASES[exercise.ref] ?? []).some((alias) => normalizeExerciseSearch(alias) === query)
}
