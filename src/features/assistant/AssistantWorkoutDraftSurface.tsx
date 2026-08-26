import type { ReactNode } from 'react'
import type { WorkoutParseResponse } from '../../data/repositories/exercises.repository'
import type { ExerciseSnapshot } from '../../shared/domain'

type MetricPatch = { setCount?: number; reps?: number; weightKg?: number }

export function AssistantWorkoutDraftSurface({
  mode, clientName, workoutDate, startTime, rawFragments, result, catalog, parsing, catalogLoading,
  error, saving, saved, canFinish, composer, onDateChange, onTimeChange, onChoose, onUpdateMetrics,
  onRemove, onSave, onFinish, onCancel,
}: {
  mode: 'collecting' | 'confirm'; clientName: string; workoutDate: string; startTime: string; rawFragments: string[]
  result?: WorkoutParseResponse; catalog: readonly ExerciseSnapshot[]; parsing: boolean; catalogLoading: boolean
  error?: string; saving: boolean; saved: boolean; canFinish: boolean; composer?: ReactNode
  onDateChange: (value: string) => void; onTimeChange: (value: string) => void
  onChoose: (sourceText: string, ref: string) => void; onUpdateMetrics: (sourceText: string, patch: MetricPatch) => void
  onRemove: (sourceText: string) => void; onSave: () => void; onFinish?: () => void; onCancel: () => void
}) {
  const unmatched = result?.unmatched ?? []
  return <div className="assistant-flow-card assistant-program-draft assistant-workout-draft" aria-label={`${mode === 'collecting' ? 'Черновик' : 'Разбор'} тренировки ${clientName}`}>
    <header><span><small>{mode === 'collecting' ? 'Черновик тренировки' : 'Тренировка'}</small><strong>{clientName}</strong></span><span className="assistant-flow-status">{parsing ? 'Распознаю…' : mode === 'collecting' ? 'Диктовка' : 'Проверка'}</span></header>
    <div className="assistant-workout-meta"><label>Дата<input type="date" value={workoutDate} onChange={(event) => onDateChange(event.target.value)} /></label><label>Время<input type="time" value={startTime} onChange={(event) => onTimeChange(event.target.value)} /></label></div>
    {rawFragments.length > 0 && <span className="assistant-workout-fragment-count">Диктовка · {rawFragments.length} {rawFragments.length === 1 ? 'фрагмент' : 'фрагмента'}</span>}
    {composer}
    {!result && <div className="assistant-workout-recognition-state"><strong>{parsing || catalogLoading ? 'Распознаю упражнение…' : 'Продиктуйте первое упражнение'}</strong><span>{parsing || catalogLoading ? 'Название, подходы, повторы и значения появятся здесь автоматически.' : 'Например: «жим штанги лёжа, 3 подхода по 10, 50 кг».'}</span></div>}
    {result && <div className="assistant-workout-result"><div className="assistant-workout-result-list">
      {result.items.map((item, index) => { const exercise = catalog.find((candidate) => candidate.ref === item.exerciseRef); const firstSet = item.sets[0]; return <div key={`${item.exerciseRef}-${item.sourceText}-${index}`} className="assistant-workout-result-row"><span className="assistant-workout-exercise-name"><strong>{exercise?.name ?? item.sourceText}</strong><small>{exercise?.equipment || 'Распознано из диктовки'}</small></span><WorkoutMetricFields sourceText={item.sourceText} setCount={item.sets.length || 1} reps={firstSet?.reps} weightKg={firstSet?.weightKg} onChange={onUpdateMetrics} /><button type="button" className="assistant-workout-remove" onClick={() => onRemove(item.sourceText)} aria-label={`Удалить ${exercise?.name ?? item.sourceText}`}>×</button></div> })}
      {unmatched.map((item, index) => { const firstSet = item.sets?.[0]; return <div key={`${item.sourceText}-${index}`} className="assistant-exercise-choice"><div className="assistant-workout-ambiguous-head"><span><small>Уточните упражнение</small><strong>{item.sourceText.replace(/\s*\d.*$/u, '').trim() || 'Не удалось точно распознать'}</strong></span><button type="button" className="assistant-workout-remove" onClick={() => onRemove(item.sourceText)} aria-label={`Удалить ${item.sourceText}`}>×</button></div><WorkoutMetricFields sourceText={item.sourceText} setCount={item.sets?.length || 1} reps={firstSet?.reps} weightKg={firstSet?.weightKg} onChange={onUpdateMetrics} /><div className="assistant-exercise-options">{item.suggestedExerciseRefs.map((ref) => { const exercise = catalog.find((candidate) => candidate.ref === ref); return <button key={ref} type="button" onClick={() => onChoose(item.sourceText, ref)}>{exercise?.name ?? 'Вариант упражнения'}{exercise?.equipment ? <small>{exercise.equipment}</small> : null}</button> })}</div></div> })}
    </div>{mode === 'confirm' && !unmatched.length && result.items.length > 0 && <button type="button" className="primary" onClick={onSave} disabled={saving || saved}>{saved ? 'Тренировка сохранена' : saving ? 'Сохраняю…' : 'Сохранить тренировку'}</button>}</div>}
    {mode === 'collecting' && <p className="assistant-flow-guidance">Надиктуйте следующее упражнение — оно добавится сюда.</p>}
    {error && <p className="assistant-card-hint" role="alert">{error}</p>}
    {!saved && <div className="assistant-flow-actions">{mode === 'collecting' && <button type="button" className="primary" onClick={onFinish} disabled={!canFinish}>Проверить и сохранить</button>}<button type="button" className="assistant-action-cancel" onClick={onCancel}>Отменить сценарий</button></div>}
  </div>
}

function WorkoutMetricFields({ sourceText, setCount, reps, weightKg, onChange }: { sourceText: string; setCount: number; reps?: number; weightKg?: number; onChange: (sourceText: string, patch: MetricPatch) => void }) {
  return <div className="assistant-workout-metrics" aria-label={`Параметры ${sourceText}`}>
    <label><input aria-label="Подходы" type="number" min="1" max="20" value={setCount} onChange={(event) => onChange(sourceText, { setCount: Number(event.target.value) || 1 })} /><small>подх.</small></label>
    <label><input aria-label="Повторы" type="number" min="1" value={reps ?? ''} placeholder="—" onChange={(event) => { const value = Number(event.target.value); if (value > 0) onChange(sourceText, { reps: value }) }} /><small>повт.</small></label>
    <label><input aria-label="Вес" type="number" min="0" step="0.5" value={weightKg ?? ''} placeholder="—" onChange={(event) => { const value = Number(event.target.value); if (value >= 0 && event.target.value !== '') onChange(sourceText, { weightKg: value }) }} /><small>кг</small></label>
  </div>
}
