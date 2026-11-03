/** Reveal the next Live row after the folding layout settles. User input owns
 * scrolling immediately; this helper never focuses a field or scrolls the document. */
export function revealLiveExercise(row: HTMLElement, card: HTMLElement, content: HTMLElement, pinned: HTMLElement): () => void {
  let frame = 0
  let stopped = false
  let scrolling = false
  let stable = 0
  let previous: number[] | undefined
  const startedAt = performance.now()
  const isEditing = () => document.activeElement instanceof HTMLElement
    && document.activeElement.matches('input, textarea, select, [contenteditable="true"], .workout-duration-trigger, .run-distance-unit')
  function cleanup(stopScroll: boolean) {
    if (stopped) return
    stopped = true
    cancelAnimationFrame(frame)
    content.removeEventListener('pointerdown', cancel, true)
    content.removeEventListener('touchstart', cancel, true)
    content.removeEventListener('wheel', cancel, true)
    content.removeEventListener('keydown', cancel, true)
    document.removeEventListener('focusin', focusChanged)
    window.visualViewport?.removeEventListener('resize', cancel)
    if (stopScroll && scrolling && content.isConnected) content.scrollTo({ top: content.scrollTop, behavior: 'instant' })
  }
  function cancel() { cleanup(true) }
  function focusChanged() { if (isEditing()) cancel() }
  function tick() {
    if (stopped) return
    if (!row.isConnected || !content.isConnected || isEditing()) { cancel(); return }
    const now = performance.now()
    if (scrolling) {
      const position = content.scrollTop
      stable = previous && Math.abs(position - previous[0]!) < .5 ? stable + 1 : 0
      previous = [position]
      if (stable >= 3 || now - startedAt > 1800) { cleanup(false); return }
    } else {
      const cardBounds = card.getBoundingClientRect()
      const rowBounds = row.closest('[inert]') ? cardBounds : row.getBoundingClientRect()
      const viewport = window.visualViewport
      const bounds = content.getBoundingClientRect()
      const top = Math.max(bounds.top, pinned.getBoundingClientRect().bottom) + 12
      const bottom = Math.min(bounds.bottom, viewport ? viewport.offsetTop + viewport.height : innerHeight) - 16
      const geometry = [cardBounds.top, rowBounds.top, rowBounds.bottom, top, bottom]
      stable = previous && geometry.every((value, index) => Math.abs(value - previous![index]!) < .5) ? stable + 1 : 0
      previous = geometry
      if (stable >= 3) {
        if (bottom <= top || rowBounds.top >= top && rowBounds.bottom <= bottom) { cleanup(false); return }
        const delta = rowBounds.top < top ? rowBounds.top - top
          : Math.max(cardBounds.top - top, rowBounds.bottom - bottom)
        const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
        content.scrollTo({ top: Math.max(0, content.scrollTop + delta), behavior: reduced ? 'instant' : 'smooth' })
        if (reduced) { cleanup(false); return }
        scrolling = true
        stable = 0
        previous = undefined
      } else if (now - startedAt > 900) { cleanup(false); return }
    }
    frame = requestAnimationFrame(tick)
  }
  if (isEditing()) return () => undefined
  content.addEventListener('pointerdown', cancel, true)
  content.addEventListener('touchstart', cancel, { capture: true, passive: true })
  content.addEventListener('wheel', cancel, { capture: true, passive: true })
  content.addEventListener('keydown', cancel, true)
  document.addEventListener('focusin', focusChanged)
  window.visualViewport?.addEventListener('resize', cancel)
  frame = requestAnimationFrame(tick)
  return cancel
}
