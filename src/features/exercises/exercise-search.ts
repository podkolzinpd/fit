import type { ExerciseSnapshot } from '../../shared/domain'
import { MUSCLE_GROUP_LABELS, SYSTEM_EXERCISE_LEGACY_CATALOG } from '../../shared/system-exercises'
import { COMPATIBLE_EXERCISE_REPLACEMENTS } from '../../shared/exercise-catalog-curation'

// Разговорные варианты, которыми тренеры обычно называют базовые упражнения.
// Каталожное название не меняем: эти слова участвуют только в поиске.
export const ORIGINAL_SEARCH_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'barbell-squat': ['классический присед', 'приседания', 'присед штанга', 'скват'],
  'front-squat': ['фронтальный', 'фронт скват'],
  'leg-press': ['платформа', 'жим платформы', 'жим платформы ногами'],
  'romanian-deadlift': ['румынка', 'рдл', 'румынская'],
  'stiff-leg-deadlift': ['тяга на прямых', 'мертвая тяга'],
  'fedb-stiff-legged-dumbbell-deadlift': ['становая с гантелями', 'становая гантели'],
  'bulgarian-split-squat': ['болгарские', 'болгары', 'болгарские выпады', 'сплит присед'],
  'leg-curl': ['сгибания лежа', 'бицепс бедра', 'сгибание ног в тренажере'],
  'leg-extension': ['разгибания', 'разгибания ног', 'разгибания ног сидя', 'квадрицепс'],
  'calf-raise': ['икры', 'подъемы на икры'],
  hyperextension: ['гипер', 'гиперы', 'гиперэкстензия с блином', 'гипер с блином'],
  'bench-press': ['жим штанги лежа', 'горизонтальный жим'],
  'dumbbell-bench-press': ['жим гантелей', 'гантели лежа'],
  'incline-bench-press': ['наклонный жим', 'верх груди'],
  'fedb-incline-dumbbell-press': ['жим гантелей на наклон', 'жим гантелей наклон', 'жим гантелей на наклонной скамье', 'жим гантелей в наклонной скамье', 'наклон гантели', 'гантели на наклонной', 'гантели верх груди', 'наклонные гантели', 'инклайн гантели', 'дб инклайн жим'],
  'fedb-hammer-grip-incline-db-bench-press': ['жим гантелей на наклон нейтральным', 'наклонные гантели нейтральным хватом', 'жим гантелей молотком на наклонной'],
  'fedb-incline-dumbbell-bench-with-palms-facing-in': ['жим гантелей на наклон ладонями внутрь', 'наклонные гантели ладони внутрь'],
  'dumbbell-fly': ['разводки', 'махи на грудь'],
  'push-ups': ['отжимашки'],
  dips: ['брусья'],
  'pec-deck': ['бабочка', 'пек дек'],
  'barbell-row': ['тяга в наклоне', 'тяга штанги к поясу'],
  'dumbbell-row': ['тяга гантели в наклоне'],
  'pull-ups': ['турник'],
  'lat-pulldown': ['вертикальная тяга', 'верхняя тяга', 'вертикальный блок'],
  'seated-cable-row': ['горизонтальная тяга', 'горизонтальный блок', 'нижняя тяга', 'тяга горизонтального блока'],
  deadlift: ['становая', 'классическая тяга'],
  'overhead-press': ['армейский жим', 'жим над головой'],
  'seated-dumbbell-press': ['жим гантелей вверх'],
  'lateral-raise': ['махи в стороны', 'махи на среднюю дельту', 'отведения на среднюю дельту с гантелями', 'средняя дельта'],
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
    'интервальный бег', 'интервалы бег', 'легкий бег', 'лёгкий бег',
    'длительный бег', 'темповый бег', 'восстановительный бег',
  ],
  'running-high-knees': ['сбу высокое бедро', 'высокое поднимание бедра'],
  'running-butt-kicks': ['сбу захлест', 'сбу захлёст', 'захлест голени'],
  'running-ankling': ['сбу семенящий', 'семенящий'],
  'running-bounds': ['сбу прыжки', 'многоскоки'],
  'stationary-bike': ['велосипед', 'вело', 'велик', 'сайкл', 'спинбайк'],
  elliptical: ['эллипсоид', 'эллипс', 'орбитрек'],
  'rowing-machine': ['гребля', 'гребной', 'гребной тренажер', 'гребной эргометр', 'эргометр', 'роуэр', 'rower'],
  walking: ['прогулка', 'ходьба пешком'],
  'jump-rope': ['скакалка'],
  'fedb-smith-machine-squat': ['присед в смите', 'смит присед', 'присед смит'],
  'fedb-smith-machine-bench-press': ['жим в смите', 'смит жим'],
  'fedb-leg-press': ['жим в тренажере', 'платформа ногами'],
  'fedb-hack-squat': ['хак', 'хак присед', 'гакк присед'],
  'fedb-goblet-squat': ['присед с гирей', 'приседания с гирей'],
  'fedb-dumbbell-lunges': ['выпады с гантелями', 'выпады гантели'],
  'fedb-thigh-adductor': ['сведение ног', 'сведение ног в тренажере'],
  'fedb-thigh-abductor': ['разведение ног', 'разведение ног в тренажере', 'отведения сидя в тренажере', 'отведение ног сидя'],
  'fedb-barbell-hip-thrust': ['хиптраст', 'хип траст', 'ягодичный мост со штангой'],
  'fedb-butt-lift-bridge': ['ягодичный мост', 'ягодичный мостик', 'глют бридж'],
  'fedb-cable-pull-through': ['пултру', 'пул тру', 'тяга между ног'],
  'fedb-sumo-deadlift': ['сумо', 'сумо тяга'],
  'fedb-lat-pulldown': ['верхний блок', 'тяга сверху'],
  'fedb-chest-supported-row': ['тяга с упором грудью', 'тяга к груди в тренажере'],
  'fedb-bent-over-two-arm-long-bar-row': ['т-гриф', 'т тяга', 'тяга т грифа', 'т бар', 'тяга т бар'],
  'fedb-face-pull': ['фейс пул', 'фейспул', 'тяга к лицу'],
  'fedb-close-grip-front-lat-pulldown': ['вертикальная тяга узкая', 'вертикальная тяга узким хватом', 'верхняя тяга узким хватом'],
  'fedb-smith-single-leg-split-squat': ['выпад в смите', 'выпады в смите', 'выпад смит', 'сплит выпад в смите', 'выпад в смите на каждую ногу на прямую'],
  'fedb-straight-arm-pulldown': ['тяга рейдера', 'тяга райдера', 'рейдер', 'райдер', 'тяга рейдера хват узко w образная рукоять'],
  'fedb-cable-rope-rear-delt-rows': ['тяга назад с косичкой', 'тяга косички назад', 'косичка на заднюю дельту'],
  'fedb-smith-machine-overhead-shoulder-press': ['жим на плечи в смите', 'жим плечи смит', 'плечевой жим в смите'],
  'fedb-upright-cable-row': ['протяжка с нижнего блока', 'протяжка с нижнего блока широким хватом', 'протяжка в кроссовере'],
  'fedb-alternating-deltoid-raise': ['подъем гантелей перед собой поочередно', 'подъем гантелей перед собой поочередно кисти смотрят в пол'],
  'fedb-one-legged-cable-kickback': ['махи назад в кроссовере', 'мах ногой назад в кроссовере', 'отведение ноги назад в кроссовере'],
  'fedb-cable-lateral-raise': ['мах в кроссовере', 'разводка в кроссовере'],
  'fedb-reverse-pec-deck': ['обратная бабочка', 'задняя дельта в бабочке'],
  'fedb-triceps-rope-pushdown': ['канат', 'канат трицепс', 'разгибание канатом'],
  'fedb-overhead-rope-extension': ['канат из-за головы', 'разгибание из за головы'],
  'fedb-preacher-curl': ['скамья скотта', 'бицепс скотт'],
  'fedb-concentration-curl': ['концентрированный бицепс', 'концентрированные сгибания'],
  'vital-air-bike-sprint': ['аэробайк', 'эйрбайк', 'airbike', 'air bike', 'ассолт байк', 'assault bike'],
  'vital-barbell-march': ['марш со штангой', 'ходьба со штангой на месте'],
  'vital-barbell-reverse-lunge': ['обратные выпады со штангой', 'выпады назад со штангой'],
  'vital-dumbbell-bulgarian-split-squat': ['болгарские с гантелями', 'болгарский присед гантели'],
  'vital-dumbbell-goblet-squat': ['гоблет с гантелью', 'кубковый присед с гантелью'],
  'vital-dumbbell-jump-squat': ['прыжковый присед с гантелями', 'присед прыжок гантели'],
  'vital-kettlebell-march': ['марш с гирей', 'ходьба с гирей на месте'],
  'vital-diagonal-kettlebell-lift': ['диагональный подъем гири', 'подъем гири по диагонали'],
  'vital-kettlebell-swing': ['мах гири', 'махи гирей', 'свинг с гирей', 'kettlebell swing'],
  'vital-treadmill-running': ['беговая дорожка', 'бег на дорожке', 'тредмил', 'тредмилл'],
  'vital-stair-climber': ['лестница', 'лестничный тренажер', 'степмилл', 'стэйрмастер', 'stairmaster', 'stepmill'],
  'vital-stepper-machine': ['степпер', 'шаговый тренажер'],
  'vital-smith-stiff-leg-deadlift': ['становая в смите', 'тяга на прямых ногах в смите'],
  'vital-treadmill-walking': ['ходьба на дорожке', 'дорожка ходьба'],
  'vital-standing-dumbbell-press': ['жим гантелей стоя', 'жим гантелей над головой стоя'],
  'vital-plate-front-raise': ['подъем блина перед собой', 'подъем диска перед собой'],
  'vital-single-arm-kettlebell-press': ['жим гири стоя', 'жим гири одной рукой'],
  'vital-cable-cross-lateral-raise': ['разводка в кроссовере стоя', 'махи в стороны в кроссовере'],
  'vital-machine-lateral-raise': ['разводка на среднюю дельту в тренажере', 'махи в тренажере'],
  'vital-smith-seated-military-press': ['армейский жим в смите', 'жим сидя в смите'],
  'vital-reverse-pec-deck': ['обратная бабочка', 'задняя дельта в бабочке', 'обратный пек дек', 'отведения в пек деке', 'отведение рук в пек деке'],
  'smith-single-leg-romanian-deadlift': ['журавлик в смите', 'журавль в смите', 'журавлик смит', 'румынская тяга на одной ноге в смите'],
  'fedb-recumbent-bike': ['горизонтальный велосипед', 'лежачий велосипед', 'лежачий велотренажер'],
  'fedb-trap-bar-deadlift': ['трэп гриф', 'треп гриф', 'становая с трэп грифом', 'хекс бар'],
  'fedb-muscle-up': ['выход силой', 'выход на две'],
  'fedb-front-box-jump': ['запрыгивание на тумбу', 'прыжок на тумбу'],
  'fedb-yoke-walk': ['коромысло', 'прогулка с коромыслом', 'йок'],
  'fedb-tire-flip': ['покрышка', 'кантовка покрышки', 'переворот шины'],
  'fedb-hamstring-smr': ['ролл бицепса бедра', 'мфр задней поверхности бедра'],
  'fedb-clean-and-jerk': ['толчок', 'взятие и толчок'],
  'fedb-snatch': ['рывок', 'рывок штанги'],
}

// Preserve the complete hand-reviewed dictionary and old visible names. Only
// compatible duplicates inherit exact phrases; variants keep their own match
// and recording units. Nothing here upgrades generated hints to exact aliases.
export const SEARCH_ALIASES: Readonly<Record<string, readonly string[]>> = (() => {
  const aliases = new Map<string, Set<string>>(Object.entries(ORIGINAL_SEARCH_ALIASES).map(([ref, phrases]) => [ref, new Set(phrases)]))
  for (const exercise of SYSTEM_EXERCISE_LEGACY_CATALOG) {
    const phrases = aliases.get(exercise.ref) ?? new Set<string>()
    phrases.add(exercise.name)
    phrases.add(exercise.name.replace(/\s*\([^)]*\)\s*$/, '').trim())
    aliases.set(exercise.ref, phrases)
  }
  for (const [ref, target] of Object.entries(COMPATIBLE_EXERCISE_REPLACEMENTS)) {
    const targetPhrases = aliases.get(target) ?? new Set<string>()
    for (const phrase of aliases.get(ref) ?? []) targetPhrases.add(phrase)
    aliases.set(target, targetPhrases)
  }
  return Object.fromEntries([...aliases].map(([ref, phrases]) => [ref, [...phrases]]))
})()

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
  db: 'гантели', дб: 'гантели', dumbbell: 'гантели', dumbbells: 'гантели',
  bb: 'штанга', barbell: 'штанга',
  smith: 'смит', hack: 'хак', squat: 'присед', press: 'жим', incline: 'наклон', row: 'тяга', curl: 'сгибания', extension: 'разгибание',
  гант: 'гантели', гантель: 'гантели', гантелей: 'гантели', гантелями: 'гантели', гантелях: 'гантели',
  штанги: 'штанга', штангой: 'штанга', штанге: 'штанга',
  гири: 'гиря', гирей: 'гиря', гирями: 'гиря',
  смита: 'смит', смите: 'смит', смитом: 'смит',
  тренажера: 'тренажер', тренажере: 'тренажер', тренажером: 'тренажер', тренажеры: 'тренажер',
  блока: 'блок', блоке: 'блок', блоком: 'блок',
  кроссовера: 'кроссовер', кроссовере: 'кроссовер', кроссовером: 'кроссовер',
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

// Эти варианты расширяют только поиск и подсказки. В отличие от ручного
// SEARCH_ALIASES они никогда сами по себе не дают права молча выбрать
// упражнение: совпадение нужно подтвердить. Так весь каталог получает
// разговорный охват без словаря из сотен почти одинаковых строк.
const GENERATED_SEARCH_VARIANT_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bтренажер\b/gu, 'машина'],
  [/\bсвое тело\b/gu, 'без оборудования'],
  [/\bгантели\b/gu, 'дб'],
  [/\bгантель\b/gu, 'дб'],
  [/\bштанга\b/gu, 'гриф'],
  [/\bсмит\b/gu, 'машина смита'],
  [/\bблок\b/gu, 'кроссовер'],
  [/\bподъем\b/gu, 'подъемы'],
  [/\bсгибание\b/gu, 'сгибания'],
  [/\bразгибание\b/gu, 'разгибания'],
  [/\bразведение\b/gu, 'разводка'],
  [/\bразводка\b/gu, 'разведения'],
  [/\bвыпад\b/gu, 'выпады'],
  [/\bприседание\b/gu, 'присед'],
]

/**
 * Полный набор фраз для поиска одного упражнения. Ручные варианты отвечают за
 * точный сленг, сгенерированные — за формы слов и оборудование во всём каталоге.
 */
function nameWithoutEquipmentLabel(exercise: ExerciseSnapshot): string {
  const suffix = exercise.name.match(/\s*\(([^)]*)\)\s*$/u)
  // Parentheses can describe a real variant (e.g. powerlifting), not equipment.
  // Stripping those would make the variant an exact alias of the base movement.
  return suffix && (normalizeExerciseSearch(suffix[1]!) === normalizeExerciseSearch(exercise.equipment ?? '')
    || /^(?:своё тело|свое тело|без оборудования)$/iu.test(suffix[1]!))
    ? exercise.name.slice(0, suffix.index).trim() : exercise.name.trim()
}

export function exerciseSearchAliases(exercise: ExerciseSnapshot): readonly string[] {
  const nameWithoutLabel = nameWithoutEquipmentLabel(exercise)
  const normalizedName = normalizeExerciseSearch(nameWithoutLabel)
  const aliases = new Set<string>(exercise.source === 'system' ? SEARCH_ALIASES[exercise.ref] ?? [] : [])
  // Old generated English names/forms remain search hints, never exact matches.
  if (exercise.source === 'system') {
    for (const [ref, target] of Object.entries(COMPATIBLE_EXERCISE_REPLACEMENTS)) {
      if (target !== exercise.ref) continue
      const original = SYSTEM_EXERCISE_LEGACY_CATALOG.find((item) => item.ref === ref)
      if (original) for (const phrase of legacySearchHints(original)) aliases.add(phrase)
    }
    const original = SYSTEM_EXERCISE_LEGACY_CATALOG.find((item) => item.ref === exercise.ref)
    if (original) for (const phrase of legacySearchHints(original)) aliases.add(phrase)
  }
  const muscleGroup = MUSCLE_GROUP_LABELS[exercise.muscleGroup]
  if (normalizedName) aliases.add(`${normalizedName} ${normalizeExerciseSearch(muscleGroup)}`)
  if (exercise.equipment) aliases.add(`${normalizedName} ${normalizeExerciseSearch(exercise.equipment)}`)
  // Импортированные ref сохраняют исходное английское название. Оно даёт
  // бесплатный англоязычный поиск по всему каталогу без передачи словаря LLM.
  if (exercise.source === 'system' && /^[a-z0-9-]+$/u.test(exercise.ref)) {
    aliases.add(exercise.ref.replace(/^(?:fedb|vital)-/u, '').replaceAll('-', ' '))
  }
  for (const [pattern, replacement] of GENERATED_SEARCH_VARIANT_RULES) {
    pattern.lastIndex = 0
    if (!pattern.test(normalizedName)) continue
    pattern.lastIndex = 0
    aliases.add(normalizedName.replace(pattern, replacement))
  }
  aliases.delete(nameWithoutLabel)
  aliases.delete(normalizedName)
  aliases.delete('')
  return [...aliases]
}

function legacySearchHints(exercise: ExerciseSnapshot): string[] {
  const name = normalizeExerciseSearch(nameWithoutEquipmentLabel(exercise))
  const hints = [exercise.ref.replace(/^(?:fedb|vital)-/u, '').replaceAll('-', ' '), `${name} ${normalizeExerciseSearch(MUSCLE_GROUP_LABELS[exercise.muscleGroup])}`]
  if (exercise.equipment) hints.push(`${name} ${normalizeExerciseSearch(exercise.equipment)}`)
  for (const [pattern, replacement] of GENERATED_SEARCH_VARIANT_RULES) {
    pattern.lastIndex = 0
    if (pattern.test(name)) { pattern.lastIndex = 0; hints.push(name.replace(pattern, replacement)) }
  }
  return hints
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

// Падежи и число нужны для поиска, но не должны превращать разные движения в
// одно каноническое имя. Поэтому лёгкий стемминг используется только при
// сопоставлении отдельных слов; автоматический выбор ниже опирается на точную
// или единственную почти точную фразу.
function searchTokenStem(token: string): string {
  if (token.length < 6) return token
  const suffixes = [
    'иями', 'ями', 'ами', 'его', 'ого', 'ему', 'ому', 'ыми', 'ими',
    'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ой', 'ей', 'ую', 'юю',
    'ах', 'ях', 'ам', 'ям', 'ом', 'ем', 'ов', 'ев',
    'ы', 'и', 'а', 'я', 'у', 'ю', 'е',
  ]
  const suffix = suffixes.find((candidate) => token.endsWith(candidate) && token.length - candidate.length >= 4)
  return suffix ? token.slice(0, -suffix.length) : token
}

function tokenMatches(queryToken: string, searchableTokens: readonly string[]): boolean {
  const queryStem = searchTokenStem(queryToken)
  return searchableTokens.some((token) => {
    const tokenStem = searchTokenStem(token)
    return token.includes(queryToken)
      || tokenStem === queryStem
      || (queryToken.length >= 5 && token.length >= 5 && editDistanceAtMostOne(queryToken, token))
  })
}

function isNearPhraseMatch(left: string, right: string): boolean {
  const leftTokens = left.split(/\s+/).filter(Boolean)
  const rightTokens = right.split(/\s+/).filter(Boolean)
  if (leftTokens.length !== rightTokens.length) return false
  let typoCount = 0
  for (let index = 0; index < leftTokens.length; index += 1) {
    const leftToken = leftTokens[index]!
    const rightToken = rightTokens[index]!
    if (leftToken === rightToken) continue
    if (leftToken.length < 5 || rightToken.length < 5 || !editDistanceAtMostOne(leftToken, rightToken)) return false
    typoCount += 1
  }
  return typoCount === 1
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
  match: 'exact' | 'search'
}

export interface ExerciseSearchOptions {
  /** Самое недавнее упражнение идёт первым, но не становится от этого точным. */
  preferredExerciseRefs?: readonly string[]
  /** Пользовательские упражнения выше равных системных вариантов. */
  customFirst?: boolean
}

export interface ExerciseSearchResolution {
  level: 'exact' | 'ambiguous' | 'search'
  matches: RankedExerciseMatch[]
}

interface ExerciseSearchIndex {
  name: string
  aliases: readonly string[]
  exactAliases: readonly string[]
  searchableTokens: readonly string[]
  nameTokens: readonly string[]
}

// Каталог просматривается при каждом символе в строке поиска. Его объекты
// стабильны, поэтому нормализуем постоянные поля один раз, а не заново для
// каждого запроса. WeakMap не удерживает удалённые пользовательские записи.
const exerciseSearchIndexCache = new WeakMap<ExerciseSnapshot, ExerciseSearchIndex>()

function getExerciseSearchIndex(exercise: ExerciseSnapshot): ExerciseSearchIndex {
  const cached = exerciseSearchIndexCache.get(exercise)
  if (cached) return cached
  const name = normalizeExerciseSearch(nameWithoutEquipmentLabel(exercise))
  const exactAliases = (exercise.source === 'system' ? SEARCH_ALIASES[exercise.ref] ?? [] : []).map(normalizeExerciseSearch)
  const aliases = exerciseSearchAliases(exercise).map(normalizeExerciseSearch)
  const searchableTokens = normalizeExerciseSearch([
    name,
    exercise.equipment ?? '',
    exercise.primaryMuscleDetail ?? '',
    MUSCLE_GROUP_LABELS[exercise.muscleGroup],
    ...aliases,
  ].join(' ')).split(/\s+/).filter(Boolean)
  const index = { name, aliases, exactAliases, searchableTokens, nameTokens: name.split(/\s+/) }
  exerciseSearchIndexCache.set(exercise, index)
  return index
}

/**
 * Ранжирование для свободного ввода. В отличие от фильтра, оно выбирает
 * базовый вариант, если тренер не назвал специальный хват/угол/технику.
 */
export function rankExerciseSearch(catalog: readonly ExerciseSnapshot[], search: string, options: ExerciseSearchOptions = {}): RankedExerciseMatch[] {
  const query = normalizeExerciseSearch(search)
  const queryTokens = query.split(/\s+/).filter(Boolean)
  if (!queryTokens.length) return []
  const preferredIndex = new Map((options.preferredExerciseRefs ?? []).map((ref, index) => [ref, index]))
  return catalog.flatMap((exercise) => {
    const { name, aliases: normalizedAliases, exactAliases, searchableTokens, nameTokens } = getExerciseSearchIndex(exercise)
    const matchedTokens = queryTokens.filter((token) => tokenMatches(token, searchableTokens))
    if (matchedTokens.length !== queryTokens.length) return []

    const exactAlias = exactAliases.some((alias) => alias === query || isNearPhraseMatch(alias, query))
    const exactName = name === query || isNearPhraseMatch(name, query)
    const inOrder = name.includes(query) || normalizedAliases.some((alias) => alias.includes(query))
    // Для короткого общего названия сперва показываем базовое движение:
    // «присед» → «Присед со штангой», а не один из частных вариантов.
    const startsWithQuery = name.startsWith(query)
    const omittedVariantTokens = nameTokens.filter((token) => OPTIONAL_VARIANT_TOKENS.has(token) && !queryTokens.some((queryToken) => tokenMatches(queryToken, [token])))
    const genericDefault = DEFAULT_GENERIC_QUERY_REFS[query] === exercise.ref
    const score = (exactName ? 240 : 0) + (exactAlias ? 220 : 0) + (genericDefault ? 180 : 0) + matchedTokens.length * 30 + (inOrder ? 24 : 0) + (startsWithQuery ? 28 : 0) - omittedVariantTokens.length * 18
    return [{ exercise, score, match: exactName || exactAlias ? 'exact' as const : 'search' as const }]
  }).sort((left, right) => {
    if (left.match !== right.match) return left.match === 'exact' ? -1 : 1
    const leftPreferred = preferredIndex.get(left.exercise.ref)
    const rightPreferred = preferredIndex.get(right.exercise.ref)
    if (leftPreferred !== undefined || rightPreferred !== undefined) {
      if (leftPreferred === undefined) return 1
      if (rightPreferred === undefined) return -1
      if (leftPreferred !== rightPreferred) return leftPreferred - rightPreferred
    }
    if ((options.customFirst ?? true) && left.exercise.source !== right.exercise.source) return left.exercise.source === 'custom' ? -1 : 1
    return right.score - left.score || left.exercise.name.localeCompare(right.exercise.name, 'ru')
  })
}

/**
 * Единый контракт поиска для picker и свободного ввода:
 * - exact — один точный или почти точный вариант, его можно подставить;
 * - ambiguous — несколько точных вариантов либо равные поисковые кандидаты;
 * - search — релевантные подсказки без права молчаливой подстановки.
 */
export function resolveExerciseSearch(catalog: readonly ExerciseSnapshot[], search: string, options: ExerciseSearchOptions = {}): ExerciseSearchResolution {
  const matches = rankExerciseSearch(catalog, search, options)
  const exact = matches.filter((candidate) => candidate.match === 'exact')
  if (exact.length === 1) return { level: 'exact', matches: exact }
  if (exact.length > 1) return { level: 'ambiguous', matches: exact }
  const [first, second] = matches
  if (first && second && first.score - second.score < 18) return { level: 'ambiguous', matches }
  return { level: 'search', matches }
}

export function matchesExerciseSearch(exercise: ExerciseSnapshot, search: string): boolean {
  const queryTokens = normalizeExerciseSearch(search).split(/\s+/).filter(Boolean)
  if (queryTokens.length === 0) return true
  const { searchableTokens } = getExerciseSearchIndex(exercise)
  return queryTokens.every((token) => tokenMatches(token, searchableTokens))
}

// Точное разговорное имя — достаточное основание для разбора записи без
// лишнего экрана выбора. Например «гребля 10 мин».
export function isExerciseSearchAlias(exercise: ExerciseSnapshot, search: string): boolean {
  const query = normalizeExerciseSearch(search)
  return Boolean(query) && (SEARCH_ALIASES[exercise.ref] ?? []).some((alias) => normalizeExerciseSearch(alias) === query)
}

export interface ExerciseSearchConflict {
  phrase: string
  exerciseRefs: string[]
}

/** Находит фразы, которые без подтверждения указывают на разные упражнения. */
export function exerciseSearchConflicts(catalog: readonly ExerciseSnapshot[]): ExerciseSearchConflict[] {
  const refsByPhrase = new Map<string, Set<string>>()
  for (const exercise of catalog) {
    const phrases = [exercise.name.replace(/\s*\([^)]*\)\s*$/, ''), ...(SEARCH_ALIASES[exercise.ref] ?? [])]
    for (const phrase of phrases) {
      const normalized = normalizeExerciseSearch(phrase)
      if (!normalized) continue
      const refs = refsByPhrase.get(normalized) ?? new Set<string>()
      refs.add(exercise.ref)
      refsByPhrase.set(normalized, refs)
    }
  }
  return [...refsByPhrase.entries()]
    .filter(([, refs]) => refs.size > 1)
    .map(([phrase, refs]) => ({ phrase, exerciseRefs: [...refs].sort() }))
    .sort((left, right) => left.phrase.localeCompare(right.phrase, 'ru'))
}
