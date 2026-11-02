import type { NavigateFunction } from 'react-router-dom'
import { appendWorkoutTemplateExercises } from '../../data/repositories/workout-template-rules'
import type { WorkoutTemplateDraft } from '../../shared/domain'
import { readWorkoutFormDraft, writeWorkoutFormDraft, workoutFormDraftKey, type WorkoutFormDraft } from './workout-form-draft'
import { safeWorkoutReturnTo, type WorkoutNavigationState } from './workout-navigation'

export interface TemplatePlanContext {
  returnHistoryIndex?: number
  draftKey: string
  returnTo: string
  navigationState?: WorkoutNavigationState
  requestId?: string
  sourceVersion?: number
  resumePlanRequestId?: string
  applyOnSave: boolean
}

export function readTemplatePlanContext(value: unknown, userId: string): TemplatePlanContext | undefined {
  if (!value || typeof value !== 'object') return undefined
  const context = value as Partial<TemplatePlanContext>
  if (typeof context.draftKey !== 'string' || !context.draftKey.startsWith(workoutFormDraftKey(userId, ''))
    || !safeWorkoutReturnTo(context.returnTo) || typeof context.applyOnSave !== 'boolean') return undefined
  const draft = readWorkoutFormDraft(context.draftKey)
  if (!draft || draft.recordCompleted || draft.requestId !== context.requestId || draft.sourceVersion !== context.sourceVersion) return undefined
  return context as TemplatePlanContext
}

/** Prove persistence before leaving the only in-memory copy of a plan. */
export function persistTemplateSource(key: string, draft: WorkoutFormDraft): boolean {
  writeWorkoutFormDraft(key, draft)
  const stored = readWorkoutFormDraft(key)
  return Boolean(stored && Object.entries(draft).every(([field, value]) => JSON.stringify(stored[field as keyof WorkoutFormDraft]) === JSON.stringify(value)))
}

/** The receipt and exercises are one local write, so retries never append twice. */
export function applyCreatedTemplate(context: TemplatePlanContext, template: WorkoutTemplateDraft): void {
  const source = readWorkoutFormDraft(context.draftKey)
  if (!source || source.recordCompleted || source.requestId !== context.requestId || source.sourceVersion !== context.sourceVersion) throw new Error('Исходный план изменился. Шаблон сохранён в библиотеке; вернитесь к плану и выберите его снова.')
  if (!template.id) throw new Error('Шаблон ещё не сохранён. Повторите сохранение.')
  if (!context.applyOnSave || source.appliedTemplateIds?.includes(template.id!)) return
  const updated = {
    ...source, title: source.title?.trim() ? source.title : template.name,
    notes: source.notes.trim() ? source.notes : template.notes ?? '',
    exercises: appendWorkoutTemplateExercises(source.exercises, template),
    appliedTemplateIds: [...source.appliedTemplateIds ?? [], template.id!],
  }
  if (!persistTemplateSource(context.draftKey, updated)) throw new Error('Шаблон сохранён, но не удалось добавить его в черновик на устройстве. Освободите хранилище и повторите сохранение.')
}

export function templatePlanReturnState(context: TemplatePlanContext): WorkoutNavigationState & { resumePlanRequestId?: string } {
  return { ...context.navigationState, templatePlanDraftKey: context.draftKey, ...(context.resumePlanRequestId ? { resumePlanRequestId: context.resumePlanRequestId } : {}) }
}

/** Return to the existing entry rather than stacking a second copy of the plan. */
export function templateReturnSteps(index: unknown): number | undefined {
  const current = (window.history.state as { idx?: unknown } | null)?.idx
  return typeof index === 'number' && Number.isSafeInteger(index) && index >= 0
    && typeof current === 'number' && Number.isSafeInteger(current) && current > index ? current - index : undefined
}

export function returnToTemplatePlan(context: TemplatePlanContext, navigate: NavigateFunction, replace = false): void {
  const steps = templateReturnSteps(context.returnHistoryIndex)
  if (steps) void navigate(-steps)
  else void navigate(context.returnTo, { replace, state: templatePlanReturnState(context) })
}
