import type { ExerciseSnapshot } from '../../shared/domain'

// Недавно использованные упражнения храним локально на устройстве (без БД):
// список ref, most-recent-first, без дублей, ограниченный по длине. Работает
// для всех клиентов и одинаково в форме плана и в live.
const STORAGE_KEY = 'fit.recent-exercises'
const MAX_RECENT = 8

// Ключ упражнения (системное по ref, кастомное по customExerciseId).
function keyOf(exercise: Pick<ExerciseSnapshot, 'ref' | 'customExerciseId'>): string {
  return exercise.customExerciseId ?? exercise.ref
}

// Чистая функция обновления списка: добавляет ключ в начало, убирает дубль,
// обрезает до MAX_RECENT. Тестируется независимо от localStorage.
export function pushRecent(current: readonly string[], key: string): string[] {
  return [key, ...current.filter((item) => item !== key)].slice(0, MAX_RECENT)
}

// Разворачивает ключи в упражнения каталога, сохраняя порядок недавних и
// отбрасывая те, которых уже нет в каталоге (архив/удаление).
export function resolveRecent(
  keys: readonly string[],
  catalog: readonly ExerciseSnapshot[],
): ExerciseSnapshot[] {
  const byKey = new Map(catalog.map((exercise) => [keyOf(exercise), exercise]))
  return keys.map((key) => byKey.get(key)).filter((exercise): exercise is ExerciseSnapshot => exercise !== undefined)
}

function read(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export function readRecentKeys(): string[] {
  return read()
}

export function recordRecent(exercise: Pick<ExerciseSnapshot, 'ref' | 'customExerciseId'>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pushRecent(read(), keyOf(exercise))))
  } catch {
    // localStorage недоступен (приватный режим) — недавние просто не сохраняются.
  }
}
