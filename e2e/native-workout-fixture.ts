import { createHash } from 'node:crypto'
import type { Page, Route } from '@playwright/test'
import type { YandexPilotTrainingData } from '../src/data/repositories/yandex-pilot.repository'

type NativeWorkout = YandexPilotTrainingData['workouts'][number]
type NativeExercise = NativeWorkout['exercises'][number]
type NativeSet = NativeExercise['sets'][number]
const trainerId = '90000000-0000-4000-8000-000000000009'
const clientId = '11111111-1111-4111-8111-111111111111'
const emptyValues = { weightKg: null, reps: null, durationMin: null, durationSec: null, distanceKm: null, rpe: null }

export function fixtureUuid(value: string): string {
  if (/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) return value
  const hash = createHash('sha256').update(value).digest('hex')
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}

export function setFixture(input: Omit<Partial<NativeSet>, 'plan' | 'fact'> & { id: string; plan?: Partial<NativeSet['plan']>; fact?: Partial<NativeSet['fact']> }): NativeSet {
  return { position: 0, version: 1, confirmedAt: null, ...input, id: fixtureUuid(input.id), plan: { ...emptyValues, ...input.plan }, fact: { ...emptyValues, ...input.fact } }
}

export function exerciseFixture(input: Pick<NativeExercise, 'id'> & Partial<NativeExercise>): NativeExercise {
  return { position: 0, source: 'system', ref: 'bench-press', customExerciseId: null, name: 'Жим лёжа', muscleGroup: 'chest', inputKind: 'strength', blockType: 'single', blockPreset: 'set', blockRounds: 1, restBetweenExercisesSec: 0, restBetweenRoundsSec: 0, restBetweenSetsSec: 60, trainerComment: null, sets: [], ...input, id: fixtureUuid(input.id), blockId: fixtureUuid(input.blockId ?? `${input.id}-block`) }
}

export function workoutFixture(input: Pick<NativeWorkout, 'id'> & Partial<NativeWorkout>): NativeWorkout {
  return { trainerId, clientId, clientName: 'Анна Смирнова', createdBy: trainerId, startedBy: null, completedBy: null, workoutDate: '2026-08-10', startTime: null, endTime: null, status: 'done', notes: null, clientComment: null, sessionRpe: null, wellbeing: null, discomfort: null, feedbackSubmittedAt: null, trainerReaction: null, trainerReview: null, trainerReviewAuthorId: null, trainerReviewedAt: null, clientQuestion: null, clientQuestionAskedAt: null, clientQuestionResolvedAt: null, startedAt: null, completedAt: null, version: 1, ...input, id: fixtureUuid(input.id), exercises: (input.exercises ?? []).map(exercise => exerciseFixture({ ...exercise, sets: exercise.sets.map(setFixture) })) }
}

export async function fulfillTrainingData(route: Route, rows: NativeWorkout[]): Promise<void> {
  const params = new URL(route.request().url()).searchParams
  const selected = rows.filter(row => (!params.get('from') || row.workoutDate >= params.get('from')!) && (!params.get('to') || row.workoutDate <= params.get('to')!) && (!params.get('workoutId') || row.id === params.get('workoutId')) && (!params.get('clientId') || row.clientId === params.get('clientId')))
  const offset = Number(params.get('offset') ?? 0)
  const limit = Number(params.get('limit') ?? 100)
  await route.fulfill({ json: { accessMode: 'read_only', customExercises: [], attention: [], attentionPreferences: [], workouts: selected.slice(offset, offset + limit).map(workoutFixture), hasMoreWorkouts: offset + limit < selected.length, totalWorkouts: selected.length } })
}

export async function mockWorkoutHistory(page: Page, rows: NativeWorkout[]): Promise<void> {
  await page.route('**/v1/training-data?*', route => fulfillTrainingData(route, rows))
}

export function trainingPageParams(route: Route) {
  const params = new URL(route.request().url()).searchParams
  return { from: params.get('from') ?? undefined, to: params.get('to') ?? undefined, offset: Number(params.get('offset') ?? 0), limit: Number(params.get('limit') ?? 100), clientId: params.get('clientId') ?? undefined, workoutId: params.get('workoutId') ?? undefined }
}
