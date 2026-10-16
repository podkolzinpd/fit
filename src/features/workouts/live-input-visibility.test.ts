import { afterEach, expect, it, vi } from 'vitest'
import { keepLiveInputVisible } from './live-input-visibility'

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })

it('moves only the clipped portion and leaves a visible row at its position', () => {
  document.body.innerHTML = '<div class="content"><div class="live-pinned"></div><div class="live-set-grid"><input></div></div>'
  const content = document.querySelector<HTMLElement>('.content')!
  const row = document.querySelector<HTMLElement>('.live-set-grid')!
  const field = document.querySelector('input')!
  Object.defineProperty(content, 'clientHeight', { value: 400 })
  vi.spyOn(content, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 390, 400))
  vi.spyOn(content.firstElementChild!, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 390, 90))
  const bounds = vi.spyOn(row, 'getBoundingClientRect')
  for (const [top, expected] of [[350, 114], [90, 84], [120, 100]]) {
    content.scrollTop = 100
    bounds.mockReturnValue(new DOMRect(0, top, 390, 48))
    keepLiveInputVisible(field)
    expect(content.scrollTop).toBe(expected)
    expect(window.scrollY).toBe(0)
  }
})

it('keeps the active field visible when a multi-line row is taller than the available area', () => {
  document.body.innerHTML = '<div class="content"><div class="live-pinned"></div><div class="live-set-grid"><input></div></div>'
  const content = document.querySelector<HTMLElement>('.content')!
  const row = document.querySelector<HTMLElement>('.live-set-grid')!
  const field = document.querySelector('input')!
  Object.defineProperty(content, 'clientHeight', { value: 400 })
  vi.spyOn(content, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 390, 400))
  vi.spyOn(content.firstElementChild!, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 390, 90))
  vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 50, 390, 350))
  vi.spyOn(field, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 200, 120, 48))
  content.scrollTop = 100
  keepLiveInputVisible(field)
  expect(content.scrollTop).toBe(100)
})
