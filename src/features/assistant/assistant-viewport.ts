type ScrollAnchor = Pick<HTMLElement, 'scrollHeight' | 'scrollTop'>

export function anchorAssistantViewport(
  thread: ScrollAnchor,
  scrollContainer: ScrollAnchor,
  contained: boolean,
) {
  if (contained) {
    // On the mobile assistant route, the conversation is the only scrollable
    // surface. The composer belongs to the viewport and must never inherit the
    // old outer `.content` offset.
    scrollContainer.scrollTop = 0
    thread.scrollTop = thread.scrollHeight
    return
  }

  scrollContainer.scrollTop = scrollContainer.scrollHeight
}
