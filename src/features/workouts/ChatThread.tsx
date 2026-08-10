import { useEffect, useRef, useState } from 'react'
import type { ExerciseSnapshot, WorkoutSetDraft } from '../../shared/domain'
import { PencilIcon } from '../../shared/icons'
import { ExerciseCard } from './ExerciseCard'
import { WorkoutParseErrorNotice } from './WorkoutParseErrorNotice'
import type { ChatMessage } from './chat-types'
import type { ParsedWorkoutExercise } from './quick-workout-entry'

interface ChatThreadProps {
  messages: ChatMessage[]
  items: ParsedWorkoutExercise[]
  choices: Record<string, ExerciseSnapshot>
  isRpeVisible: (itemIndex: number) => boolean
  onToggleRpe: (itemIndex: number) => void
  onReplace: (itemIndex: number) => void
  onRemoveExercise: (itemIndex: number) => void
  onUpdateSet: (itemIndex: number, setIndex: number, patch: Partial<WorkoutSetDraft>) => void
  onAddSet: (itemIndex: number) => void
  onRemoveSet: (itemIndex: number, setIndex: number) => void
  onEditMessage: (id: string, newText: string) => void
  onChooseCandidate: (line: string, exercise: ExerciseSnapshot) => void
  onRetryError: (id: string, sourceText: string) => void
}

export function ChatThread({ messages, items, choices, isRpeVisible, onToggleRpe, onReplace, onRemoveExercise, onUpdateSet, onAddSet, onRemoveSet, onEditMessage, onChooseCandidate, onRetryError }: ChatThreadProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [messages, items])

  const itemIndexById = new Map(items.map((item, index) => [item.id, index]))
  function cardsFor(itemIds: string[]) {
    return itemIds.flatMap((id) => {
      const index = itemIndexById.get(id)
      const item = index === undefined ? undefined : items[index]
      return item && index !== undefined ? [{ item, index }] : []
    })
  }
  function renderCard({ item, index }: { item: ParsedWorkoutExercise; index: number }) {
    return <ExerciseCard key={item.id} item={item} showRpe={isRpeVisible(index)}
      onToggleRpe={() => onToggleRpe(index)} onReplace={() => onReplace(index)} onRemove={() => onRemoveExercise(index)}
      onUpdateSet={(setIndex, patch) => onUpdateSet(index, setIndex, patch)} onAddSet={() => onAddSet(index)} onRemoveSet={(setIndex) => onRemoveSet(index, setIndex)} />
  }

  return <div className="chat-thread" aria-live="polite">
    {messages.map((message) => {
      if (message.kind === 'thinking') return <div className="chat-thinking" key={message.id}><span /><span /><span /></div>

      if (message.kind === 'manual') return <div className="chat-turn" key={message.id}>{cardsFor(message.itemIds).map(renderCard)}</div>

      if (message.kind === 'user') {
        return <div className="chat-turn" key={message.id}>
          {editingId === message.id
            ? <EditableBubble text={message.text} onCancel={() => setEditingId(null)} onSave={(text) => { onEditMessage(message.id, text); setEditingId(null) }} />
            : <div className="chat-bubble chat-bubble-user">{message.text}<button type="button" className="chat-bubble-edit" aria-label="Исправить сообщение" onClick={() => setEditingId(message.id)}><PencilIcon /></button></div>}
          {cardsFor(message.itemIds).map(renderCard)}
        </div>
      }

      if (message.kind === 'clarification') {
        const chosen = choices[message.line]
        if (chosen) {
          const index = items.findIndex((item) => item.line === message.line && item.exercise.ref === chosen.ref)
          return index === -1 ? null : renderCard({ item: items[index]!, index })
        }
        return <section className="chat-clarification" aria-label="Уточните упражнение" key={message.id}>
          <strong>Уточните упражнение</strong>
          <p>«{message.line}» — выберите вариант ниже или допишите деталь новым сообщением.</p>
          {message.candidates.length > 0 && <div className="quick-workout-candidates">
            {message.candidates.map((exercise) => <button type="button" className="secondary" key={exercise.ref} onClick={() => onChooseCandidate(message.line, exercise)}>{exercise.name}</button>)}
          </div>}
        </section>
      }

      return <WorkoutParseErrorNotice key={message.id} kind={message.error} onRetry={() => onRetryError(message.id, message.sourceText)} />
    })}
    <div ref={endRef} />
  </div>
}

function EditableBubble({ text, onCancel, onSave }: { text: string; onCancel: () => void; onSave: (text: string) => void }) {
  const [value, setValue] = useState(text)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { ref.current?.focus(); ref.current?.setSelectionRange(value.length, value.length) }, [])
  return <div className="chat-bubble chat-bubble-user chat-bubble-editing">
    <textarea ref={ref} value={value} aria-label="Правка сообщения" rows={2}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel()
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) onSave(value)
      }} />
    <div className="chat-bubble-edit-actions">
      <button type="button" onClick={onCancel}>Отмена</button>
      <button type="button" className="ok" onClick={() => onSave(value)}>Готово</button>
    </div>
  </div>
}
