import { describe, expect, it } from 'vitest'
import { isRepositoryConflict, isRepositoryNetworkError, repositoryError } from './error'

describe('repositoryError', () => {
  it.each([
    ['PT403', 'Ответить может тренер, назначенный на эту тренировку.'],
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

  it('explains that the current trainer must be disconnected before switching', () => {
    const error = repositoryError({ code: 'PT409', message: 'trainer_switch_required' })

    expect(error.code).toBe('trainer_switch_required')
    expect(error.message).toBe('Вы уже подключены к другому тренеру. Сначала отключите текущего тренера в профиле, затем повторите.')
  })

  it('explains a legacy client migration conflict without exposing internals', () => {
    const error = repositoryError({ code: 'PT409', message: 'client_requires_safe_migration' })

    expect(error.code).toBe('client_requires_safe_migration')
    expect(error.message).toBe('Сейчас отключить тренера безопасно не получилось. Ваши данные не изменены. Попробуйте позже или напишите в поддержку.')
  })

  it.each([
    [{ code: 'invalid_credentials', message: 'Invalid login credentials' }, 'invalid_credentials', 'Неверный email или пароль. Проверьте данные и повторите попытку.'],
    [{ code: 'over_request_rate_limit', message: 'Too many requests' }, 'rate_limited', 'Слишком много попыток. Подождите немного и повторите.'],
    [{ code: 'email_not_confirmed', message: 'Email not confirmed' }, 'email_not_confirmed', 'Подтвердите email по ссылке из письма и повторите попытку.'],
    [{ code: 'weak_password', message: 'Password should contain a digit' }, 'weak_password', 'Пароль слишком простой. Используйте не менее 8 символов, добавьте буквы и цифры и не используйте распространённый пароль.'],
    [{ code: 'email_address_invalid', message: 'Email address is invalid' }, 'email_address_invalid', 'Проверьте email: адрес выглядит некорректно или не поддерживается.'],
    [{ code: 'signup_disabled', message: 'Signups not allowed for this instance' }, 'signup_disabled', 'Регистрация по email сейчас недоступна. Попробуйте войти через Google.'],
    [{ code: 'email_provider_disabled', message: 'Email provider is disabled' }, 'signup_disabled', 'Регистрация по email сейчас недоступна. Попробуйте войти через Google.'],
  ])('maps safe auth feedback without exposing service details', (source, code, message) => {
    const error = repositoryError(source)

    expect(error.code).toBe(code)
    expect(error.message).toBe(message)
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

  it('classifies conflicts and network failures for explicit recovery flows', () => {
    const conflict = repositoryError({ code: 'PT409', message: 'workout_conflict' })
    const network = repositoryError({ code: 'TypeError', message: 'Failed to fetch' })
    const webkitNetwork = repositoryError({ code: 'TypeError', message: 'Load failed' })

    expect(isRepositoryConflict(conflict)).toBe(true)
    expect(isRepositoryNetworkError(network)).toBe(true)
    expect(isRepositoryNetworkError(webkitNetwork)).toBe(true)
    expect(network.code).toBe('network_unavailable')
  })
})
