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

it('waits for clock and fold layout transitions, without waiting for color', () => {
  const s = scene()
  const clock = { transitionProperty: 'height', playState: 'running', pending: true }
  const fold = { transitionProperty: 'grid-template-rows', playState: 'finished', pending: false }
  const color = { transitionProperty: 'color', playState: 'running', pending: false }
  Object.defineProperty(s.content, 'getAnimations', { value: () => [clock, fold, color] })
  const stop = revealLiveExercise(s.row, s.card, s.content, s.pinned)
  s.step(5)
  expect(s.scroll).not.toHaveBeenCalled()
  clock.playState = 'finished'; clock.pending = false; fold.playState = 'running'
  s.step(5)
  expect(s.scroll).not.toHaveBeenCalled()
  fold.playState = 'finished'
  s.step(4)
  expect(s.scroll).toHaveBeenCalledExactlyOnceWith({ top: 588, behavior: 'smooth' })
  stop()
})

it('does not mistake scroll anchoring for settled content geometry', () => {
  const s = scene()
  let height = 2000
  Object.defineProperty(s.content, 'scrollHeight', { get: () => height })
  const stop = revealLiveExercise(s.row, s.card, s.content, s.pinned)
  // Anchoring can hold viewport rectangles still while preceding content folds.
  for (let index = 0; index < 5; index++) {
    s.content.scrollTop = index * 50; height = 2000 - index * 50; s.step()
  }
  expect(s.scroll).not.toHaveBeenCalled()
  s.step(4)
  expect(s.scroll).toHaveBeenCalledExactlyOnceWith({ top: 788, behavior: 'smooth' })
  stop()
})

it('keeps manual focus cancellation while native smooth scrolling has not painted yet', () => {
  const s = scene()
  const stop = revealLiveExercise(s.row, s.card, s.content, s.pinned)
  s.step(10)
  document.querySelector<HTMLInputElement>('#search')!.focus()
  expect(s.scroll).toHaveBeenLastCalledWith({ top: 0, behavior: 'instant' })
  expect(s.frames.size).toBe(0)
  stop()
})

it('waits for a slow fold to finish instead of abandoning the next row between rendering frames', () => {
  const s = scene()
  let now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  const fold = { transitionProperty: 'grid-template-rows', playState: 'running', pending: false }
  Object.defineProperty(s.content, 'getAnimations', { value: () => [fold] })
  const stop = revealLiveExercise(s.row, s.card, s.content, s.pinned)
  s.step()
  now = 1100; s.step()
  expect(s.scroll).not.toHaveBeenCalled()
  fold.playState = 'finished'
  s.step(4)
  expect(s.scroll).toHaveBeenCalledExactlyOnceWith({ top: 588, behavior: 'smooth' })
  // The scroll's cancellation budget starts at the reveal, not before the fold.
  now = 1900; s.step(4)
  document.querySelector<HTMLInputElement>('#search')!.focus()
  expect(s.scroll).toHaveBeenLastCalledWith({ top: 0, behavior: 'instant' })
  expect(s.frames.size).toBe(0)
  stop()
})

it('bounds an unsettled fold by rendered frames even when the wall clock has not advanced', () => {
  const s = scene()
  vi.spyOn(performance, 'now').mockReturnValue(0)
  Object.defineProperty(s.content, 'getAnimations', { value: () => [
    { transitionProperty: 'height', playState: 'running', pending: false },
  ] })
  const stop = revealLiveExercise(s.row, s.card, s.content, s.pinned)
  s.step(240)
  expect(s.scroll).not.toHaveBeenCalled()
  expect(s.frames.size).toBe(0)
  stop()
})

it('abandons a pending reveal when the page is hidden and does not restart it on return', () => {
  const s = scene()
  const stop = revealLiveExercise(s.row, s.card, s.content, s.pinned)
  s.step(2)
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  document.dispatchEvent(new Event('visibilitychange'))
  expect(s.frames.size).toBe(0)
  const hiddenStop = revealLiveExercise(s.row, s.card, s.content, s.pinned)
  expect(s.frames.size).toBe(0)
  visibility.mockReturnValue('visible')
  document.dispatchEvent(new Event('visibilitychange'))
  s.step(4)
  expect(s.scroll).not.toHaveBeenCalled()
  hiddenStop(); stop()
})
