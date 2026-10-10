import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { WorkoutDragBlock, WorkoutDragHandle, WorkoutGestureList, WorkoutSwipe } from './WorkoutGestures'

beforeEach(() => {
  vi.stubGlobal('PointerEvent', MouseEvent)
  HTMLElement.prototype.setPointerCapture = vi.fn()
})
afterEach(() => vi.unstubAllGlobals())
function setup(disabled = false) {
  const move = vi.fn(), remove = vi.fn(), replace = vi.fn()
  render(<WorkoutGestureList blocks={['a', 'b', 'c']} disabled={disabled} onMove={move}>
    {['a', 'b', 'c'].map((id) => <WorkoutDragBlock key={id} id={id}>
      <WorkoutSwipe id={id} disabled={false} onDelete={() => { remove(id) }} onReplace={() => { replace(id) }}>
        <WorkoutDragHandle id={id} label={id} /><p data-testid={id}>Упражнение {id}</p><input aria-label={`Вес ${id}`} defaultValue="25" />
        <button type="button" aria-label={`Настройки ${id}`}>Настройки</button>
      </WorkoutSwipe>
    </WorkoutDragBlock>)}
  </WorkoutGestureList>)
  return { move, remove, replace }
}
function swipe(id: string, dx: number, dy = 0) {
  const item = screen.getByTestId(id)
  fireEvent.pointerDown(item, { button: 0, clientX: 160, clientY: 100 })
  fireEvent.pointerMove(item, { clientX: 160 + dx, clientY: 100 + dy })
  fireEvent.pointerUp(item)
}
function pointer(target: Element, type: string, pointerId: number, isPrimary = true, clientY = 100, clientX = 160) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY })
  Object.defineProperties(event, { pointerId: { value: pointerId }, isPrimary: { value: isPrimary } })
  fireEvent(target, event)
  return event
}
it('swipe surface prevents native text drag without stealing editable controls', () => {
  setup()
  const item = screen.getByTestId('a')
  expect(pointer(item, 'pointerdown', 11).defaultPrevented).toBe(true)
  pointer(item, 'pointercancel', 11)
  expect(pointer(screen.getByRole('textbox', { name: 'Вес a' }), 'pointerdown', 12).defaultPrevented).toBe(false)
  expect(pointer(screen.getByRole('button', { name: 'Настройки a' }), 'pointerdown', 13).defaultPrevented).toBe(false)
  pointer(item, 'pointerdown', 14)
  pointer(item, 'pointermove', 14, true, 100, 60)
  pointer(item, 'pointerup', 14)
  expect(screen.getByRole('button', { name: 'Удалить' })).toBeVisible()
})
it('disabled swipe leaves native pointer behavior untouched', () => {
  setup(true)
  expect(pointer(screen.getByTestId('a'), 'pointerdown', 11).defaultPrevented).toBe(false)
  expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument()
})
it('another pointer cannot commit or cancel the active block drag', () => {
  const { move } = setup()
  const handle = screen.getByRole('button', { name: 'Переместить: a' })
  pointer(handle, 'pointerdown', 11)
  pointer(handle, 'pointermove', 11)
  pointer(handle, 'pointerup', 22, false)
  expect(move).not.toHaveBeenCalled()
  expect(handle).toHaveAttribute('aria-pressed', 'true')
  pointer(handle, 'pointercancel', 22, false)
  expect(handle).toHaveAttribute('aria-pressed', 'true')
  pointer(handle, 'pointerup', 11)
  expect(move).toHaveBeenCalledExactlyOnceWith('a', 2)
})
it('a tall exercise accepts a drop past its visible handle, not its offscreen midpoint', () => {
  const { move } = setup()
  const first = screen.getByRole('button', { name: 'Переместить: a' })
  const second = screen.getByRole('button', { name: 'Переместить: b' })
  const third = screen.getByRole('button', { name: 'Переместить: c' })
  vi.spyOn(second.closest('[data-workout-block]')!, 'getBoundingClientRect').mockReturnValue({ top: 200, height: 1800 } as DOMRect)
  vi.spyOn(second, 'getBoundingClientRect').mockReturnValue({ top: 220, height: 44 } as DOMRect)
  vi.spyOn(third, 'getBoundingClientRect').mockReturnValue({ top: 2000, height: 44 } as DOMRect)
  pointer(first, 'pointerdown', 11, true, 100)
  expect(document.querySelector('.workout-drag-preview')).toHaveTextContent('a')
  pointer(first, 'pointermove', 11, true, 280)
  expect(screen.getByRole('status')).toHaveTextContent('позиция 2 из 3')
  expect(move).not.toHaveBeenCalled()
  pointer(first, 'pointerup', 11, true, 280)
  expect(move).toHaveBeenCalledExactlyOnceWith('a', 1)
  expect(document.querySelector('.workout-drag-preview')).toBeNull()
})
it('lost pointer capture cancels without changing order or removing drafts', () => {
  const { move } = setup()
  const handle = screen.getByRole('button', { name: 'Переместить: a' })
  pointer(handle, 'pointerdown', 11)
  pointer(handle, 'pointermove', 11)
  pointer(handle, 'lostpointercapture', 11)
  expect(handle).toHaveAttribute('aria-pressed', 'false')
  expect(move).not.toHaveBeenCalled()
  expect(screen.getByRole('textbox', { name: 'Вес a' })).toHaveValue('25')
})
it('another pointer cannot move the insertion marker or replace the active drag', () => {
  const { move } = setup()
  const first = screen.getByRole('button', { name: 'Переместить: a' })
  const second = screen.getByRole('button', { name: 'Переместить: b' })
  pointer(first, 'pointerdown', 11)
  pointer(second, 'pointerdown', 22, false)
  pointer(second, 'pointerdown', 33)
  expect(first).toHaveAttribute('aria-pressed', 'true')
  expect(second).toHaveAttribute('aria-pressed', 'false')
  pointer(first, 'pointermove', 22, false)
  expect(screen.getByRole('status')).toHaveTextContent('позиция 1 из 3')
  pointer(first, 'pointerup', 11)
  expect(move).not.toHaveBeenCalled()
})
it('the active pointer can cancel then start another drag without a write', () => {
  const { move } = setup()
  const handle = screen.getByRole('button', { name: 'Переместить: a' })
  pointer(handle, 'pointerdown', 11)
  pointer(handle, 'pointermove', 11)
  pointer(handle, 'pointercancel', 11)
  expect(handle).toHaveAttribute('aria-pressed', 'false')
  expect(move).not.toHaveBeenCalled()
  pointer(handle, 'pointerdown', 12)
  pointer(handle, 'pointermove', 12)
  pointer(handle, 'pointerup', 12)
  expect(move).toHaveBeenCalledExactlyOnceWith('a', 2)
})
it('another pointer cannot finish or cancel an active swipe', () => {
  const { remove } = setup()
  const item = screen.getByTestId('a')
  pointer(item, 'pointerdown', 11)
  pointer(item, 'pointermove', 11, true, 100, 60)
  pointer(item, 'pointerup', 22, false)
  pointer(item, 'pointercancel', 22, false)
  expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument()
  pointer(item, 'pointerup', 11)
  expect(screen.getByRole('button', { name: 'Удалить' })).toBeVisible()
  expect(remove).not.toHaveBeenCalled()
})
it('a secondary pointer cannot start a swipe', () => {
  setup()
  const item = screen.getByTestId('a')
  pointer(item, 'pointerdown', 22, false)
  pointer(item, 'pointermove', 22, false, 100, 60)
  pointer(item, 'pointerup', 22, false)
  expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument()
})
it('keyboard takes a whole block and saves once on Enter; no visual arrow mode', () => {
  const { move } = setup()
  const handle = screen.getByRole('button', { name: 'Переместить: a' })
  fireEvent.keyDown(handle, { key: ' ' })
  fireEvent.keyDown(handle, { key: 'End' })
  expect(move).not.toHaveBeenCalled()
  expect(screen.getByRole('status')).toHaveTextContent('позиция 3 из 3')
  fireEvent.keyDown(handle, { key: 'Enter' })
  expect(move).toHaveBeenCalledExactlyOnceWith('a', 2)
  expect(screen.getByRole('textbox', { name: 'Вес a' })).toHaveValue('25')
  expect(screen.getByTestId('a').closest('[data-workout-block]')?.previousElementSibling).toBeNull()
})
it('Escape cancels and disabled handles never start a write', () => {
  const { move } = setup()
  const handle = screen.getByRole('button', { name: 'Переместить: a' })
  fireEvent.keyDown(handle, { key: ' ' }); fireEvent.keyDown(handle, { key: 'ArrowDown' }); fireEvent.keyDown(handle, { key: 'Escape' })
  expect(move).not.toHaveBeenCalled()
  expect(handle).toHaveAttribute('aria-pressed', 'false')
})
it('swipe only reveals an action; one open at a time; outside closes', () => {
  const { remove, replace } = setup()
  swipe('a', -90)
  expect(screen.getByRole('button', { name: 'Удалить' })).toBeVisible()
  expect(remove).not.toHaveBeenCalled()
  swipe('b', 90)
  expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Заменить' }))
  expect(replace).toHaveBeenCalledExactlyOnceWith('b')
  swipe('a', -90)
  fireEvent.pointerDown(document.body)
  expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument()
})
it('vertical scrolling and input gestures never reveal destructive actions', () => {
  setup()
  swipe('a', 25, 90)
  const input = screen.getByRole('textbox', { name: 'Вес a' })
  fireEvent.pointerDown(input, { clientX: 160, clientY: 100, button: 0 })
  fireEvent.pointerMove(input, { clientX: 60, clientY: 100 })
  fireEvent.pointerUp(input)
  expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument()
})
it('reverse swipe closes the current action without revealing the opposite action', () => {
  setup()
  swipe('a', -90)
  swipe('a', 90)
  expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Заменить' })).not.toBeInTheDocument()
})
it('pending structural writes block swipe and drag', () => {
  const { move, remove } = setup(true)
  swipe('a', -90)
  expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Переместить: a' })).toBeDisabled()
  expect(move).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled()
})

function setupRows(disabled = false) {
  const removeExercise = vi.fn(), removeSet = vi.fn(), replace = vi.fn()
  render(<WorkoutGestureList blocks={['exercise']} disabled={false} onMove={vi.fn()}>
    <WorkoutSwipe id="exercise" disabled={false} onDelete={removeExercise} onReplace={replace}>
      <p data-testid="exercise">Упражнение</p>
      <WorkoutSwipe id="row" variant="set" disabled={disabled} onDelete={removeSet} actionLabel="Удалить подход 2">
        <span data-testid="row">2</span><input aria-label="Повторы строки" defaultValue="10" />
      </WorkoutSwipe>
    </WorkoutSwipe>
  </WorkoutGestureList>)
  return { removeExercise, removeSet, replace }
}
it('a nested row reveals only its own deletion and waits for explicit action', () => {
  const { removeExercise, removeSet, replace } = setupRows()
  swipe('row', -90)
  expect(screen.getByRole('button', { name: 'Удалить подход 2' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument()
  expect(removeSet).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Удалить подход 2' }))
  expect(removeSet).toHaveBeenCalledTimes(1)
  expect(removeExercise).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled()
})
it('a row has no right-swipe replacement; reverse swipe simply closes deletion', () => {
  setupRows()
  swipe('row', 90)
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  swipe('row', -90)
  expect(screen.getByRole('button', { name: 'Удалить подход 2' })).toBeVisible()
  swipe('row', 90)
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})
it('protected row and row inputs never fall through to exercise deletion', () => {
  setupRows(true)
  swipe('row', -90)
  const input = screen.getByRole('textbox', { name: 'Повторы строки' })
  pointer(input, 'pointerdown', 11)
  pointer(input, 'pointermove', 11, true, 100, 60)
  pointer(input, 'pointerup', 11)
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  swipe('exercise', -90)
  expect(screen.getByRole('button', { name: 'Удалить' })).toBeVisible()
})
it('a new pointer on an editable field is not swallowed after a finished swipe', () => {
  setupRows()
  swipe('exercise', -90)
  const input = screen.getByRole('textbox', { name: 'Повторы строки' })
  expect(pointer(input, 'pointerdown', 11).defaultPrevented).toBe(false)
  const click = new MouseEvent('click', { bubbles: true, cancelable: true })
  fireEvent(input, click)
  expect(click.defaultPrevented).toBe(false)
})
