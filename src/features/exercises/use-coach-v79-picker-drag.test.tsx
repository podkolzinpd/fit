import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useCoachV79PickerDrag } from './use-coach-v79-picker-drag'

class TestPointer extends MouseEvent {
  readonly pointerId: number
  readonly isPrimary = true
  constructor(type: string, init: PointerEventInit) { super(type, init); this.pointerId = init.pointerId ?? 1 }
}
afterEach(() => { vi.restoreAllMocks() })
function Harness({ enabled = true, close }: { enabled?: boolean; close: () => void }) {
  const drag = useCoachV79PickerDrag(enabled, close)
  return <section {...drag} data-testid="sheet"><header className="client-lime-sheet-header"><h1>Каталог</h1><button>Закрыть</button></header><input aria-label="Поиск" /><div>Список</div></section>
}
function setup(enabled = true) {
  const close = vi.fn(), view = render(<Harness close={close} enabled={enabled} />)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 500 } as DOMRect)
  const sheet = screen.getByTestId('sheet'), title = screen.getByRole('heading')
  const event = (target: Element, type: string, x: number, y: number) => fireEvent(target, new TestPointer(type, { pointerId: 1, button: 0, bubbles: true, cancelable: true, clientX: x, clientY: y }))
  return { close, view, sheet, title, event }
}
it('follows a downward header drag and closes only after the source threshold', () => {
  const { close, sheet, title, event } = setup()
  event(title, 'pointerdown', 100, 100); event(sheet, 'pointermove', 100, 300)
  expect(sheet.style.getPropertyValue('--v79-picker-drag')).toBe('200px')
  expect(close).not.toHaveBeenCalled()
  event(sheet, 'pointerup', 100, 300)
  expect(close).toHaveBeenCalledOnce()
  event(sheet, 'lostpointercapture', 100, 300)
  expect(close).toHaveBeenCalledOnce()
})
it('cancels a grabbed sheet without closing or leaving an offset', () => {
  const { close, sheet, title, event } = setup()
  event(title, 'pointerdown', 100, 100); event(sheet, 'pointermove', 100, 300); event(sheet, 'pointercancel', 100, 300)
  expect(close).not.toHaveBeenCalled()
  expect(sheet.style.getPropertyValue('--v79-picker-drag')).toBe('0px')
  expect(sheet).not.toHaveAttribute('data-v79-dragging')
})
it('does not turn horizontal movement, header buttons or list input into dismissal', () => {
  const { close, sheet, title, event } = setup()
  for (const origin of [title, screen.getByRole('button'), screen.getByLabelText('Поиск')]) {
    event(origin, 'pointerdown', 100, 100); event(sheet, 'pointermove', 300, 120); event(sheet, 'pointerup', 300, 120)
  }
  expect(close).not.toHaveBeenCalled()
})
it('does nothing outside the explicit enabled root-catalogue state', () => {
  const { close, sheet, title, event } = setup(false)
  event(title, 'pointerdown', 100, 100); event(sheet, 'pointermove', 100, 400); event(sheet, 'pointerup', 100, 400)
  expect(close).not.toHaveBeenCalled()
  expect(sheet.style.getPropertyValue('--v79-picker-drag')).toBe('')
})
