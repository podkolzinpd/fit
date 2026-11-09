import { useEffect, useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react'

function fitContent(node: HTMLTextAreaElement) {
  if (!node.isConnected || !node.getClientRects().length) return
  const content = node.closest<HTMLElement>('.content')
  const scrollTop = content?.scrollTop
  node.style.height = 'auto'
  const border = node.offsetHeight - node.clientHeight
  node.style.height = `${node.scrollHeight + border}px`
  node.style.overflowY = 'hidden'
  // Measuring a shorter textarea must not clamp the surrounding page first.
  if (content && scrollTop !== undefined) content.scrollTop = scrollTop
}

/** Keep ordinary textarea input/blur semantics while displaying every line. */
export function AutoSizeTextarea({ value, defaultValue, onInput, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => { if (ref.current) fitContent(ref.current) }, [value, defaultValue])
  useEffect(() => {
    const node = ref.current
    if (!node || typeof ResizeObserver === 'undefined') return
    let width = node.getBoundingClientRect().width
    const observer = new ResizeObserver(() => {
      const next = node.getBoundingClientRect().width
      if (next === width) return
      width = next
      fitContent(node)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return <textarea {...props} ref={ref} value={value} defaultValue={defaultValue} onInput={event => {
    onInput?.(event)
    fitContent(event.currentTarget)
  }} />
}
