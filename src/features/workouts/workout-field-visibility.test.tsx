import { act, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { advancePlanField } from './plan-input-navigation'
import { keepWorkoutFieldVisible, useWorkoutFieldVisibility } from './workout-field-visibility'

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('does not counter-scroll a retained field while the native keyboard expands the viewport', () => {
  let pending: FrameRequestCallback = () => undefined
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { pending = callback; return 1 }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const viewport = Object.assign(new EventTarget(), { height: 400, offsetTop: 120 })
  vi.stubGlobal('visualViewport', viewport)
  function Editor() {
    useWorkoutFieldVisibility(true, '.answer input')
    return <div className="content"><form className="answer"><input /><input /></form></div>
  }
  render(<Editor />)
  const content = document.querySelector<HTMLElement>('.content')!, inputs = document.querySelectorAll('input')
  const rect = geometry(content, inputs[0]!, 200)
  geometry(content, inputs[1]!, 600)
  content.scrollTop = 100
  act(() => inputs[0]!.focus())
  act(() => pending(0))
  viewport.height = 500; viewport.offsetTop = 60
  rect.mockReturnValue(new DOMRect(0, 40, 100, 48))
  act(() => viewport.dispatchEvent(new Event('resize')))
  act(() => pending(0))
  expect(content.scrollTop).toBe(100)
  // A new focus still owns the next explicit visibility correction.
  act(() => inputs[1]!.focus())
  act(() => pending(0))
  expect(content.scrollTop).toBeGreaterThan(100)
})

function geometry(content: HTMLElement, field: HTMLElement, top: number, height = 48) {
  Object.defineProperty(content, 'clientHeight', { configurable: true, value: 400 })
  vi.spyOn(content, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 390, 400))
  return vi.spyOn(field, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, top, 100, height))
}

it('keeps visible fields still and moves only a clipped edge inside content', () => {
  document.body.innerHTML = '<div class="content"><input></div>'
  const content = document.querySelector<HTMLElement>('.content')!, input = document.querySelector('input')!
  vi.stubGlobal('visualViewport', { height: 400, offsetTop: 0 })
  const rect = geometry(content, input, 120)
  for (const [top, height, expected] of [[120, 48, 100], [350, 48, 114], [5, 48, 89], [16, 500, 100]]) {
    content.scrollTop = 100
    rect.mockReturnValue(new DOMRect(0, top, 100, height))
    keepWorkoutFieldVisible(input)
    expect(content.scrollTop).toBe(expected)
    expect(window.scrollY).toBe(0)
  }
})

it('Enter advances without centering or scrolling the root; the last field blurs', () => {
  document.body.innerHTML = '<div class="content"><form><input><input disabled><input type="hidden"><input></form></div>'
  const form = document.querySelector('form')!, inputs = form.querySelectorAll('input')
  const first = inputs[0]!, last = inputs[3]!, content = document.querySelector<HTMLElement>('.content')!
  vi.spyOn(first, 'getClientRects').mockReturnValue([new DOMRect()] as unknown as DOMRectList)
  vi.spyOn(last, 'getClientRects').mockReturnValue([new DOMRect()] as unknown as DOMRectList)
  geometry(content, last, 120)
  const focus = vi.spyOn(last, 'focus')
  advancePlanField(first, form)
  expect(last).toHaveFocus()
  expect(focus).toHaveBeenCalledWith({ preventScroll: true })
  expect(content.scrollTop).toBe(0)
  advancePlanField(last, form)
  expect(last).not.toHaveFocus()
})

it('checks the current focused field and cancels pending visibility work on close', () => {
  let pending: FrameRequestCallback = () => undefined
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { pending = callback; return 1 }))
  const cancel = vi.fn()
  vi.stubGlobal('cancelAnimationFrame', cancel)
  vi.stubGlobal('visualViewport', new EventTarget())
  function Editor() {
    useWorkoutFieldVisibility(true, '.answer textarea')
    return <div className="content"><form className="answer"><textarea /></form><button>Отмена</button></div>
  }
  const view = render(<Editor />)
  const content = document.querySelector<HTMLElement>('.content')!, input = document.querySelector('textarea')!
  geometry(content, input, 600)
  act(() => input.focus())
  act(() => document.querySelector('button')!.focus())
  act(() => pending(0))
  expect(content.scrollTop).toBe(0)
  act(() => input.focus())
  view.unmount()
  expect(cancel).toHaveBeenCalledWith(1)
})
