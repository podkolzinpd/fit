export class RepositoryError extends Error {
  constructor(public readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'RepositoryError'
  }
}

export function repositoryError(error: unknown): RepositoryError {
  if (!error || typeof error !== 'object') {
    return new RepositoryError('unknown', 'Не удалось выполнить действие. Попробуйте ещё раз.')
  }
  const candidate = error as { code?: unknown; message?: unknown }
  const code = typeof candidate.code === 'string' ? candidate.code : 'database_error'
  const message = typeof candidate.message === 'string' ? candidate.message : ''
  const normalizedCode = code.toLocaleLowerCase('en')
  const normalizedMessage = message.toLocaleLowerCase('en')
  if (normalizedCode === 'invalid_credentials' || normalizedMessage.includes('invalid login credentials')) {
    return new RepositoryError('invalid_credentials', 'Неверный email или пароль. Проверьте данные и повторите попытку.')
  }
  if (normalizedCode.includes('rate_limit') || normalizedMessage.includes('too many requests')) {
    return new RepositoryError('rate_limited', 'Слишком много попыток. Подождите немного и повторите.')
  }
  if (normalizedCode === 'email_not_confirmed') {
    return new RepositoryError('email_not_confirmed', 'Подтвердите email по ссылке из письма и повторите попытку.')
  }
  if (normalizedMessage.includes('workout_sets_rpe_valid')) {
    return new RepositoryError(code, 'В одном из подходов указано некорректное RPE. Выберите значение от 6 до 10 с шагом 0,5.')
  }
  if (normalizedMessage.includes('invitation_invalid')) {
    return new RepositoryError('invitation_invalid', 'Приглашение недействительно или срок его действия истёк. Попросите новый код.')
  }
  if (normalizedMessage.includes('invitation_role_mismatch')) {
    return new RepositoryError('invitation_role_mismatch', 'Этот код приглашения предназначен для другого типа аккаунта.')
  }
  if (code === 'PT409' && normalizedMessage.includes('active_workout_exists')) {
    return new RepositoryError('active_workout_exists', 'У клиента уже идёт другая тренировка. Откройте её и продолжите.')
  }
  if (code === 'PT409' || code === '40001') {
    return new RepositoryError(code, 'Данные уже изменились. Обновите страницу и повторите.')
  }
  if (code === 'PT404') {
    return new RepositoryError(code, 'Запись не найдена или больше недоступна.')
  }
  if (code === 'PT422') {
    return new RepositoryError(code, 'Операцию нельзя выполнить с текущими данными.')
  }
  if (code === '23505') {
    return new RepositoryError(code, 'Такая запись уже существует. Проверьте введённые данные.')
  }
  if (code === '23503') {
    return new RepositoryError(code, 'Связанная запись больше недоступна. Обновите страницу и повторите.')
  }
  if (code === '23514') {
    return new RepositoryError(code, 'Проверьте заполненные значения и повторите сохранение.')
  }
  if (code === '42501') {
    return new RepositoryError(code, 'Недостаточно прав для этого действия.')
  }
  if (normalizedMessage.includes('failed to fetch') || normalizedMessage.includes('network')) {
    return new RepositoryError(code, 'Не удалось подключиться к серверу. Проверьте интернет и повторите попытку.')
  }
  return new RepositoryError(code, 'Не удалось выполнить действие. Попробуйте ещё раз.')
}
