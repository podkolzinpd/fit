import { useEffect, useMemo, useRef, useState } from 'react'
import { PRESET_REST_DEFAULTS } from '../../data/repositories/workout-rules'
import type { WorkoutParseResponse } from '../../data/repositories/exercises.repository'
import type { ExerciseSnapshot } from '../../shared/domain'
import { MicIcon } from '../../shared/icons'
import { parseStructuredQuickWorkoutEntry, quickWorkoutExerciseName, type ParsedWorkoutExercise } from './quick-workout-entry'
import { orderParsedWorkoutItems, parsedWorkoutItems, parseWorkoutWithLlm, resolveWorkoutParseChoice, workoutParseSetSummary, workoutParseUnmatched, type WorkoutParseUnmatchedView } from './llm-workout-parser'
import { trackGoal } from '../../shared/yandex-metrika'
import { WorkoutComposer } from './WorkoutComposer'

interface QuickWorkoutEntryProps {
  catalog: readonly ExerciseSnapshot[]
  onAdd: (exercises: ParsedWorkoutExercise[]) => void
  preferredExerciseRefs?: readonly string[]
  onOpenCatalog?: (search: string, onSelect?: (exercise: ExerciseSnapshot) => void) => void
  compact?: boolean
  parseWorkout: (text: string, systemCatalog: readonly ExerciseSnapshot[]) => Promise<WorkoutParseResponse>
}

type ParsedEntry = { id: string; groupId?: string; parsed?: ParsedWorkoutExercise; unmatched?: WorkoutParseUnmatchedView }

export function QuickWorkoutEntry({ catalog, onAdd, preferredExerciseRefs = [], onOpenCatalog, compact = false, parseWorkout }: QuickWorkoutEntryProps) {
  const [text, setText] = useState('')
  const [choices, setChoices] = useState<Record<string, ExerciseSnapshot>>({})
  const [expanded, setExpanded] = useState(!compact)
  const [entries, setEntries] = useState<ParsedEntry[]>([])
  const [parsedText, setParsedText] = useState('')
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const requestVersion = useRef(0)
  const hasStructure = entries.some((entry) => entry.groupId)
  const parsedResolved = useMemo(() => entries.flatMap((entry) => {
    const item = entry.parsed ?? (entry.unmatched && choices[entry.id]
      ? resolveWorkoutParseChoice(entry.unmatched, choices[entry.id]!)
      : undefined)
    return item ? [{ entry, item }] : []
  }), [choices, entries])
  const circuitRest = PRESET_REST_DEFAULTS.circuit
  const resolved = useMemo(() => {
    if (!hasStructure) return orderParsedWorkoutItems(parsedResolved.map(({ item }) => item))
    const roundsByGroup = new Map<string, number>()
    for (const { entry, item } of parsedResolved) {
      if (entry.groupId) roundsByGroup.set(entry.groupId, Math.max(roundsByGroup.get(entry.groupId) ?? 1, item.sets.length, 1))
    }
    return parsedResolved.map(({ entry, item }) => entry.groupId ? {
      ...item,
      structure: {
        blockId: entry.groupId,
        blockType: 'group' as const,
        blockPreset: 'circuit' as const,
        blockRounds: roundsByGroup.get(entry.groupId) ?? 1,
        restBetweenExercisesSec: circuitRest.betweenExercises,
        restBetweenRoundsSec: circuitRest.betweenRounds,
      },
    } : item)
  }, [circuitRest.betweenExercises, circuitRest.betweenRounds, hasStructure, parsedResolved])
  const unresolved = useMemo(() => entries.flatMap((entry) => entry.unmatched && !choices[entry.id] ? [{ key: entry.id, item: entry.unmatched }] : []), [choices, entries])
  const structuredPreviewBlocks = useMemo(() => {
    if (!hasStructure) return []
    const blocks: Array<{ key: string; groupId?: string; rows: Array<{ key: string; label: string; summary?: string }> }> = []
    for (const entry of entries) {
      const selected = entry.parsed ?? (entry.unmatched && choices[entry.id]
        ? resolveWorkoutParseChoice(entry.unmatched, choices[entry.id]!)
        : undefined)
      const last = blocks.at(-1)
      const block = last && last.groupId === entry.groupId
        ? last
        : { key: entry.groupId ?? entry.id, groupId: entry.groupId, rows: [] }
      if (block !== last) blocks.push(block)
      block.rows.push({
        key: entry.id,
        label: selected?.exercise.name ?? `«${entry.unmatched?.line ?? ''}» — требует уточнения`,
        summary: selected ? workoutParseSetSummary(selected) : undefined,
      })
    }
    return blocks
  }, [choices, entries, hasStructure])
  const clarification = useMemo(() => {
    const hasAmbiguous = unresolved.some(({ item }) => item.reason === 'ambiguous')
    const hasNotFound = unresolved.some(({ item }) => item.reason === 'not-found')
    if (hasAmbiguous && hasNotFound) return { title: 'Уточните упражнения', text: 'Выберите вариант ниже или дополните название.' }
    if (hasAmbiguous) return { title: 'Уточните упражнение', text: 'Выберите вариант ниже или допишите деталь: положение, тренажёр или оборудование.' }
    if (hasNotFound) return { title: 'Не нашли упражнение', text: 'Допишите название точнее или выберите его из каталога.' }
    return null
  }, [unresolved])

  useEffect(() => setExpanded(!compact), [compact])

  function changeText(value: string) {
    requestVersion.current += 1
    setText(value)
    setParsedText('')
    setEntries([])
    setChoices({})
    setParseError(null)
    setParsing(false)
  }

  async function review(value = text) {
    const normalized = value.trim()
    if (!normalized) return
    const request = ++requestVersion.current
    setParsing(true)
    setParseError(null)
    setChoices({})
    try {
      const structure = parseStructuredQuickWorkoutEntry(normalized, catalog, { preferredExerciseRefs })
      const nextEntries: ParsedEntry[] = []
      if (structure.hasStructure) {
        for (const source of structure.items) {
          const response = await parseWorkoutWithLlm(source.line, catalog, { remoteParser: parseWorkout })
          parsedWorkoutItems(response, catalog).forEach((item, index) => nextEntries.push({ id: `${source.id}:item:${index}`, groupId: source.groupId, parsed: item }))
          workoutParseUnmatched(response, catalog).forEach((item, index) => nextEntries.push({ id: `${source.id}:unmatched:${index}`, groupId: source.groupId, unmatched: item }))
        }
      } else {
        const response = await parseWorkoutWithLlm(normalized, catalog, { remoteParser: parseWorkout })
        const ordered: Array<ParsedEntry & { position?: number }> = [
          ...parsedWorkoutItems(response, catalog).map((item, index) => ({ id: `item:${index}`, parsed: item, position: item.sourcePosition })),
          ...workoutParseUnmatched(response, catalog).map((item, index) => ({ id: `unmatched:${index}`, unmatched: item, position: item.position })),
        ].sort((left, right) => (left.position ?? Number.MAX_SAFE_INTEGER) - (right.position ?? Number.MAX_SAFE_INTEGER))
        nextEntries.push(...ordered.map(({ id, parsed, unmatched }) => ({ id, parsed, unmatched })))
      }
      if (request !== requestVersion.current) return
      setEntries(nextEntries)
      setParsedText(value)
      if (!nextEntries.length) setParseError('Не удалось распознать упражнения. Уточните текст или выберите их из каталога.')
    } catch {
      if (request !== requestVersion.current) return
      setParseError('Не удалось обработать запись. Исходный текст сохранён — попробуйте ещё раз.')
    } finally {
      if (request === requestVersion.current) setParsing(false)
    }
  }

  function add() {
    if (!resolved.length || (hasStructure && unresolved.length)) return
    if (unresolved.some(({ item }) => item.reason === 'ambiguous')) trackGoal('workout_parse_ambiguous')
    if (unresolved.some(({ item }) => item.reason === 'not-found')) trackGoal('workout_parse_not_found')
    onAdd(resolved)
    setText(''); setParsedText(''); setEntries([])
    setChoices({})
  }

  if (!expanded) return <button type="button" className="secondary wide quick-workout-expand" onClick={() => setExpanded(true)}><MicIcon />Добавить голосом или текстом</button>

  return <div className={`quick-workout-entry${compact ? ' expanded' : ''}`}>
    {compact && <button type="button" className="link quick-workout-collapse" onClick={() => setExpanded(false)}>Свернуть ввод</button>}
    <WorkoutComposer name="quick-workout-entry" source="workout_quick_entry" label="Запись тренировки" voiceLabel="Надиктовать тренировку" value={text} onValueChange={changeText} onTranscriptValueChange={changeText} onTranscriptAppended={({ value }) => review(value)} onClear={() => changeText('')} primaryAction={parsedText === text && entries.length > 0
      ? <button type="button" className="secondary wide quick-workout-add" disabled={!resolved.length || (hasStructure && unresolved.length > 0)} onClick={add}>Добавить в план{resolved.length ? ` (${resolved.length})` : ''}</button>
      : <button type="button" className="secondary wide quick-workout-add" disabled={!text.trim() || parsing} onClick={() => void review()}>{parsing ? 'Разбираю тренировку…' : 'Разобрать тренировку'}</button>} secondaryAction={onOpenCatalog ? <button type="button" className="secondary wide quick-workout-catalog" onClick={() => { trackGoal('exercise_picker_opened'); onOpenCatalog('') }}>Выбрать упражнения</button> : undefined}>
      <p className="workout-composer-hint">Например: присед 3×8 80 кг или бег 30 минут 5 км. Для нового упражнения скажите «затем».</p>
      {parseError && <p className="error" role="alert">{parseError}</p>}
      {parsedText === text && entries.length > 0 && <div className="quick-workout-preview" aria-live="polite">
        {hasStructure
          ? structuredPreviewBlocks.length > 0 && <div className="quick-workout-structure"><p><strong>Упражнения: {entries.length}</strong></p>{structuredPreviewBlocks.map((block) => <section key={block.key} className={block.groupId ? 'quick-workout-circuit' : 'quick-workout-singles'}>{block.groupId && <p className="quick-workout-circuit-title"><strong>Круговая · {block.rows.length} упр.</strong></p>}<ul>{block.rows.map((row) => <li key={row.key}>{row.label}{row.summary ? ` · ${row.summary}` : ''}</li>)}</ul></section>)}</div>
          : resolved.length > 0 && <section className="today-recognized"><p><strong>Распознано: {resolved.length}</strong></p><ul>{resolved.map((item, index) => <li key={`${item.exercise.ref}-${index}`}><strong>{item.exercise.name}</strong><span>{workoutParseSetSummary(item)}</span></li>)}</ul></section>}
        {clarification && <section className="quick-workout-clarification" aria-label={clarification.title}><strong>{clarification.title}</strong><p>{clarification.text}</p></section>}
        {unresolved.length > 0 && <div className="quick-workout-unparsed">{unresolved.map(({ key, item }) => <div className="quick-workout-unparsed-line" key={key}><p>«{item.line}» — {item.reason === 'ambiguous' ? 'выберите вариант' : 'не нашли совпадение'}</p>{item.candidates.length > 0 && <div className="quick-workout-candidates">{item.candidates.map((exercise) => <button type="button" className={choices[key]?.ref === exercise.ref ? 'secondary selected' : 'secondary'} key={exercise.ref} onClick={() => { trackGoal('workout_parse_candidate_selected'); setChoices((current) => ({ ...current, [key]: exercise })) }}>{exercise.name}</button>)}</div>}{onOpenCatalog && <button type="button" className="link quick-workout-all-options" onClick={() => { trackGoal('workout_parse_catalog_opened'); onOpenCatalog(quickWorkoutExerciseName(item.line), (exercise) => setChoices((current) => ({ ...current, [key]: exercise }))) }}>Все варианты</button>}</div>)}</div>}
      </div>}
    </WorkoutComposer>
  </div>
}
