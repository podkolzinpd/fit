import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { WorkoutExerciseDraft } from '../../shared/domain'
import { WorkoutExerciseEditor } from './WorkoutExerciseEditor'
import { moveDraftBlockTo } from '../../data/repositories/workout-rules'

const singles: WorkoutExerciseDraft[] = ['Присед', 'Жим', 'Тяга'].map((name, position) => ({
  source: 'system', ref: `exercise-${position}`, name, position, muscleGroup: 'legs', inputKind: 'strength',
  blockId: `block-${position}`, blockType: 'single', sets: [{ position: 0, weightKg: 27.5 + position, reps: 8, rpe: 7 }],
}))
function Harness({ initial = singles, disabled = false }: { initial?: WorkoutExerciseDraft[]; disabled?: boolean }) {
  const [draft, setDraft] = useState(initial)
  return <><WorkoutExerciseEditor reference disabled={disabled} exercises={draft} onChange={setDraft} onOpenPicker={vi.fn()} onReplaceExercise={vi.fn()} /><output aria-label="Черновик">{JSON.stringify(draft)}</output></>
}
function draft() { return JSON.parse(screen.getByLabelText('Черновик').textContent!) as WorkoutExerciseDraft[] }

describe('coach reference plan editor', () => {
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
    await user.click(screen.getByRole('menuitem', { name: 'Удалить' }))
    expect(draft()).toHaveLength(3)
    await user.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(draft()).toHaveLength(3)
    await user.click(screen.getAllByRole('button', { name: 'Ещё действия' })[0]!)
    await user.click(screen.getByRole('menuitem', { name: 'Удалить' }))
    await user.click(screen.getByRole('button', { name: 'Удалить упражнение' }))
    expect(draft().map((exercise) => exercise.name)).toEqual(['Жим', 'Тяга'])
    expect(draft().map((exercise) => exercise.position)).toEqual([0, 1])
  })
  it('cannot remove an exercise with saved facts', async () => {
    const user = userEvent.setup()
    render(<Harness initial={[{ ...singles[0]!, sets: [{ ...singles[0]!.sets[0]!, sourceSetId: 'saved-set' }] }]} />)
    await user.click(screen.getByRole('button', { name: 'Ещё действия' }))
    await user.click(screen.getByRole('menuitem', { name: 'Удалить' }))
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
