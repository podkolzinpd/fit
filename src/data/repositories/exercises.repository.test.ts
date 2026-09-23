import { beforeEach, describe, expect, it, vi } from 'vitest'

const queries = vi.hoisted(() => ({
  createVitalMediaUrl: vi.fn(), createCustomExercisePhotoUrl: vi.fn(), parseWorkout: vi.fn(), suggestGoalCriteria: vi.fn(),
  list: vi.fn(), create: vi.fn(), update: vi.fn(), setArchived: vi.fn(),
}))
const media = vi.hoisted(() => ({ upload: vi.fn() }))
vi.mock('../queries/exercises.queries', () => ({ exerciseQueries: queries, customExerciseMedia: () => media }))

import { exercisesRepository } from './exercises.repository'

const row = {
  id: 'exercise-1', name: 'Болгарский присед', muscle_group: 'legs', input_kind: 'strength', created_by: 'trainer-1',
  archived_at: null, version: 1,
  primary_muscle_detail: 'Квадрицепс', equipment: 'Гантели', description: 'Задняя нога на скамье.',
  image_path: 'trainer-1/exercise-1.jpg',
}
const draft = { name: 'Болгарский присед', muscleGroup: 'legs' as const, inputKind: 'strength' as const, primaryMuscleDetail: 'Квадрицепс', equipment: 'Гантели', description: 'Задняя нога на скамье.' }
const photo = { dataUrl: 'data:image/jpeg;base64,AQID', mimeType: 'image/jpeg' as const, width: 800, height: 800, sizeBytes: 3 }

describe('exercisesRepository custom exercises', () => {
  beforeEach(() => {
    for (const mock of Object.values(queries)) mock.mockReset()
    media.upload.mockReset().mockResolvedValue({ data: { path: 'ignored' }, error: null })
  })

  it('maps classification, description and the stored photo path from the row', async () => {
    queries.list.mockResolvedValue({ data: [row], error: null })
    await expect(exercisesRepository.list()).resolves.toEqual([expect.objectContaining({
      primaryMuscleDetail: 'Квадрицепс', equipment: 'Гантели', description: 'Задняя нога на скамье.', imagePath: 'trainer-1/exercise-1.jpg',
    })])
  })

  it('creates without touching storage when no photo is given', async () => {
    queries.create.mockResolvedValue({ data: { ...row, image_path: null }, error: null })
    await exercisesRepository.create('trainer-1', 'trainer-1', draft)
    expect(media.upload).not.toHaveBeenCalled()
    expect(queries.create).toHaveBeenCalledWith('trainer-1', {
      id: undefined, name: 'Болгарский присед', muscle_group: 'legs', input_kind: 'strength',
      primary_muscle_detail: 'Квадрицепс', equipment: 'Гантели', description: 'Задняя нога на скамье.',
      image_path: null, image_mime_type: null, image_width: null, image_height: null, image_size_bytes: null,
    })
  })

  it('uploads the photo under the actor\'s own folder before inserting the row, using a fresh id for the path', async () => {
    queries.create.mockResolvedValue({ data: row, error: null })
    // A connected client (actorId) can author an exercise inside their trainer's partition (partitionOwnerId) —
    // the two differ, and the upload path must key off the actor, matching the storage RLS policy.
    await exercisesRepository.create('trainer-1', 'client-9', draft, photo)

    expect(media.upload).toHaveBeenCalledTimes(1)
    const [path, blob, options] = media.upload.mock.calls[0] as [string, Blob, { contentType: string; upsert: boolean }]
    expect(path).toMatch(/^client-9\/[0-9a-f-]{36}\.jpg$/)
    expect(blob).toEqual(expect.objectContaining({ type: 'image/jpeg', size: 3 }))
    expect(options).toEqual({ contentType: 'image/jpeg', upsert: false })

    const [, insertedValue] = queries.create.mock.calls[0] as [string, { id: string; image_path: string; image_mime_type: string; image_width: number; image_height: number; image_size_bytes: number }]
    expect(insertedValue.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(insertedValue).toMatchObject({ image_path: path, image_mime_type: 'image/jpeg', image_width: 800, image_height: 800, image_size_bytes: 3 })
  })

  it('does not insert the row when the photo upload fails', async () => {
    media.upload.mockResolvedValue({ data: null, error: { message: 'storage_error' } })
    await expect(exercisesRepository.create('trainer-1', 'trainer-1', draft, photo)).rejects.toThrow()
    expect(queries.create).not.toHaveBeenCalled()
  })

  it('signs the stored photo path for display', async () => {
    queries.createCustomExercisePhotoUrl.mockResolvedValue({ data: { signedUrl: 'https://signed.example/exercise-1.jpg' }, error: null })
    await expect(exercisesRepository.createCustomExercisePhotoUrl('trainer-1/exercise-1.jpg', 3600)).resolves.toBe('https://signed.example/exercise-1.jpg')
    expect(queries.createCustomExercisePhotoUrl).toHaveBeenCalledWith('trainer-1/exercise-1.jpg', 3600)
  })

  it('sends classification and description on update, without touching the photo', async () => {
    queries.update.mockResolvedValue({ data: row, error: null })
    const exercise = { id: 'exercise-1', version: 1 } as Parameters<typeof exercisesRepository.update>[0]
    await exercisesRepository.update(exercise, draft)
    expect(queries.update).toHaveBeenCalledWith('exercise-1', 1, {
      name: 'Болгарский присед', muscle_group: 'legs', input_kind: 'strength',
      primary_muscle_detail: 'Квадрицепс', equipment: 'Гантели', description: 'Задняя нога на скамье.',
    })
  })
})
