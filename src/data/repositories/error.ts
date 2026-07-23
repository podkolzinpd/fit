export class RepositoryError extends Error {
  constructor(public readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'RepositoryError'
  }
}

export function repositoryError(error: { code?: string; message: string } | null): RepositoryError {
  if (!error) return new RepositoryError('unknown', 'Неизвестная ошибка')
  const code = error.code ?? 'database_error'
  if (code === 'PT409' || code === '40001') {
    return new RepositoryError(code, 'Данные уже изменились. Обновите страницу и повторите.')
  }
  if (code === 'PT404') {
    return new RepositoryError(code, 'Запись не найдена или больше недоступна.')
  }
  if (code === 'PT422') {
    return new RepositoryError(code, 'Операцию нельзя выполнить с текущими данными.')
  }
  return new RepositoryError(code, error.message)
}
