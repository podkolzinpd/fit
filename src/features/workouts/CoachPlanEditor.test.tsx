import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkoutExerciseDraft } from '../../shared/domain'
import { WorkoutExerciseEditor } from './WorkoutExerciseEditor'
import { moveDraftBlockTo } from '../../data/repositories/workout-rules'

const singles: WorkoutExerciseDraft[] = ['Присед', 'Жим', 'Тяга'].map((name, position) => ({
  source: 'system', ref: `exercise-${position}`, name, position, muscleGroup: 'legs', inputKind: 'strength',
  blockId: `block-${position}`, blockType: 'single', sets: [{ position: 0, weightKg: 27.5 + position, reps: 8, rpe: 7 }],
}))
function Harness({ initial = singles, disabled = false, safePlanInput = false, showRpe = false }: { initial?: WorkoutExerciseDraft[]; disabled?: boolean; safePlanInput?: boolean; showRpe?: boolean }) {
  const [draft, setDraft] = useState(initial)
  return <><WorkoutExerciseEditor reference showSetRemovalMenu safePlanInput={safePlanInput} showRpeByDefault={showRpe} disabled={disabled} exercises={draft} onChange={setDraft} onOpenPicker={vi.fn()} onReplaceExercise={vi.fn()} /><output aria-label="Черновик">{JSON.stringify(draft)}</output></>
}
function draft() { return JSON.parse(screen.getByLabelText('Черновик').textContent!) as WorkoutExerciseDraft[] }
// jsdom has no pointer capture; exercise the real menu/focus handlers below.
beforeEach(() => { HTMLElement.prototype.setPointerCapture = vi.fn() })

describe('coach reference plan editor', () => {
  it('leaves other reference consumers without the trainer menu opt-in unchanged', async () => {
    const user = userEvent.setup()
    render(<WorkoutExerciseEditor reference exercises={[{ ...singles[0]!, sets: [singles[0]!.sets[0]!, { position: 1, weightKg: 42.5, reps: 6 }] }]}
      onChange={vi.fn()} onOpenPicker={vi.fn()} onReplaceExercise={vi.fn()} />)
    await user.click(screen.getByLabelText('Вес, подход 2'))
    await user.click(screen.getByRole('button', { name: 'Ещё действия' }))
    expect(screen.getByRole('menuitem', { name: 'Удалить' })).toBeEnabled()
    expect(screen.queryByRole('menuitem', { name: /Удалить подход/ })).not.toBeInTheDocument()
  })
  // Nested time input, cardio input and native RPE select have different focus paths.
  it.each([
    { inputKind: 'duration', ref: 'plank', label: 'Время, подход 2: минуты' },
    { inputKind: 'distance', ref: 'rowing-machine', label: 'Расстояние, подход 2' },
    { inputKind: 'strength', ref: 'exercise-0', label: 'Целевой RPE, подход 2' },
  ] as const)('selects the set from $label without changing neighbouring metrics', async ({ inputKind, ref, label }) => {
    const user = userEvent.setup()
    const sets = [0, 1].map(position => ({ position, durationSec: 60 * (position + 1), distanceKm: position + 1, weightKg: 20, reps: 10, rpe: 7 }))
    render(<Harness initial={[{ ...singles[0]!, inputKind, ref, sets }]} safePlanInput showRpe />)
    await user.click(screen.getByLabelText(label, { exact: true }))
    await user.click(screen.getByRole('button', { name: 'Ещё действия' }))
    await user.click(screen.getByRole('menuitem', { name: 'Удалить подход 2' }))
    await user.click(screen.getByRole('button', { name: 'Удалить подход' }))
    expect(draft()[0]!.sets).toEqual([sets[0]])
  })
  it('deletes only the selected middle set through the shared confirmation and preserves cancel', async () => {
    const user = userEvent.setup()
    const initial = [{ ...singles[0]!, sets: [27.5, 30, 32.5].map((weightKg, position) => ({ position, weightKg, reps: 8 + position, rpe: 7 })) }, singles[1]!]
    render(<Harness initial={initial} />)
    const exercise = screen.getAllByRole('article')[0]!
    const menu = () => user.click(within(exercise).getByRole('button', { name: 'Ещё действия' }))
    await menu()
    expect(screen.getByRole('menuitem', { name: 'Удалить подход' })).toBeDisabled()
    await user.click(within(exercise).getByLabelText('Вес, подход 2'))
    await user.clear(within(exercise).getByLabelText('Вес, подход 2'))
    await user.type(within(exercise).getByLabelText('Вес, подход 2'), '31.5')
    await menu()
    await user.click(screen.getByRole('menuitem', { name: 'Удалить подход 2' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Удалить подход 2 упражнения «Присед»')
    await user.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(draft()[0]!.sets.map(set => set.weightKg)).toEqual([27.5, 31.5, 32.5])
    await menu()
    await user.click(screen.getByRole('menuitem', { name: 'Удалить подход 2' }))
    await user.click(screen.getByRole('button', { name: 'Удалить подход' }))
    expect(draft()[0]!.sets).toEqual([initial[0]!.sets[0], { ...initial[0]!.sets[2], position: 1 }])
    expect(draft()[1]).toEqual(initial[1])
    expect(within(exercise).getByLabelText('Вес, подход 2')).toHaveValue(32.5)
    await menu()
    expect(screen.getByRole('menuitem', { name: 'Удалить подход' })).toBeDisabled()
  })
  it('clears set selection after adding a set and moving an exercise', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const first = screen.getAllByRole('article')[0]!
    await user.click(within(first).getByLabelText('Вес, подход 1'))
    await user.click(within(first).getByRole('button', { name: '＋ Подход' }))
    await user.click(within(first).getByRole('button', { name: 'Ещё действия' }))
    expect(screen.getByRole('menuitem', { name: 'Удалить подход' })).toBeDisabled()
    await user.click(within(first).getByLabelText('Вес, подход 2'))
    const handle = screen.getByRole('button', { name: 'Переместить: Присед' })
    handle.focus()
    await user.keyboard(' {End}{Enter}')
    const moved = screen.getAllByRole('article').at(-1)!
    await user.click(within(moved).getByRole('button', { name: 'Ещё действия' }))
    expect(screen.getByRole('menuitem', { name: 'Удалить подход' })).toBeDisabled()
    expect(draft()[2]!.sets).toHaveLength(2)
    expect(draft()[2]!.sets[0]).toEqual(singles[0]!.sets[0])
  })
  it.each(['only', 'saved'] as const)('keeps the %s selected set protected in the menu', async kind => {
    const user = userEvent.setup()
    const sets = kind === 'only' ? singles[0]!.sets : [{ ...singles[0]!.sets[0]!, sourceSetId: 'saved-set' }, { position: 1, weightKg: 42.5, reps: 6 }]
    render(<Harness initial={[{ ...singles[0]!, sets }]} />)
    await user.click(screen.getByLabelText('Вес, подход 1'))
    await user.click(screen.getByRole('button', { name: 'Ещё действия' }))
    const remove = screen.getByRole('menuitem', { name: 'Удалить подход 1' })
    expect(remove).toBeDisabled()
    await user.click(remove)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(draft()[0]!.sets).toEqual(sets)
  })
  it('moves a superset to any position without touching its sets, settings or history IDs', () => {
    const group: WorkoutExerciseDraft[] = singles.slice(0, 2).map((exercise) => ({ ...exercise, blockId: 'group', blockType: 'group', blockRounds: 2, restBetweenRoundsSec: 120, trainerComment: 'Техника', sets: [{ ...exercise.sets[0]!, sourceSetId: 'saved-set' }] }))
    const initial = [...group, singles[2]!]
    const moved = moveDraftBlockTo(initial, 'group', 1)
    expect(moved.map((exercise) => exercise.ref)).toEqual(['exercise-2', 'exercise-0', 'exercise-1'])
    expect(moved.map((exercise) => exercise.position)).toEqual([0, 1, 2])
    expect(moved[1]).toMatchObject({ blockId: 'group', blockRounds: 2, restBetweenRoundsSec: 120, trainerComment: 'Техника' })
    expect(moved[1]!.sets).toBe(group[0]!.sets)
    expect(moved[2]!.sets).toBe(group[1]!.sets)
    for (const target of [-1, 2, 1.5, NaN]) expect(moveDraftBlockTo(initial, 'group', target)).toBe(initial)
    expect(moveDraftBlockTo(initial, 'missing', 0)).toBe(initial)
  })
  it('keyboard drag keeps fractional values and per-exercise RPE visibility; has no arrow menu', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const first = screen.getAllByRole('article')[0]!
    await user.click(within(first).getByRole('button', { name: 'Ещё действия' }))
    expect(screen.queryByRole('menuitem', { name: 'Изменить порядок' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'Указать RPE' }))
    const handle = screen.getByRole('button', { name: 'Переместить: Присед' })
    handle.focus()
    await user.keyboard(' {End}{Enter}')
    expect(draft().map((exercise) => exercise.name)).toEqual(['Жим', 'Тяга', 'Присед'])
    expect(draft()[2]!.sets[0]).toMatchObject({ weightKg: 27.5, reps: 8, rpe: 7 })
    const last = screen.getAllByRole('article')[2]!
    expect(within(last).getByLabelText('Целевой RPE, подход 1')).toBeInTheDocument()
    expect(within(screen.getAllByRole('article')[0]!).queryByLabelText('Целевой RPE, подход 1')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Вверх' })).not.toBeInTheDocument()
  })
  it('requires confirmation for deletion and retains the draft on cancel', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getAllByRole('button', { name: 'Ещё действия' })[0]!)
    await user.click(screen.getByRole('menuitem', { name: 'Удалить упражнение' }))
    expect(draft()).toHaveLength(3)
    await user.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(draft()).toHaveLength(3)
    await user.click(screen.getAllByRole('button', { name: 'Ещё действия' })[0]!)
    await user.click(screen.getByRole('menuitem', { name: 'Удалить упражнение' }))
    await user.click(screen.getByRole('button', { name: 'Удалить упражнение' }))
    expect(draft().map((exercise) => exercise.name)).toEqual(['Жим', 'Тяга'])
    expect(draft().map((exercise) => exercise.position)).toEqual([0, 1])
  })
  it('cannot remove an exercise with saved facts', async () => {
    const user = userEvent.setup()
    render(<Harness initial={[{ ...singles[0]!, sets: [{ ...singles[0]!.sets[0]!, sourceSetId: 'saved-set' }] }]} />)
    await user.click(screen.getByRole('button', { name: 'Ещё действия' }))
    await user.click(screen.getByRole('menuitem', { name: 'Удалить упражнение' }))
    expect(screen.getByRole('alert')).toHaveTextContent('с выполненными подходами нельзя удалить')
    expect(draft()[0]!.sets[0]!.sourceSetId).toBe('saved-set')
    expect(screen.queryByRole('button', { name: 'Удалить упражнение' })).not.toBeInTheDocument()
  })
  it('blocks editing and drag while the parent saves', () => {
    render(<Harness disabled />)
    expect(screen.getAllByLabelText('Вес, подход 1')[0]).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Переместить: Присед' })).toBeDisabled()
    expect(screen.getAllByRole('button', { name: 'Ещё действия' })[0]).toBeDisabled()
  })
})
