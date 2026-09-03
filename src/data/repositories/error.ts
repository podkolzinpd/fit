export class RepositoryError extends Error {
  constructor(public readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'RepositoryError'
  }
}

export function isRepositoryConflict(error: unknown): error is RepositoryError {
  return error instanceof RepositoryError && (error.code === 'PT409' || error.code === '40001')
}

export function isRepositoryNetworkError(error: unknown): error is RepositoryError {
  return error instanceof RepositoryError && error.code === 'network_unavailable'
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
  if (normalizedCode === 'weak_password') {
    return new RepositoryError(
      'weak_password',
      'Пароль слишком простой. Используйте не менее 8 символов, добавьте буквы и цифры и не используйте распространённый пароль.',
    )
  }
  if (normalizedCode === 'email_address_invalid') {
    return new RepositoryError('email_address_invalid', 'Проверьте email: адрес выглядит некорректно или не поддерживается.')
  }
  if (normalizedCode === 'signup_disabled' || normalizedCode === 'email_provider_disabled') {
    return new RepositoryError('signup_disabled', 'Регистрация по email сейчас недоступна. Попробуйте войти через Google.')
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
  if (normalizedMessage.includes('trainer_switch_required')) {
    return new RepositoryError(
      'trainer_switch_required',
      'Вы уже подключены к другому тренеру. Сначала отключите текущего тренера в профиле, затем повторите.',
    )
  }
  if (normalizedMessage.includes('trainer_disconnect_required')) {
    return new RepositoryError(
      'trainer_disconnect_required',
      'Сначала отключите текущего тренера в профиле. Ваши тренировки и результаты сохранятся.',
    )
  }
  if (normalizedMessage.includes('client_requires_safe_migration')) {
    return new RepositoryError(
      'client_requires_safe_migration',
      'Сейчас отключить тренера безопасно не получилось. Ваши данные не изменены. Попробуйте позже или напишите в поддержку.',
    )
  }
  if (code === 'PT409' && normalizedMessage.includes('active_workout_exists')) {
    return new RepositoryError('active_workout_exists', 'У клиента уже идёт другая тренировка. Откройте её и продолжите.')
  }
  if (code === 'PT409' && normalizedMessage.includes('custom_metric_exists')) {
    return new RepositoryError('custom_metric_exists', 'Показатель с таким названием уже существует.')
  }
  if (code === 'PT409' || code === '40001') {
    return new RepositoryError(code, 'Данные уже изменились. Обновите страницу и повторите.')
  }
  if (code === 'PT404') {
    return new RepositoryError(code, 'Запись не найдена или больше недоступна.')
  }
  if (code === 'PT403') {
    return new RepositoryError(code, 'Ответить может тренер, назначенный на эту тренировку.')
  }
  if (code === 'PT422' && /(?:^|\W)invalid_stage(?:$|\W)/.test(normalizedMessage)) {
    return new RepositoryError(
      'invalid_stage',
      'Проверьте этап: название — не более 120 символов, дата окончания — не раньше начала и не позже даты цели.',
    )
  }
  if (code === 'PT422' && /(?:^|\W)invalid_goal(?:$|\W)/.test(normalizedMessage)) {
    return new RepositoryError('invalid_goal', 'Проверьте цель: название должно содержать не более 200 символов.')
  }
  if (code === 'PT422') {
    return new RepositoryError(code, 'Операцию нельзя выполнить с текущими данными.')
  }
  if (code === '23505') {
    if (normalizedMessage.includes('custom_exercises_active_author_name_uidx')) {
      return new RepositoryError('custom_exercise_exists', 'Упражнение с таким названием уже существует.')
    }
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
  if (normalizedMessage.includes('failed to fetch') || normalizedMessage.includes('load failed') || normalizedMessage.includes('network')) {
    return new RepositoryError('network_unavailable', 'Не удалось подключиться к серверу. Проверьте интернет и повторите попытку.')
  }
  return new RepositoryError(code, 'Не удалось выполнить действие. Попробуйте ещё раз.')
}
