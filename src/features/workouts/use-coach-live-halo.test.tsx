import { act, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useCoachLiveHalo } from './use-coach-live-halo'

function Surface({ enabled = true }: { enabled?: boolean }) {
  const ref = useCoachLiveHalo(enabled)
  return <div className="coach-live-density"><header className="page-header" /><div ref={ref} className="live-pinned"><div className="coach-live-clock" /><input defaultValue="50" /></div></div>
}
afterEach(() => vi.restoreAllMocks())
it('aligns the local halo origin and fades without replacing focused inputs', () => {
  let scroll = 0
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = this.classList.contains('page-header') ? 0 : 44 - scroll
    const height = this.classList.contains('page-header') ? 44 : 194
    return { top, bottom: top + height, height } as DOMRect
  })
  const { container, unmount } = render(<Surface />)
  const root = container.firstElementChild as HTMLElement
  const pinned = root.querySelector<HTMLElement>('.live-pinned')!
  const input = root.querySelector('input')!
  input.focus()
  expect(pinned.style.getPropertyValue('--coach-live-halo-y')).toBe('-44px')
  expect(root.style.getPropertyValue('--coach-live-halo-fade')).toBe('1')
  // Resize runs the same paint path; use the observer callback deterministically.
  const callbacks: FrameRequestCallback[] = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { callbacks.push(callback); return callbacks.length })
  scroll = 97
  act(() => window.dispatchEvent(new Event('scroll')))
  act(() => callbacks.splice(0).forEach(callback => callback(0)))
  expect(pinned.style.getPropertyValue('--coach-live-halo-y')).toBe('53px')
  expect(root.style.getPropertyValue('--coach-live-halo-fade')).toBe('0.5')
  expect(document.activeElement).toBe(input)
  scroll = 194
  act(() => window.dispatchEvent(new Event('scroll')))
  act(() => callbacks.splice(0).forEach(callback => callback(0)))
  expect(root.style.getPropertyValue('--coach-live-halo-fade')).toBe('0')
  unmount()
  expect(root.style.getPropertyValue('--coach-live-halo-fade')).toBe('')
})
it('does not attach paint variables outside the fixed2 density surface', () => {
  const { container } = render(<Surface enabled={false} />)
  expect(container.querySelector('.live-pinned')).not.toHaveAttribute('style')
})
