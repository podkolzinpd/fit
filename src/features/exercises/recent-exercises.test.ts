import { describe, expect, it } from 'vitest'
import type { ExerciseSnapshot } from '../../shared/domain'
import { pushRecent, resolveRecent } from './recent-exercises'

const ex = (ref: string, extra: Partial<ExerciseSnapshot> = {}): ExerciseSnapshot =>
  ({ source: 'system', ref, name: ref, muscleGroup: 'legs', inputKind: 'strength', ...extra })

describe('pushRecent', () => {
  it('добавляет ключ в начало', () => {
    expect(pushRecent(['a', 'b'], 'c')).toEqual(['c', 'a', 'b'])
  })
  it('поднимает существующий ключ наверх без дубля', () => {
    expect(pushRecent(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b'])
  })
  it('ограничивает длину до 8', () => {
    const out = pushRecent(['1', '2', '3', '4', '5', '6', '7', '8'], 'new')
    expect(out).toHaveLength(8)
    expect(out[0]).toBe('new')
    expect(out).not.toContain('8')
  })
})

describe('resolveRecent', () => {
  const catalog = [ex('squat'), ex('bench'), ex('row', { source: 'custom', customExerciseId: 'cust-1' })]
  it('разворачивает ключи в упражнения, сохраняя порядок', () => {
    expect(resolveRecent(['bench', 'squat'], catalog).map((e) => e.ref)).toEqual(['bench', 'squat'])
  })
  it('кастомные матчатся по customExerciseId', () => {
    expect(resolveRecent(['cust-1'], catalog).map((e) => e.ref)).toEqual(['row'])
  })
  it('отбрасывает ключи, которых нет в каталоге (архив/удаление)', () => {
    expect(resolveRecent(['bench', 'missing', 'squat'], catalog).map((e) => e.ref)).toEqual(['bench', 'squat'])
  })
})
