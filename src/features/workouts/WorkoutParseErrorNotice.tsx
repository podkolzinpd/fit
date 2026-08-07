export type WorkoutParseErrorKind = 'network' | 'service' | 'unrecognized'

const messages: Record<WorkoutParseErrorKind, { title: string; text: string; action?: string }> = {
  network: {
    title: 'Нет соединения',
    text: 'Текст тренировки сохранён. Проверьте интернет и повторите разбор.',
    action: 'Повторить',
  },
  service: {
    title: 'Разбор временно недоступен',
    text: 'Текст тренировки сохранён. Попробуйте повторить разбор через несколько секунд.',
    action: 'Повторить',
  },
  unrecognized: {
    title: 'Не нашли упражнение',
    text: 'Допишите название точнее или выберите упражнение из каталога.',
  },
}

export function workoutParseErrorKind(error: unknown): WorkoutParseErrorKind {
  const message = error instanceof Error ? error.message : ''
  return /network|fetch|сеть|соединени/i.test(message) ? 'network' : 'service'
}

export function WorkoutParseErrorNotice({ kind, onRetry }: { kind: WorkoutParseErrorKind; onRetry: () => void }) {
  const message = messages[kind]
  return <section className="today-parse-error" role="alert">
    <strong>{message.title}</strong>
    <span>{message.text}</span>
    {message.action && <button type="button" className="link" onClick={onRetry}>{message.action}</button>}
  </section>
}
