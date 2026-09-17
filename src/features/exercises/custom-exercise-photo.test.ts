import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { createCustomExercisePhotoUrl } = vi.hoisted(() => ({
  createCustomExercisePhotoUrl: vi.fn(),
}))

vi.mock('../../app/data-backend-context', () => ({
  useDataBackend: () => ({ exercises: { createCustomExercisePhotoUrl } }),
}))

import { useCustomExercisePhotoUrl } from './custom-exercise-photo'

describe('useCustomExercisePhotoUrl', () => {
  afterEach(() => {
    createCustomExercisePhotoUrl.mockReset()
  })

  it('resolves nothing without a path', () => {
    const { result } = renderHook(() => useCustomExercisePhotoUrl(null))
    expect(result.current).toBeUndefined()
    expect(createCustomExercisePhotoUrl).not.toHaveBeenCalled()
  })

  // Одна проверка на оба поведения: кэш живёт в модуле между рендерами (не
  // между тестами), так что переиспользование нужно доказать внутри одного
  // теста, иначе второй renderHook того же пути в отдельном тесте молча
  // попадёт в кэш, оставленный первым, и счётчик вызовов мока не сойдётся.
  it('signs the stored path for one hour and reuses the cached url on a second read', async () => {
    createCustomExercisePhotoUrl.mockResolvedValue('https://signed.example/exercise.jpg')
    const first = renderHook(() => useCustomExercisePhotoUrl('trainer-1/exercise-1.jpg'))
    await waitFor(() => expect(first.result.current).toBe('https://signed.example/exercise.jpg'))
    expect(createCustomExercisePhotoUrl).toHaveBeenCalledWith('trainer-1/exercise-1.jpg', 3600)

    const second = renderHook(() => useCustomExercisePhotoUrl('trainer-1/exercise-1.jpg'))
    await waitFor(() => expect(second.result.current).toBe('https://signed.example/exercise.jpg'))
    expect(createCustomExercisePhotoUrl).toHaveBeenCalledTimes(1)
  })

  it('falls back silently when signing fails', async () => {
    createCustomExercisePhotoUrl.mockRejectedValue(new Error('denied'))
    const { result } = renderHook(() => useCustomExercisePhotoUrl('trainer-1/missing.jpg'))
    await waitFor(() => expect(createCustomExercisePhotoUrl).toHaveBeenCalled())
    expect(result.current).toBeUndefined()
  })
})
