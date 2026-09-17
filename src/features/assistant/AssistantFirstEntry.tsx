import { AssistantIcon } from '../../shared/icons'

type AssistantFirstEntryProps = {
  onChoose: (prompt: string) => void
  programEnabled?: boolean
  clientMode?: boolean
}

const trainerStarterPrompts = [
  { label: 'Записать тренировку', prompt: 'Запиши тренировку: жим лёжа 3 по 10 по 60 кг' },
  { label: 'Показать прогресс', prompt: 'Покажи прогресс клиента за месяц' },
  { label: 'Что ты умеешь?', prompt: 'Что ты умеешь?' },
]

const clientStarterPrompts = [
  { label: 'Записать тренировку', prompt: 'Запиши мою тренировку: жим лёжа 3 по 10 по 60 кг' },
  { label: 'Показать прогресс', prompt: 'Покажи мой прогресс за месяц' },
  { label: 'Что ты умеешь?', prompt: 'Что ты умеешь?' },
]

export function AssistantFirstEntry({ onChoose, programEnabled = false, clientMode = false }: AssistantFirstEntryProps) {
  const starterPrompts = clientMode ? clientStarterPrompts : trainerStarterPrompts
  return <section className="assistant-first-entry" aria-labelledby="assistant-first-entry-title">
    <span className="assistant-first-entry-icon" aria-hidden="true"><AssistantIcon /></span>
    <div className="assistant-first-entry-copy">
      <h2 id="assistant-first-entry-title">{programEnabled ? 'Чем помочь с тренировками?' : 'Запиши тренировку за минуту'}</h2>
      <p>{programEnabled ? 'Напиши или надиктуй запрос: внести выполненную тренировку или составить рекомендованный черновик программы. Ассистент уточнит детали и покажет результат перед сохранением.' : clientMode ? 'Напиши или надиктуй упражнения и результаты. Ассистент покажет черновик перед сохранением в твой кабинет.' : 'Напиши или надиктуй упражнения и результаты. Ассистент уточнит клиента и покажет черновик перед сохранением.'}</p>
    </div>
    <div className="assistant-first-entry-actions" aria-label="Примеры запросов">
      {programEnabled && <button type="button" onClick={() => onChoose('Составь программу тренировок')}>Составить программу</button>}
      {starterPrompts.map((item) => <button key={item.label} type="button" onClick={() => onChoose(item.prompt)}>{item.label}</button>)}
    </div>
  </section>
}
