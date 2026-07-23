import { describe, expect, it } from 'vitest'
import { repositoryError } from './error'

describe('repositoryError', () => {
  it.each([
    ['PT404', 'Запись не найдена или больше недоступна.'],
    ['PT409', 'Данные уже изменились. Обновите страницу и повторите.'],
    ['PT422', 'Операцию нельзя выполнить с текущими данными.'],
  ])('maps %s to a stable user-facing message', (code, message) => {
    const error = repositoryError({ code, message: 'database detail' })

    expect(error.code).toBe(code)
    expect(error.message).toBe(message)
  })

  it('preserves authentication and permission errors', () => {
    const error = repositoryError({ code: '42501', message: 'permission denied' })

    expect(error.code).toBe('42501')
    expect(error.message).toBe('permission denied')
  })
})
