import { afterEach, expect, it, vi } from 'vitest'
import { revealLiveExercise } from './live-exercise-reveal'

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function scene(reduced = false) {
  document.body.innerHTML = '<div class="content"><div class="live-pinned"></div><article><form><input></form></article></div><input id="search">'
  const content = document.querySelector<HTMLElement>('.content')!
  const pinned = document.querySelector<HTMLElement>('.live-pinned')!
  const card = document.querySelector('article')!
  const row = document.querySelector('form')!
  const frames = new Map<number, FrameRequestCallback>()
  let frameId = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
  vi.stubGlobal('matchMedia', () => ({ matches: reduced }))
  const scroll = vi.fn()
  Object.defineProperty(content, 'scrollTo', { value: scroll })
  vi.spyOn(content, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 390, 800))
  vi.spyOn(pinned, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 390, 100))
  const cardBounds = vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 700, 390, 300))
  const rowBounds = vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 850, 390, 54))
  const step = (count = 1) => { for (let index = 0; index < count; index++) { const next = frames.entries().next().value as [number, FrameRequestCallback] | undefined; if (!next) return; frames.delete(next[0]); next[1](performance.now()) } }
  return { content, pinned, card, row, frames, scroll, cardBounds, rowBounds, step }
}

it('waits for folding geometry to settle before one smooth reveal', () => {
  const s = scene()
  const stop = revealLiveExercise(s.row, s.card, s.content, s.pinned)
  s.step(2)
  expect(s.scroll).not.toHaveBeenCalled()
  s.cardBounds.mockReturnValue(new DOMRect(0, 650, 390, 300))
  s.step(2)
  expect(s.scroll).not.toHaveBeenCalled()
  s.step(2)
  expect(s.scroll).toHaveBeenCalledExactlyOnceWith({ top: 538, behavior: 'smooth' })
  stop()
})

it('leaves an already visible next row and the page scroll untouched', () => {
  const s = scene()
  s.rowBounds.mockReturnValue(new DOMRect(0, 200, 390, 54))
  const stop = revealLiveExercise(s.row, s.card, s.content, s.pinned)
  s.step(5)
  expect(s.scroll).not.toHaveBeenCalled()
  expect(window.scrollY).toBe(0)
  stop()
})

it('does not schedule a reveal over an active picker or note input', () => {
  const s = scene()
  const search = document.querySelector<HTMLInputElement>('#search')!
  search.focus()
  const stop = revealLiveExercise(s.row, s.card, s.content, s.pinned)
  expect(s.frames.size).toBe(0)
  expect(s.scroll).not.toHaveBeenCalled()
  expect(document.activeElement).toBe(search)
  stop()
})

it('gives a manual focus change priority during layout settling', () => {
  const s = scene()
  const stop = revealLiveExercise(s.row, s.card, s.content, s.pinned)
  s.step(2)
  s.row.querySelector('input')!.focus()
  s.step(5)
  expect(s.frames.size).toBe(0)
  expect(s.scroll).not.toHaveBeenCalled()
  stop()
})

it('stops its own native scroll at the current position when the user wheels', () => {
  const s = scene()
  const stop = revealLiveExercise(s.row, s.card, s.content, s.pinned)
  s.step(4)
  expect(s.scroll).toHaveBeenCalledOnce()
  s.content.scrollTop = 180
  s.content.dispatchEvent(new WheelEvent('wheel'))
  expect(s.scroll).toHaveBeenLastCalledWith({ top: 180, behavior: 'instant' })
  expect(s.frames.size).toBe(0)
  stop()
})

it('respects reduced motion without focusing the next field', () => {
  const s = scene(true)
  const stop = revealLiveExercise(s.row, s.card, s.content, s.pinned)
  s.step(4)
  expect(s.scroll).toHaveBeenCalledExactlyOnceWith({ top: 588, behavior: 'instant' })
  expect(document.activeElement).toBe(document.body)
  expect(s.frames.size).toBe(0)
  stop()
})
