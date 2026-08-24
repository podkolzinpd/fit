import { useState } from 'react'
import { AddIcon, ChevronRightIcon, MicIcon } from '../../shared/icons'
import type { AssistantActionDraft, AssistantMessage, AssistantToolName } from './assistant-contract'
import { assistantSandboxScenario, assistantSandboxScenarioForMessage } from './assistant-sandbox-scenarios'

type WorkoutSet = {
  id: string
  weight: string
  reps: string
  note: string
  current?: boolean
}

type ProgramDraft = { goal: string; days: string; workouts: string[] }
type ScheduleDraft = { clientName: string; startDate: string; slots: string[] }
type ClientDraft = { name: string; contact: string; trainer: string }

const INITIAL_PROGRAM_DRAFT: ProgramDraft = {
  goal: 'Набор силы без перегрузки плеча',
  days: 'Понедельник и четверг',
  workouts: ['Тренировка A · жим, тяга, ноги', 'Тренировка B · ноги, спина, кор'],
}

const INITIAL_SCHEDULE_DRAFT: ScheduleDraft = {
  clientName: 'Антон Ковалёв',
  startDate: '25 августа',
  slots: ['Понедельник · 19:00', 'Четверг · 19:00'],
}

const INITIAL_CLIENT_DRAFT: ClientDraft = {
  name: 'Мария Смирнова',
  contact: '+7 999 123-45-67',
  trainer: 'Текущий тренер',
}

const INITIAL_USER_MESSAGES: Record<AssistantToolName, string | null> = {
  record_workout: 'Начали тренировку с Антоном. Жим лёжа: 50 кг, 10 повторений',
  create_client_draft: 'Добавь нового клиента',
  create_program_draft: 'Составь программу тренировок для Антона',
  schedule_program: 'Добавь программу Антона в расписание',
  summarize_progress: 'Покажи прогресс Антона за месяц',
}

const INITIAL_SETS: WorkoutSet[] = [
  { id: 'set-1', weight: '50', reps: '10', note: '' },
  { id: 'set-2', weight: '70', reps: '12', note: 'Появился дискомфорт в плече', current: true },
]

function nextSetId(sets: readonly WorkoutSet[]) {
  return `set-${sets.length + 1}`
}

function initialThread(tool: AssistantToolName): AssistantMessage[] {
  const scenario = assistantSandboxScenario(tool)
  const userText = INITIAL_USER_MESSAGES[tool]
  return [
    ...(userText ? [{ id: `user-initial-${tool}`, role: 'user' as const, text: userText }] : []),
    scenario.message,
  ]
}

export function AssistantSandboxPage({ initialTool = 'record_workout' }: { initialTool?: AssistantToolName }) {
  const initialScenario = assistantSandboxScenario(initialTool)
  const [sets, setSets] = useState<WorkoutSet[]>(INITIAL_SETS)
  const [message, setMessage] = useState('')
  const [saved, setSaved] = useState(false)
  const [thread, setThread] = useState<AssistantMessage[]>(() => initialThread(initialTool))
  const [activeTool, setActiveTool] = useState<AssistantToolName>(initialTool)
  const [action, setAction] = useState<AssistantActionDraft>(initialScenario.action)
  const [reset, setReset] = useState(false)
  const [programDraft, setProgramDraft] = useState<ProgramDraft>(INITIAL_PROGRAM_DRAFT)
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft>(INITIAL_SCHEDULE_DRAFT)
  const [clientDraft, setClientDraft] = useState<ClientDraft>(INITIAL_CLIENT_DRAFT)

  function updateSet(id: string, patch: Partial<WorkoutSet>) {
    setSaved(false)
    setSets((current) => current.map((set) => set.id === id ? { ...set, ...patch } : set))
  }

  function addSet() {
    setSaved(false)
    setSets((current) => [...current.map((set) => ({ ...set, current: false })), {
      id: nextSetId(current), weight: '40', reps: '12', note: '', current: true,
    }])
  }

  function submitMessage() {
    const normalized = message.trim()
    if (!normalized) return
    setMessage('')
    setReset(false)
    if (action.status === 'needs_input' && activeTool !== 'record_workout') {
      setAction((current) => ({ ...current, status: 'proposed', description: 'Собрала ответы в редактируемый черновик. Проверьте его перед подтверждением.' }))
      appendTurn(normalized, 'Собрала ответы. Вот черновик действия — проверьте и подтвердите, если всё верно.')
      return
    }
    const scenario = assistantSandboxScenarioForMessage(normalized)
    setActiveTool(scenario.tool)
    setAction(scenario.action)
    appendTurn(normalized, scenario.message.text)
  }

  function appendTurn(userText: string, assistantText: string) {
    const id = String(Date.now())
    setThread((current) => [
      ...current,
      { id: `user-${id}`, role: 'user', text: userText },
      { id: `assistant-${id}`, role: 'assistant', text: assistantText },
    ])
  }

  function confirmAction() {
    if (action.tool === 'create_program_draft') {
      const scheduleScenario = assistantSandboxScenario('schedule_program')
      setActiveTool('schedule_program')
      setAction({
        ...scheduleScenario.action,
        status: 'proposed',
        description: `Добавлю программу для ${scheduleDraft.clientName} в выбранные слоты. Сначала проверьте расписание.`,
      })
      setThread((current) => [...current, { id: `assistant-schedule-${Date.now()}`, role: 'assistant', text: 'Программа подтверждена локально. Подготовила её добавление в расписание — проверьте слоты.' }])
      return
    }
    setAction((current) => ({ ...current, status: 'confirmed' }))
  }

  function cancelAction() {
    setAction((current) => ({ ...current, status: 'cancelled' }))
    setThread((current) => [...current, { id: `assistant-cancel-${Date.now()}`, role: 'assistant', text: 'Черновик отменён. Ничего не сохранено.' }])
  }

  function resetSandbox() {
    setSets(INITIAL_SETS)
    setMessage('')
    setThread([{ id: `assistant-reset-${Date.now()}`, role: 'assistant', text: 'Чем могу помочь? Можешь написать про тренировку, клиента, программу, расписание или прогресс.' }])
    setActiveTool(initialTool)
    setAction(initialScenario.action)
    setSaved(false)
    setReset(true)
    setProgramDraft(INITIAL_PROGRAM_DRAFT)
    setScheduleDraft(INITIAL_SCHEDULE_DRAFT)
    setClientDraft(INITIAL_CLIENT_DRAFT)
  }

  return <main className="assistant-page">
    <h1 className="sr-only">Ассистент</h1>
    <p className="assistant-local-note">Локальная песочница: данные не отправляются в Cloud или production.</p>
    <section className="assistant-thread" aria-label="Диалог с ассистентом">
      {thread.map((entry, index) => entry.role === 'user'
        ? <article key={entry.id} className="assistant-message assistant-message-user">
          <p>{entry.text}</p>
          {index === thread.length - 2 && <button type="button" className="assistant-message-edit" onClick={() => setMessage(entry.text)} aria-label="Изменить последнее сообщение">Изменить</button>}
        </article>
        : <p key={entry.id} className="assistant-thinking" role="status"><span aria-hidden="true" />{entry.text}</p>)}

      {!reset && activeTool === 'record_workout' && <section className="assistant-workout-card" aria-label="Текущая тренировка Антона">
        <header><strong>Антон Ковалёв · сейчас</strong><span>{saved ? 'сохранено локально' : 'черновик'}</span></header>
        <h2>Жим штанги лёжа</h2>
        <div className="assistant-sets">
          {sets.map((set, index) => <WorkoutSetCard key={set.id} set={set} number={index + 1} onChange={(patch) => updateSet(set.id, patch)} />)}
        </div>
        <button type="button" className="assistant-add-set" onClick={addSet}><AddIcon />Ещё подход</button>
        <button type="button" className="assistant-save-workout" onClick={() => setSaved(true)}>Сохранить локальный черновик</button>
        <p className="assistant-card-hint">Поля меняются прямо в карточке. Подключение к тренировке появится только на stage.</p>
      </section>}

      {!reset && activeTool !== 'record_workout' && <AssistantActionCard action={action} programDraft={programDraft} onProgramDraftChange={setProgramDraft} scheduleDraft={scheduleDraft} onScheduleDraftChange={setScheduleDraft} clientDraft={clientDraft} onClientDraftChange={setClientDraft} onConfirm={confirmAction} onCancel={cancelAction} />}
    </section>

    <form className="assistant-composer" onSubmit={(event) => { event.preventDefault(); submitMessage() }}>
      <label className="sr-only" htmlFor="assistant-message">Сообщение ассистенту</label>
      <input id="assistant-message" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Чем могу помочь?" />
      <button type="button" className="assistant-icon-button" disabled aria-label="Голосовой ввод появится в следующем этапе"><MicIcon /></button>
      <button type="submit" className="assistant-icon-button" aria-label="Отправить сообщение"><ChevronRightIcon /></button>
      <button type="button" className="assistant-reset" onClick={resetSandbox}>Сбросить</button>
    </form>
  </main>
}

function AssistantActionCard({ action, programDraft, onProgramDraftChange, scheduleDraft, onScheduleDraftChange, clientDraft, onClientDraftChange, onConfirm, onCancel }: { action: AssistantActionDraft; programDraft: ProgramDraft; onProgramDraftChange: (draft: ProgramDraft) => void; scheduleDraft: ScheduleDraft; onScheduleDraftChange: (draft: ScheduleDraft) => void; clientDraft: ClientDraft; onClientDraftChange: (draft: ClientDraft) => void; onConfirm: () => void; onCancel: () => void }) {
  const isProgress = action.tool === 'summarize_progress'
  const fields = stringArray(action.payload.fields) ? action.payload.fields : []
  const progress = isProgress ? action.payload as { clientName: string; periodStart: string; periodEnd: string; preview: string } : null
  return <section className="assistant-action-card" aria-label={action.title}>
    <header><strong>{action.title}</strong><span>{action.status === 'confirmed' ? 'подтверждено локально' : 'черновик действия'}</span></header>
    <p>{action.description}</p>
    {progress && <div className="assistant-progress-preview">
      <strong>{progress.clientName}</strong>
      <span>{progress.periodStart} — {progress.periodEnd}</span>
      <b>{progress.preview}</b>
      <small>В stage это вызовет только существующий `summarize-client-training`; сейчас данных не запрашиваем.</small>
    </div>}
    {fields.length > 0 && <ul>{fields.map((field) => <li key={field}>{field}</li>)}</ul>}
    {action.tool === 'create_program_draft' && action.status !== 'needs_input' && <ProgramDraftCard draft={programDraft} onChange={onProgramDraftChange} />}
    {action.tool === 'schedule_program' && action.status !== 'needs_input' && <ScheduleDraftCard draft={scheduleDraft} onChange={onScheduleDraftChange} />}
    {action.tool === 'create_client_draft' && action.status !== 'needs_input' && <ClientDraftCard draft={clientDraft} onChange={onClientDraftChange} />}
    {action.status === 'cancelled'
      ? <p className="assistant-card-hint">Черновик отменён локально. Изменений в приложении нет.</p>
      : action.status === 'needs_input'
      ? <p className="assistant-card-hint">Сначала ассистент задаст эти вопросы. До ответов создавать или планировать нечего.</p>
      : <><button type="button" onClick={onConfirm} disabled={action.status === 'confirmed'}>
        {action.status === 'confirmed' ? 'Подтверждено локально' : 'Подтвердить черновик'}
      </button><button type="button" className="assistant-action-cancel" onClick={onCancel}>Отменить черновик</button><p className="assistant-card-hint">Подтверждение пока не вызывает API и ничего не записывает.</p></>}
  </section>
}

function ClientDraftCard({ draft, onChange }: { draft: ClientDraft; onChange: (draft: ClientDraft) => void }) {
  return <div className="assistant-program-draft" aria-label="Черновик нового клиента">
    <label>Имя<input value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} /></label>
    <label>Телефон или e-mail<input value={draft.contact} onChange={(event) => onChange({ ...draft, contact: event.target.value })} /></label>
    <label>Тренер<input value={draft.trainer} onChange={(event) => onChange({ ...draft, trainer: event.target.value })} /></label>
  </div>
}

function ScheduleDraftCard({ draft, onChange }: { draft: ScheduleDraft; onChange: (draft: ScheduleDraft) => void }) {
  return <div className="assistant-program-draft" aria-label="Предпросмотр расписания программы">
    <label>Клиент<input value={draft.clientName} onChange={(event) => onChange({ ...draft, clientName: event.target.value })} /></label>
    <label>Дата старта<input value={draft.startDate} onChange={(event) => onChange({ ...draft, startDate: event.target.value })} /></label>
    <strong>Слоты</strong>
    {draft.slots.map((slot, index) => <label key={`slot-${index}`}>Тренировка {index + 1}<input value={slot} onChange={(event) => onChange({ ...draft, slots: draft.slots.map((item, position) => position === index ? event.target.value : item) })} /></label>)}
  </div>
}

function ProgramDraftCard({ draft, onChange }: { draft: ProgramDraft; onChange: (draft: ProgramDraft) => void }) {
  return <div className="assistant-program-draft" aria-label="Редактирование программы">
    <label>Цель<input value={draft.goal} onChange={(event) => onChange({ ...draft, goal: event.target.value })} /></label>
    <label>Дни<input value={draft.days} onChange={(event) => onChange({ ...draft, days: event.target.value })} /></label>
    <strong>Тренировки</strong>
    {draft.workouts.map((workout, index) => <label key={`workout-${index}`}>Тренировка {index + 1}<input value={workout} onChange={(event) => onChange({ ...draft, workouts: draft.workouts.map((item, position) => position === index ? event.target.value : item) })} /></label>)}
  </div>
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function WorkoutSetCard({ set, number, onChange }: { set: WorkoutSet; number: number; onChange: (patch: Partial<WorkoutSet>) => void }) {
  return <article className={`assistant-set-card${set.current ? ' assistant-set-current' : ''}`}>
    <header><span>Подход #{number}</span>{set.current && <span>сейчас</span>}</header>
    <div className="assistant-set-fields">
      <label><span>Вес, кг</span><input inputMode="decimal" value={set.weight} onChange={(event) => onChange({ weight: event.target.value })} /></label>
      <label><span>Повторы</span><input inputMode="numeric" value={set.reps} onChange={(event) => onChange({ reps: event.target.value })} /></label>
    </div>
    <label className="assistant-set-note"><span>Заметка</span><input value={set.note} onChange={(event) => onChange({ note: event.target.value })} placeholder="Для заметок…" /></label>
  </article>
}
