import { describe, expect, it } from 'vitest'
import { repositoryError } from './error'

describe('repositoryError', () => {
  it.each([
    ['PT404', 'Запись не найдена или больше недоступна.'],
    ['PT409', 'Данные уже изменились. Обновите страницу и повторите.'],
    ['PT422', 'Операцию нельзя выполнить с текущими данными.'],
    ['23505', 'Такая запись уже существует. Проверьте введённые данные.'],
    ['23503', 'Связанная запись больше недоступна. Обновите страницу и повторите.'],
    ['23514', 'Проверьте заполненные значения и повторите сохранение.'],
    ['42501', 'Недостаточно прав для этого действия.'],
  ])('maps %s to a stable user-facing message', (code, message) => {
    const error = repositoryError({ code, message: 'database detail' })

    expect(error.code).toBe(code)
    expect(error.message).toBe(message)
  })

  it('preserves the active workout conflict for a recovery flow', () => {
    const error = repositoryError({ code: 'PT409', message: 'active_workout_exists' })

    expect(error.code).toBe('active_workout_exists')
    expect(error.message).toBe('У клиента уже идёт другая тренировка. Откройте её и продолжите.')
  })

  it('explains an invalid invitation without exposing database details', () => {
    const error = repositoryError({ code: 'PT404', message: 'invitation_invalid' })

    expect(error.code).toBe('invitation_invalid')
    expect(error.message).toBe('Приглашение недействительно или срок его действия истёк. Попросите новый код.')
  })

  it('explains the RPE database constraint in Russian', () => {
    const error = repositoryError({ code: '23514', message: 'new row for relation "workout_sets" violates check constraint "workout_sets_rpe_valid"' })

    expect(error.code).toBe('23514')
    expect(error.message).toBe('В одном из подходов указано некорректное RPE. Выберите значение от 6 до 10 с шагом 0,5.')
  })

  it('never exposes an unknown database message', () => {
    const error = repositoryError({ code: 'XX000', message: 'internal database detail' })

    expect(error.message).toBe('Не удалось выполнить действие. Попробуйте ещё раз.')
  })
})
