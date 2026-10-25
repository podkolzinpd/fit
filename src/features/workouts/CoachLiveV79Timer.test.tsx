import { act, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { CoachLiveV79Timer } from './CoachLiveV79Timer'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
function Surface({ time = '01:00', resting = false, phaseLabel }: { time?: string; resting?: boolean; phaseLabel?: string }) {
  const [slot, setSlot] = useState<HTMLSpanElement | null>(null)
  return <div className="content"><main className="live-workout-page coach-live-v79">
    <header className="page-header"><span ref={setSlot} /></header>
    <CoachLiveV79Timer time={time} elapsed="01:00" resting={resting} paused={false} phaseLabel={phaseLabel} density="original" headerSlot={slot} restAction={<button>Отдых</button>} compactAction={<button>Открыть отдых</button>} />
    <div className="live-set-grid"><input className="live-set-input" defaultValue="29.5" /></div>
  </main></div>
}
it('hands one supplied clock to both displays without touching focused forms', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  let offset = 0
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = this.classList.contains('page-header') ? 0 : this.classList.contains('coach-v79-large-clock') ? 92 - offset : 52 - offset
    const height = this.classList.contains('page-header') ? 52 : 66
    return { top, bottom: top + height, height } as DOMRect
  })
  const view = render(<Surface />), root = view.container.querySelector<HTMLElement>('main')!
  const input = view.container.querySelector('input')!; input.focus()
  expect(screen.getByRole('img', { name: 'Тренировка: 01:00' })).toBeVisible()
  expect(view.container.querySelector('.coach-v79-small-clock')).toHaveTextContent('01:00')
  offset = 73
  act(() => view.container.querySelector('.content')!.dispatchEvent(new Event('scroll')))
  expect(Number(root.style.getPropertyValue('--v79-large-opacity'))).toBeGreaterThan(0)
  expect(root.style.getPropertyValue('--v79-small-opacity')).toBe('0')
  offset = 200
  act(() => view.container.querySelector('.content')!.dispatchEvent(new Event('scroll')))
  expect(root.style.getPropertyValue('--v79-small-opacity')).toBe('1')
  expect(root.style.getPropertyValue('--v79-status-opacity')).toBe('0')
  expect(document.activeElement).toBe(input)
  view.rerender(<Surface time="00:30" resting />)
  expect(screen.getByRole('img', { name: 'Отдых: 00:30' })).toBeVisible()
  expect(view.container.querySelector('.coach-v79-small-clock')).toHaveTextContent('00:30')
  expect(input).toHaveValue('29.5')
  expect(document.activeElement).toBe(input)
  view.rerender(<Surface time="00:20" phaseLabel="Подход" />)
  expect(screen.getByRole('img', { name: 'Подход: 00:20' })).toBeVisible()
  expect(view.container.querySelector('.coach-v79-elapsed')).toHaveTextContent('01:00')
  expect(document.activeElement).toBe(input)
  view.unmount()
  expect(root.style.getPropertyValue('--v79-small-opacity')).toBe('')
})

it('keeps a focused row visible when animated header geometry settles after viewport resize', () => {
  let resized = () => {}, rowTop = 360
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resized = callback } observe() {} disconnect() {} })
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = this.classList.contains('live-set-grid') ? rowTop - (this.closest('.content')?.scrollTop ?? 0) : 0
    const height = this.classList.contains('content') ? 400 : this.classList.contains('live-set-grid') ? 48 : 52
    return { top, bottom: top + height, height } as DOMRect
  })
  const view = render(<Surface />), input = view.container.querySelector('input')!, content = view.container.querySelector('.content')!
  input.focus()
  act(resized)
  expect(content.scrollTop).toBe(24)
  rowTop += 128
  act(resized)
  expect(content.scrollTop).toBe(152)
  expect(input).toHaveValue('29.5')
  expect(input).toHaveFocus()
})
