export class RepositoryError extends Error {
  constructor(public readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'RepositoryError'
  }
}

export function repositoryError(error: unknown): RepositoryError {
  if (!error || typeof error !== 'object') {
    return new RepositoryError('unknown', 'Неизвестная ошибка')
  }
  const candidate = error as { code?: unknown; message?: unknown }
  const code = typeof candidate.code === 'string' ? candidate.code : 'database_error'
  const message = typeof candidate.message === 'string' ? candidate.message : 'Неизвестная ошибка'
  if (code === 'PT409' || code === '40001') {
    return new RepositoryError(code, 'Данные уже изменились. Обновите страницу и повторите.')
  }
  if (code === 'PT404') {
    return new RepositoryError(code, 'Запись не найдена или больше недоступна.')
  }
  if (code === 'PT422') {
    return new RepositoryError(code, 'Операцию нельзя выполнить с текущими данными.')
  }
  return new RepositoryError(code, message)
}
