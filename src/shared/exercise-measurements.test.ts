import { describe, expect, it } from 'vitest'
import { SYSTEM_EXERCISE_CATALOG } from './system-exercises'
import { correctedExerciseInputKind } from './exercise-metric-corrections'
import { allowsDurationWeight, allowsRepetitionTimeChoice, exerciseSetColumnLabels, isLoadedDistance, LOADED_DISTANCE_EXERCISE_REFS } from './exercise-measurements'

describe('reviewed loaded exercise measurements', () => {
  it.each(['vital-walking-lunge-ex270', 'vital-lunge-forward-ex314', 'vital-reverse-lunge-ex322', 'vital-side-lunge-ex325', 'vital-curtsy-lunge-ex244', 'vital-stepup-ex332', 'vital-gym-pro-r303-1645'])('%s defaults to kilograms and repetitions', (ref) => {
    expect(SYSTEM_EXERCISE_CATALOG.find((item) => item.ref === ref)?.inputKind).toBe('strength')
  })
  it.each(['vital-barbell-hold-ex010', 'vital-gym-pro-r003-0006', 'vital-gym-pro-r289-1625'])('%s records kilograms and holding time', (ref) => {
    const exercise = SYSTEM_EXERCISE_CATALOG.find((item) => item.ref === ref)!
    expect(exercise.inputKind).toBe('duration')
    expect(allowsDurationWeight(exercise)).toBe(true)
    expect(exerciseSetColumnLabels(exercise)).toEqual(['Кг', 'Время'])
  })
  it.each(LOADED_DISTANCE_EXERCISE_REFS)('%s records kilograms and distance', (ref) => {
    const exercise = SYSTEM_EXERCISE_CATALOG.find((item) => item.ref === ref)!
    expect(isLoadedDistance(exercise)).toBe(true)
    expect(exerciseSetColumnLabels(exercise)).toEqual(['Кг', 'Дистанц.'])
    expect(isLoadedDistance({ ...exercise, source: 'custom' })).toBe(false)
  })
  it('keeps an explicit ViPR interval mode without making other exercises configurable', () => {
    const timed = { source: 'system' as const, ref: 'vital-gym-pro-r303-1645', inputKind: 'duration' as const }
    expect(correctedExerciseInputKind(timed)).toBe('duration')
    expect(allowsRepetitionTimeChoice(timed)).toBe(true)
    expect(allowsDurationWeight(timed)).toBe(true)
    expect(allowsRepetitionTimeChoice({ ...timed, source: 'custom' })).toBe(false)
    expect(allowsDurationWeight({ ...timed, ref: 'plank' })).toBe(false)
    expect(isLoadedDistance({ ...timed, ref: 'running', inputKind: 'distance' })).toBe(false)
  })
})
