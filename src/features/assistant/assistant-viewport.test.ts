import { describe, expect, it } from 'vitest'
import { anchorAssistantViewport } from './assistant-viewport'

function scrollAnchor(scrollHeight: number, scrollTop = 0) {
  return { scrollHeight, scrollTop }
}

describe('assistant viewport anchoring', () => {
  it('keeps the outer page fixed and anchors the thread tail above the keyboard', () => {
    const thread = scrollAnchor(840, 0)
    const content = scrollAnchor(1_400, 620)

    anchorAssistantViewport(thread, content, true)

    expect(content.scrollTop).toBe(0)
    expect(thread.scrollTop).toBe(840)
  })

  it('uses the normal page scroll when the keyboard is closed', () => {
    const thread = scrollAnchor(840, 120)
    const content = scrollAnchor(1_400, 0)

    anchorAssistantViewport(thread, content, false)

    expect(content.scrollTop).toBe(1_400)
    expect(thread.scrollTop).toBe(120)
  })
})
