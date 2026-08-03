import type { ExerciseSnapshot, WorkoutExerciseDraft, WorkoutSetDraft } from '../../shared/domain'

const numberWords: Record<string, number> = { один: 1, одна: 1, два: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10 }

function norm(value: string) {
  return value.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim()
}

function number(value: string | undefined) {
  if (!value) return undefined
  return Number(value) || numberWords[norm(value)]
}

function matchExercise(text: string, catalog: readonly ExerciseSnapshot[]) {
  const value = norm(text)
  return [...catalog].sort((a, b) => norm(b.name).length - norm(a.name).length).find((item) => value.includes(norm(item.name)))
}

export function parseWorkoutText(text: string, catalog: readonly ExerciseSnapshot[]): WorkoutExerciseDraft[] {
  const chunks = text.split(/[\n.;]+/).map((item) => item.trim()).filter(Boolean)
  const result: WorkoutExerciseDraft[] = []
  for (const chunk of chunks) {
    const exercise = matchExercise(chunk, catalog)
    if (!exercise) continue
    const afterName = chunk.slice(chunk.toLocaleLowerCase('ru-RU').indexOf(exercise.name.toLocaleLowerCase('ru-RU')) + exercise.name.length)
    const values = [...afterName.matchAll(/(\d+(?:[.,]\d+)?|один|одна|два|три|четыре|пять|шесть|семь|восемь|девять|десять)/giu)].map((m) => number(m[1]))
    const setsCount = values[0] ?? 1
    const second = values[1]
    const third = values[2]
    const weight = /кг|килограмм/iu.test(afterName) ? (third ?? second) : undefined
    const reps = /повт|раз|повтор/iu.test(afterName) ? (weight === undefined ? second : second) : undefined
    const seconds = /сек|с\b/iu.test(afterName) ? (third ?? second) : undefined
    const setCount = Math.max(1, Math.min(20, setsCount))
    const sets: WorkoutSetDraft[] = Array.from({ length: setCount }, (_, position) => ({
      position,
      weightKg: weight,
      reps: exercise.inputKind === 'strength' ? reps : undefined,
      durationMin: seconds === undefined ? undefined : seconds / 60,
    }))
    result.push({ ...exercise, position: result.length, blockId: crypto.randomUUID(), blockType: 'single', blockPreset: 'set', blockRounds: 1, restBetweenExercisesSec: 0, restBetweenRoundsSec: 90, restBetweenSetsSec: 90, sets })
  }
  return result
}
