type ScrollAnchor = Pick<HTMLElement, 'scrollHeight' | 'scrollTop'>

export function anchorAssistantViewport(
  thread: ScrollAnchor,
  scrollContainer: ScrollAnchor,
  keyboardOpen: boolean,
) {
  if (keyboardOpen) {
    // When iOS shrinks VisualViewport, `.assistant-thread` becomes the only
    // scrollable chat surface. Keeping the old outer `.content` offset would
    // move both the composer and the tail of the conversation above the
    // keyboard.
    scrollContainer.scrollTop = 0
    thread.scrollTop = thread.scrollHeight
    return
  }

  scrollContainer.scrollTop = scrollContainer.scrollHeight
}
