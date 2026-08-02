import type { ExerciseSnapshot } from '../../shared/domain'
import { MUSCLE_GROUP_LABELS } from '../../shared/system-exercises'

// Разговорные варианты, которыми тренеры обычно называют базовые упражнения.
// Каталожное название не меняем: эти слова участвуют только в поиске.
const SEARCH_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'barbell-squat': ['классический присед', 'скват'],
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
  running: ['беговая дорожка', 'дорожка'],
  'stationary-bike': ['велосипед', 'вело'],
  elliptical: ['эллипсоид'],
  'rowing-machine': ['гребля'],
  walking: ['дорожка ходьба'],
  'jump-rope': ['скакалка'],
}

export function normalizeExerciseSearch(value: string): string {
  return value
    .toLocaleLowerCase('ru')
    .replaceAll('ё', 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
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
