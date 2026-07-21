export class RepositoryError extends Error {
  constructor(public readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'RepositoryError'
  }
}

export function repositoryError(error: { code?: string; message: string } | null): RepositoryError {
  if (!error) return new RepositoryError('unknown', 'Неизвестная ошибка')
  const conflict = error.code === '40001' || error.message.includes('conflict')
  return new RepositoryError(error.code ?? 'database_error', conflict
    ? 'Данные уже изменились. Обновите страницу и повторите.'
    : error.message)
}
