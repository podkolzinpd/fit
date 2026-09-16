import { qualityReplacementOptions } from './quality-patch.js'
import { PROGRAM_CATALOG } from './catalog.js'
import { readSavePlannedWorkoutRequest } from '../../planned-workout-request.js'
import { expect, it } from 'vitest'
import { fixture } from './fixtures.js'
import { assessProgramQuality } from './quality.js'
import { materializeProgram, validateProgramTemplate } from './generate.js'
import { programPlanFromTemplate, readProgramPlan } from './plan.js'

it('detects the observed push-heavy, no-aerobic endurance program without requiring a horizontal pull', () => {
  const { brief, template } = fixture(3)
  brief.goal = 'weight_loss'; brief.goalText = 'Похудение и выносливость'
  const refs = [
    ['barbell-squat', 'bench-press', 'lat-pulldown', 'plank'],
    ['romanian-deadlift', 'overhead-press', 'triceps-pushdown', 'plank'],
    ['leg-press', 'push-ups', 'lateral-raise', 'plank'],
  ]
  template.sessions.forEach((session, index) => { session.exercises = refs[index]!.map((exerciseRef) => ({
    exerciseRef, weeks: Array.from({ length: 4 }, () => ({ sets: exerciseRef === 'plank' ? 1 : 2, reps: exerciseRef === 'plank' ? null : 8, durationSec: exerciseRef === 'plank' ? 45 : null, restSec: 90, rpe: 6.5 })),
  })) })
  const result = assessProgramQuality(template, brief)
  expect(result.signals).toEqual(['push_dominates_pull', 'endurance_without_aerobic_work'])
  expect(result.weeks[0]).toMatchObject({ pushSets: 6, pullSets: 2, lowerSets: 6, aerobicMinutes: 0 })
  template.sessions[1]!.exercises[2]!.exerciseRef = 'lat-pulldown'
  expect(assessProgramQuality(template, brief).signals).not.toContain('push_dominates_pull')
})

it('materializes aerobic minutes as canonical timed distance exercise sets, without fictional distance or weight', () => {
  const { brief, template } = fixture(3)
  brief.durationMin = 90; brief.goalText = 'Выносливость'
  for (const session of template.sessions) session.exercises.push({ exerciseRef: 'walking', progressionNote: 'Держите разговорный темп; увеличивайте продолжительность при хорошем восстановлении.',
    weeks: [600, 720, 840, 900].map((durationSec) => ({ sets: 1, reps: null, durationSec, rpe: 4, restSec: 0 })),
  })
  const wire = programPlanFromTemplate(template)
  const checked = readProgramPlan(wire, brief, '2026-09-15')
  expect(wire.aerobicExercises).toHaveLength(3)
  expect(assessProgramQuality(checked, brief).weeks.map((week) => week.aerobicMinutes)).toEqual([30, 36, 42, 45])
  expect(assessProgramQuality(checked, brief).signals).toEqual([])
  const saved = materializeProgram(checked, brief, 'b3942b20-52a2-4d5d-9895-b3b63cf61442', 'generation').canonicalWorkouts
  expect(saved).toHaveLength(12)
  for (const workout of saved) expect(readSavePlannedWorkoutRequest(workout, null)).toBeDefined()
  expect(saved[0]!.exercises.at(-1)).toMatchObject({ ref: 'walking', inputKind: 'distance', sets: [{ durationSec: 600 }]  })
  expect(saved[0]!.exercises.at(-1)!.trainerComment).toContain('Аэробное усилие 4/10')
  expect(saved[0]!.exercises.at(-1)!.sets[0]).not.toHaveProperty('distanceKm')
  expect(saved[0]!.notes).toContain('целевое усилие 4/10')
})

it('includes aerobic work in total session time and rejects a dose in the wrong unit array', () => {
  const { brief, template } = fixture(1)
  brief.durationMin = 30
  template.sessions[0]!.exercises.push({ exerciseRef: 'walking', weeks: Array.from({ length: 4 }, () => ({ sets: 1, reps: null, durationSec: 1800, rpe: 4, restSec: 0 })) })
  expect(() => validateProgramTemplate(template, brief, '2026-09-15')).toThrow('program_validation_failed')
  const wire = programPlanFromTemplate(template)
  wire.exercises.push(wire.aerobicExercises.pop()!)
  expect(() => readProgramPlan(wire, brief, '2026-09-15')).toThrow(expect.objectContaining({ codes: ['invalid_exercise_input_kind'] }))
})

it('preserves advisory review findings through validation and schedule notes', () => {
  const { brief, template } = fixture(1)
  template.reviewNotes = ['Тренеру проверить распределение нагрузки.']
  const checked = validateProgramTemplate(template, brief, '2026-09-15')
  const result = materializeProgram(checked, brief, 'client', 'generation')
  expect(result.rationale).toContain(template.reviewNotes[0])
  expect(result.canonicalWorkouts[0]!.notes).toContain(template.reviewNotes[0])
})

it('counts only between-set rest, avoiding false rejection of a 30-minute session', () => {
  const { brief, template } = fixture(1)
  brief.durationMin = 30
  template.sessions[0]!.exercises = template.sessions[0]!.exercises.slice(0, 4)
  for (const exercise of template.sessions[0]!.exercises) exercise.weeks = Array.from({ length: 4 }, () => ({ sets: 2, reps: 10, durationSec: null, rpe: 6.5, restSec: 90 }))
  // 10 warm-up + 4 * (2 transition + 1 work + 1.5 between-set rest) = 28.
  expect(assessProgramQuality(template, brief).weeks[0]!.sessions[0]!.estimatedMinutes).toBe(28)
  expect(() => validateProgramTemplate(template, brief, '2026-09-15')).not.toThrow()
})

it('flags repeated knee-dominant leg work and unverified pull-ups as review questions, not mandatory exercise gates', () => {
  const { brief, template } = fixture(2)
  brief.experience = 'returning'; brief.goal = 'weight_loss'
  for (const session of template.sessions) {
    session.exercises = session.exercises.filter((exercise) => exercise.exerciseRef !== 'fedb-butt-lift-bridge')
    session.exercises.find((exercise) => exercise.exerciseRef === 'seated-cable-row')!.exerciseRef = 'pull-ups'
  }
  expect(assessProgramQuality(template, brief).signals).toEqual(['lower_body_only_knee_dominant', 'pullups_capacity_unverified'])
  expect(assessProgramQuality(template, brief, ['pull-ups']).signals).toEqual(['lower_body_only_knee_dominant'])
  expect(() => validateProgramTemplate(template, brief, '2026-09-15')).not.toThrow()
})

it('excludes occupied exercises from each replacement choice after a time repair', () => {
  const { brief } = fixture(1)
  const options = qualityReplacementOptions({ exercises: [
    { weekday: 1, exerciseRef: 'pull-ups' }, { weekday: 1, exerciseRef: 'seated-cable-row' },
  ] }, PROGRAM_CATALOG, brief)
  const choices = options.find((row) => row.exerciseRef === 'pull-ups')!.allowedReplacementRefs
  expect(choices).not.toContain('seated-cable-row')
  expect(choices).not.toContain('walking')
  expect(choices).toContain('lat-pulldown')
})
