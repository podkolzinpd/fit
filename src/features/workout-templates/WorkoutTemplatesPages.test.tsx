import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkoutTemplate, WorkoutTemplateDraft } from '../../shared/domain'
import { WorkoutTemplateEditorPage, WorkoutTemplatesPage } from './WorkoutTemplatesPages'
import { readWorkoutTemplateDraft, workoutTemplateDraftKey, writeWorkoutTemplateDraft } from './workout-template-draft'

const backend = vi.hoisted(() => ({ workoutTemplates: { save: vi.fn<(draft: WorkoutTemplateDraft) => Promise<string>>(), list: vi.fn<() => Promise<WorkoutTemplate[]>>(), get: vi.fn(), archive: vi.fn() }, workouts: { get: vi.fn() }, exercises: { parseWorkout: vi.fn() } }))
const account = vi.hoisted(() => ({ userId: 'trainer' }))
vi.mock('../../app/auth-context', () => ({ useAuth: () => ({ actor: { userId: account.userId, role: 'trainer' } }) }))
vi.mock('../../app/data-backend-context', () => ({ useDataBackend: () => backend }))
vi.mock('../exercises', () => ({ useExerciseCatalog: () => ({ exercises: [] }), ExercisePicker: () => null }))
vi.mock('../voice-input', () => ({ VoiceNoteField: () => null }))
vi.mock('../workouts', () => ({
  WorkoutHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  QuickWorkoutEntry: () => null, WorkoutExerciseEditor: () => null,
  WorkoutCta: ({ pending, pendingLabel, disabled, children, ...props }: { pending: boolean; pendingLabel: string; disabled: boolean; children: React.ReactNode }) => <button {...props} disabled={pending || disabled}>{pending ? pendingLabel : children}</button>,
}))
const template: WorkoutTemplate = {
  id: '10000000-0000-4000-8000-000000000001', trainerId: '10000000-0000-4000-8000-000000000002',
  name: 'Ноги', version: 1, createdAt: '2026-10-07T00:00:00Z', updatedAt: '2026-10-07T00:00:00Z',
  exercises: [{ source: 'system', ref: 'squat', name: 'Присед', muscleGroup: 'legs', inputKind: 'strength', position: 0, blockId: 'block', sets: [{ position: 0, weightKg: 50.5, reps: 8 }] }],
}
function open(route = '/schedule/templates/new/editor?sourceWorkout=source') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={[route]}><Routes>
    <Route path="/schedule/templates/new/editor" element={<WorkoutTemplateEditorPage />} />
    <Route path="/schedule/templates/:templateId/edit" element={<WorkoutTemplateEditorPage />} />
    <Route path="/schedule/templates" element={<WorkoutTemplatesPage />} />
  </Routes></MemoryRouter></QueryClientProvider>
  const view = render(tree())
  return { ...view, refresh: () => view.rerender(tree()) }
}
beforeEach(() => {
  vi.clearAllMocks()
  account.userId = 'trainer'
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) })
  backend.workoutTemplates.list.mockResolvedValue([template])
  backend.workoutTemplates.get.mockResolvedValue(template)
  backend.workouts.get.mockResolvedValue({ ...template, notes: 'План', exercises: template.exercises.map((exercise) => ({ ...exercise, sets: exercise.sets.map((set) => ({ ...set, fact: { weightKg: 70 }, confirmedAt: '2026-10-07T00:00:00Z' })) })) })
  backend.workoutTemplates.save.mockResolvedValue(template.id)
})
describe('template save commands', () => {
  it('shows a source load error and retries only the enabled source without blanking the draft', async () => {
    backend.workouts.get.mockRejectedValueOnce(new Error('Источник недоступен'))
    open()
    await screen.findByText('Не удалось загрузить данные')
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(screen.getByLabelText('Название шаблона')).toHaveValue('Новый шаблон'))
    expect(backend.workoutTemplates.get).not.toHaveBeenCalled()
  })
  it('isolates account changes and ignores navigation from an old pending save', async () => {
    let complete: (value: string) => void = () => {}
    backend.workoutTemplates.save.mockImplementationOnce(() => new Promise<string>((resolve) => { complete = resolve }))
    const view = open()
    await waitFor(() => expect(screen.getByLabelText('Название шаблона')).toHaveValue('Новый шаблон'))
    fireEvent.change(screen.getByLabelText('Название шаблона'), { target: { value: 'Частный черновик' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить шаблон' }))
    await waitFor(() => expect(backend.workoutTemplates.save).toHaveBeenCalledOnce())
    account.userId = 'other-trainer'
    view.refresh()
    await waitFor(() => expect(screen.getByLabelText('Название шаблона')).toHaveValue('Новый шаблон'))
    complete(template.id)
    await waitFor(() => expect(readWorkoutTemplateDraft(workoutTemplateDraftKey('trainer', undefined, 'source'))).toBeNull())
    expect(screen.getByLabelText('Название шаблона')).toHaveValue('Новый шаблон')
    expect(screen.queryByRole('heading', { name: 'Шаблоны тренировок' })).not.toBeInTheDocument()
  })
  it('restores a draft without upgrading its stale base version', async () => {
    const key = workoutTemplateDraftKey('trainer', template.id)
    writeWorkoutTemplateDraft(key, { ...template, name: 'Черновик', notes: 'Не терять', version: 1 })
    backend.workoutTemplates.get.mockResolvedValue({ ...template, name: 'Новая серверная версия', version: 2 })
    backend.workoutTemplates.save.mockRejectedValue(new Error('Конфликт версии'))
    open(`/schedule/templates/${template.id}/edit`)
    await waitFor(() => expect(screen.getByLabelText('Название шаблона')).toHaveValue('Черновик'))
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить шаблон' }))
    await screen.findByRole('alert')
    expect(backend.workoutTemplates.save.mock.calls[0]![0]).toMatchObject({ id: template.id, name: 'Черновик', notes: 'Не терять', version: 1 })
    expect(readWorkoutTemplateDraft(key)?.name).toBe('Черновик')
  })
  it('persists a changed name and removes the draft only after confirmed success', async () => {
    const key = workoutTemplateDraftKey('trainer', undefined, 'source')
    open()
    await waitFor(() => expect(screen.getByLabelText('Название шаблона')).toHaveValue('Новый шаблон'))
    fireEvent.change(screen.getByLabelText('Название шаблона'), { target: { value: 'Черновик' } })
    await waitFor(() => expect(readWorkoutTemplateDraft(key)?.name).toBe('Черновик'))
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить шаблон' }))
    await screen.findByRole('heading', { name: 'Шаблоны тренировок' })
    expect(readWorkoutTemplateDraft(key)).toBeNull()
  })
  it('reuses the entire create command on retry after a lost response', async () => {
    backend.workoutTemplates.save.mockRejectedValueOnce(new Error('Ответ потерян'))
    open()
    const name = await screen.findByLabelText('Название шаблона')
    await waitFor(() => expect(name).toHaveValue('Новый шаблон'))
    fireEvent.change(name, { target: { value: 'Новый план' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить шаблон' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Ответ потерян')
    const first = backend.workoutTemplates.save.mock.calls[0]![0]
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить шаблон' }))
    await waitFor(() => expect(backend.workoutTemplates.save).toHaveBeenCalledTimes(2))
    expect(backend.workoutTemplates.save.mock.calls[1]![0]).toEqual(first)
    expect(JSON.stringify(first)).not.toContain('fact')
    expect(JSON.stringify(first)).not.toContain('confirmedAt')
  })
  it('keeps expectedVersion on a failed edit instead of overwriting a newer version', async () => {
    backend.workoutTemplates.save.mockRejectedValueOnce(new Error('Конфликт'))
    open(`/schedule/templates/${template.id}/edit`)
    await waitFor(() => expect(screen.getByLabelText('Название шаблона')).toHaveValue('Ноги'))
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить шаблон' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить шаблон' }))
    await waitFor(() => expect(backend.workoutTemplates.save).toHaveBeenCalledTimes(2))
    expect(backend.workoutTemplates.save.mock.calls.map(([value]) => [value.id, value.version])).toEqual([[template.id, 1], [template.id, 1]])
  })
  it('reuses an unconfirmed copy, then creates a fresh independent copy after success', async () => {
    backend.workoutTemplates.save.mockRejectedValueOnce(new Error('Ответ потерян'))
    open('/schedule/templates')
    const copy = async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Действия с шаблоном Ноги' }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Создать копию' }))
    }
    await copy()
    await screen.findByRole('alert')
    await copy()
    await waitFor(() => expect(backend.workoutTemplates.save).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    await copy()
    await waitFor(() => expect(backend.workoutTemplates.save).toHaveBeenCalledTimes(3))
    const [first, retry, next] = backend.workoutTemplates.save.mock.calls.map(([value]) => value)
    if (!first?.exercises[0] || !next?.exercises[0]) throw new Error('Copy commands are missing')
    expect(retry).toEqual(first)
    expect(next.id).not.toBe(first.id)
    expect(next.exercises[0].blockId).not.toBe(first.exercises[0].blockId)
  })
})
