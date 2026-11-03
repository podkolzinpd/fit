import { readQuickWorkoutEntryDraft, type QuickWorkoutEntryDraft, type QuickWorkoutEntryItem } from './quick-workout-draft'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEventHandler } from 'react'
import { PRESET_REST_DEFAULTS } from '../../data/repositories/workout-rules'
import type { WorkoutParseResponse } from '../../shared/workout-parse-response'
import type { ExerciseSnapshot } from '../../shared/domain'
import { AddIcon, CopyIcon, KeyboardIcon, MicIcon } from '../../shared/icons'
import { parseStructuredQuickWorkoutEntry, quickWorkoutExerciseName, type ParsedWorkoutExercise } from './quick-workout-entry'
import { orderParsedWorkoutItems, parsedWorkoutItems, parseWorkoutWithLlm, resolveWorkoutParseChoice, workoutParseSetSummary, workoutParseUnmatched, } from './llm-workout-parser'
import { trackGoal } from '../../shared/yandex-metrika'
import { flushSync } from 'react-dom'
import { WorkoutComposer } from './WorkoutComposer'

interface QuickWorkoutEntryProps {
  initialText?: string
  initialSnapshot?: QuickWorkoutEntryDraft
  onDraftChange?: (draft: QuickWorkoutEntryDraft) => void
  onBusyChange?: (busy: boolean) => void
  methods?: { onTemplate?: MouseEventHandler<HTMLButtonElement>; onExercise: () => void }
  catalog: readonly ExerciseSnapshot[]
  onAdd: (exercises: ParsedWorkoutExercise[]) => void | boolean | Promise<unknown>
  preferredExerciseRefs?: readonly string[]
  onOpenCatalog?: (search: string, onSelect?: (exercise: ExerciseSnapshot) => void) => void
  compact?: boolean
  reference?: boolean
  disabled?: boolean
  placeholder?: string
  parseWorkout: (text: string, systemCatalog: readonly ExerciseSnapshot[]) => Promise<WorkoutParseResponse>
}

type ParsedEntry = QuickWorkoutEntryItem

export function QuickWorkoutEntry({ initialText, initialSnapshot, onDraftChange, onBusyChange, methods, catalog, onAdd, preferredExerciseRefs = [], onOpenCatalog, compact = false, reference = false, disabled = false, placeholder, parseWorkout }: QuickWorkoutEntryProps) {
  const [restored] = useState(() => readQuickWorkoutEntryDraft(initialSnapshot, initialText))
  const [text, setText] = useState(restored?.text ?? initialText ?? '')
  const [choices, setChoices] = useState<Record<string, ExerciseSnapshot>>(restored?.choices ?? {})
  const [expanded, setExpanded] = useState(!compact && !methods)
  const [entries, setEntries] = useState<ParsedEntry[]>(restored?.entries ?? [])
  const [parsedText, setParsedText] = useState(restored?.parsedText ?? '')
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [voiceBusy, setVoiceBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const locked = useRef(disabled)
  useLayoutEffect(() => { locked.current = disabled || adding }, [disabled, adding])
  const requestVersion = useRef(0)
  const activeReviewText = useRef<string | null>(null)
  const active = useRef(true)
  const entryRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    active.current = true
    return () => { active.current = false; requestVersion.current += 1 }
  }, [])
  const hadContent = useRef(Boolean(restored || initialText))
  useEffect(() => {
    if (!hadContent.current && !text && !parsedText && !entries.length && !Object.keys(choices).length) return
    hadContent.current = true
    onDraftChange?.({ text, parsedText, entries, choices })
  }, [text, parsedText, entries, choices, onDraftChange])
  useEffect(() => { onBusyChange?.(parsing || voiceBusy || adding) }, [parsing, voiceBusy, adding, onBusyChange])
  function openInput(voice: boolean) {
    if (locked.current) return
    flushSync(() => setExpanded(true))
    if (voice) entryRef.current?.querySelector<HTMLButtonElement>('.voice-input-button')?.click()
    else entryRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus()
  }
  const hasStructure = entries.some((entry) => entry.groupId)
  const parsedResolved = useMemo(() => entries.flatMap((entry) => {
    const item = entry.parsed ?? (entry.unmatched && choices[entry.id]
      ? resolveWorkoutParseChoice(entry.unmatched, choices[entry.id]!)
      : undefined)
    return item ? [{ entry, item }] : []
  }), [choices, entries])
  const supersetRest = PRESET_REST_DEFAULTS.set
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
        blockPreset: 'set' as const,
        blockRounds: roundsByGroup.get(entry.groupId) ?? 1,
        restBetweenExercisesSec: supersetRest.betweenExercises,
        restBetweenRoundsSec: supersetRest.betweenRounds,
      },
    } : item)
  }, [supersetRest.betweenExercises, supersetRest.betweenRounds, hasStructure, parsedResolved])
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

  const hasMethods = Boolean(methods)
  useEffect(() => setExpanded(!compact && !hasMethods), [compact, hasMethods])

  function changeText(value: string) {
    if (locked.current || !active.current) return
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
    if (locked.current || !active.current || !normalized || activeReviewText.current === normalized) return
    activeReviewText.current = normalized
    const request = ++requestVersion.current
    setParsing(true)
    setParseError(null)
    setChoices({})
    try {
      const structure = parseStructuredQuickWorkoutEntry(normalized, catalog, { preferredExerciseRefs })
      const nextEntries: ParsedEntry[] = []
      if (structure.hasStructure) {
        const response = await parseWorkoutWithLlm(structure.items.map((source) => source.line).join('\n'), catalog, { remoteParser: parseWorkout })
        const ordered: Array<ParsedEntry & { position?: number }> = [
          ...parsedWorkoutItems(response, catalog).map((item, index) => ({
            id: `${structure.items[item.sourcePosition ?? index]?.id ?? `item:${index}`}:item`,
            groupId: structure.items[item.sourcePosition ?? index]?.groupId,
            parsed: item,
            position: item.sourcePosition,
          })),
          ...workoutParseUnmatched(response, catalog).map((item, index) => ({
            id: `${structure.items[item.position ?? index]?.id ?? `unmatched:${index}`}:unmatched`,
            groupId: structure.items[item.position ?? index]?.groupId,
            unmatched: item,
            position: item.position,
          })),
        ].sort((left, right) => (left.position ?? Number.MAX_SAFE_INTEGER) - (right.position ?? Number.MAX_SAFE_INTEGER))
        nextEntries.push(...ordered.map(({ id, groupId, parsed, unmatched }) => ({ id, groupId, parsed, unmatched })))
      } else {
        const response = await parseWorkoutWithLlm(normalized, catalog, { remoteParser: parseWorkout })
        const ordered: Array<ParsedEntry & { position?: number }> = [
          ...parsedWorkoutItems(response, catalog).map((item, index) => ({ id: `item:${index}`, parsed: item, position: item.sourcePosition })),
          ...workoutParseUnmatched(response, catalog).map((item, index) => ({ id: `unmatched:${index}`, unmatched: item, position: item.position })),
        ].sort((left, right) => (left.position ?? Number.MAX_SAFE_INTEGER) - (right.position ?? Number.MAX_SAFE_INTEGER))
        nextEntries.push(...ordered.map(({ id, parsed, unmatched }) => ({ id, parsed, unmatched })))
      }
      if (!active.current || locked.current || request !== requestVersion.current) return
      setEntries(nextEntries)
      setParsedText(value)
      if (!nextEntries.length) setParseError('Не удалось распознать упражнения. Уточните текст или выберите их из каталога.')
    } catch {
      if (!active.current || locked.current || request !== requestVersion.current) return
      setParseError('Не удалось обработать запись. Исходный текст сохранён — попробуйте ещё раз.')
    } finally {
      if (activeReviewText.current === normalized) activeReviewText.current = null
      if (request === requestVersion.current) setParsing(false)
    }
  }

  async function add() {
    if (locked.current || adding || !resolved.length || (hasStructure && unresolved.length)) return
    if (unresolved.some(({ item }) => item.reason === 'ambiguous')) trackGoal('workout_parse_ambiguous')
    if (unresolved.some(({ item }) => item.reason === 'not-found')) trackGoal('workout_parse_not_found')
    setAdding(true)
    try {
      const result = await onAdd(resolved)
      if (!active.current || result === false) return
      setText(''); setParsedText(''); setEntries([]); setChoices({})
    } catch {
      if (active.current) setParseError('Не удалось добавить упражнения. Исходный текст сохранён — попробуйте ещё раз.')
    } finally { if (active.current) setAdding(false) }
  }

  if (!expanded && !methods) return <button type="button" disabled={disabled} className="secondary wide quick-workout-expand" onClick={() => setExpanded(true)}><MicIcon />{reference ? 'Надиктовать' : 'Добавить голосом или текстом'}</button>

  return <div ref={entryRef} className={`quick-workout-entry${compact ? ' expanded' : ''}`}>
    {methods && <div className={`trainer-plan-methods${methods.onTemplate ? '' : ' trainer-template-methods'}`} role="group" aria-label="Добавить упражнения">
      <button type="button" className="secondary" disabled={disabled || parsing || voiceBusy || adding} aria-label="Выбрать упражнения" onClick={methods.onExercise}><AddIcon />Упражнение</button>
      {methods.onTemplate && <button aria-label="Добавить шаблон" type="button" className="secondary" disabled={disabled || parsing || voiceBusy || adding} onClick={methods.onTemplate}><CopyIcon />Шаблон</button>}
      <button type="button" className="secondary trainer-method-voice" disabled={disabled} onClick={() => openInput(true)}><MicIcon />Надиктовать</button>
      <button type="button" className="secondary" disabled={disabled} onClick={() => openInput(false)}><KeyboardIcon />Ввести текстом</button>
    </div>}
    {expanded && <>
    {compact && <button type="button" className="link quick-workout-collapse" onClick={() => setExpanded(false)}>Свернуть ввод</button>}
    <WorkoutComposer name="quick-workout-entry" source="workout_quick_entry" disabled={disabled || adding} onBusyChange={setVoiceBusy} placeholder={placeholder} label="Запись тренировки" voiceLabel="Надиктовать тренировку" value={text} onValueChange={changeText} onTranscriptValueChange={changeText} onTranscriptAppended={({ value }) => review(value)} onClear={() => changeText('')} primaryAction={parsedText === text && entries.length > 0
      ? <button type="button" className="secondary wide quick-workout-add" disabled={!resolved.length || (hasStructure && unresolved.length > 0)} onClick={() => void add()}>Добавить в план{resolved.length ? ` (${resolved.length})` : ''}</button>
      : <button type="button" className="secondary wide quick-workout-add" disabled={!text.trim() || parsing} onClick={() => void review()}>{parsing ? 'Разбираю тренировку…' : 'Разобрать тренировку'}</button>} secondaryAction={onOpenCatalog ? <button type="button" className="secondary wide quick-workout-catalog" onClick={() => { trackGoal('exercise_picker_opened'); onOpenCatalog('') }}>Выбрать упражнения</button> : undefined}>
      <p className="workout-composer-hint">Например: присед 3×8 80 кг или бег 30 минут 5 км. Для нового упражнения скажите «затем».</p>
      {parseError && <p className="error" role="alert">{parseError}</p>}
      {parsedText === text && entries.length > 0 && <div className="quick-workout-preview" aria-live="polite">
        {hasStructure
          ? structuredPreviewBlocks.length > 0 && <div className="quick-workout-structure"><p><strong>Упражнения: {entries.length}</strong></p>{structuredPreviewBlocks.map((block) => <section key={block.key} className={block.groupId ? 'quick-workout-circuit' : 'quick-workout-singles'}>{block.groupId && <p className="quick-workout-circuit-title"><strong>Суперсет · {block.rows.length} упр.</strong></p>}<ul>{block.rows.map((row) => <li key={row.key}>{row.label}{row.summary ? ` · ${row.summary}` : ''}</li>)}</ul></section>)}</div>
          : resolved.length > 0 && <section className="today-recognized"><p><strong>Распознано: {resolved.length}</strong></p><ul>{resolved.map((item, index) => <li key={`${item.exercise.ref}-${index}`}><strong>{item.exercise.name}</strong><span>{workoutParseSetSummary(item)}</span></li>)}</ul></section>}
        {clarification && <section className="quick-workout-clarification" aria-label={clarification.title}><strong>{clarification.title}</strong><p>{clarification.text}</p></section>}
        {unresolved.length > 0 && <div className="quick-workout-unparsed">{unresolved.map(({ key, item }) => <div className="quick-workout-unparsed-line" key={key}><p>«{item.line}» — {item.reason === 'ambiguous' ? 'выберите вариант' : 'не нашли совпадение'}</p>{item.candidates.length > 0 && <div className="quick-workout-candidates">{item.candidates.map((exercise) => <button type="button" className={choices[key]?.ref === exercise.ref ? 'secondary selected' : 'secondary'} key={exercise.ref} onClick={() => { trackGoal('workout_parse_candidate_selected'); setChoices((current) => ({ ...current, [key]: exercise })) }}>{exercise.name}</button>)}</div>}{onOpenCatalog && <button type="button" className="link quick-workout-all-options" onClick={() => { trackGoal('workout_parse_catalog_opened'); onOpenCatalog(quickWorkoutExerciseName(item.line), (exercise) => setChoices((current) => ({ ...current, [key]: exercise }))) }}>Все варианты</button>}</div>)}</div>}
      </div>}
    </WorkoutComposer>
    </>}
  </div>
}
