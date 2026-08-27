import { AssistantIcon } from '../../shared/icons'

type AssistantFirstEntryProps = {
  onChoose: (prompt: string) => void
}

const starterPrompts = [
  { label: 'Записать тренировку', prompt: 'Запиши тренировку: жим лёжа 3 по 10 по 60 кг' },
  { label: 'Показать прогресс', prompt: 'Покажи прогресс клиента за месяц' },
  { label: 'Что ты умеешь?', prompt: 'Что ты умеешь?' },
]

export function AssistantFirstEntry({ onChoose }: AssistantFirstEntryProps) {
  return <section className="assistant-first-entry" aria-labelledby="assistant-first-entry-title">
    <span className="assistant-first-entry-icon" aria-hidden="true"><AssistantIcon /></span>
    <div className="assistant-first-entry-copy">
      <h2 id="assistant-first-entry-title">Запиши тренировку за минуту</h2>
      <p>Напиши или надиктуй упражнения и результаты. Ассистент уточнит клиента и покажет черновик перед сохранением.</p>
    </div>
    <div className="assistant-first-entry-actions" aria-label="Примеры запросов">
      {starterPrompts.map((item) => <button key={item.label} type="button" onClick={() => onChoose(item.prompt)}>{item.label}</button>)}
    </div>
  </section>
}
