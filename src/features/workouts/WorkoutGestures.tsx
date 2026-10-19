import { createContext, useCallback, useContext, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { GripIcon } from '../../shared/icons'

type Drag = { id: string; target: number; keyboard: boolean; pointerId?: number; label: string; held?: boolean }
type DragPointer = Pick<PointerEvent<HTMLElement>, 'pointerId' | 'clientY' | 'isPrimary' | 'preventDefault'> & { currentTarget: HTMLElement }
type GestureContext = {
  blocks: string[]; disabled: boolean; drag: Drag | null; nativeSwipe: boolean;
  open: { id: string; side: 'delete' | 'replace' } | null;
  setOpen: (value: GestureContext['open']) => void;
  start: (id: string, event?: DragPointer, label?: string, held?: boolean) => void;
  keyboard: (id: string, key: string) => boolean;
  cancel: () => void;
}
const Context = createContext<GestureContext | null>(null)
function useWorkoutGestures() {
  const context = useContext(Context)
  if (!context) throw new Error('Workout gestures require list context')
  return context
}

/** No reordered tree before commit: failed writes leave inputs, facts and order intact. */
export function WorkoutGestureList({ blocks, disabled, onMove, children, holdCards = false, nativeSwipe = false }: {
  blocks: string[]; disabled: boolean; onMove: (id: string, targetIndex: number) => void; children: ReactNode; holdCards?: boolean; nativeSwipe?: boolean
}) {
  const root = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [open, setOpen] = useState<GestureContext['open']>(null)
  const frame = useRef<number | null>(null)
  const pointerY = useRef(0)
  const preview = useRef<HTMLDivElement>(null)
  const setCurrent = (value: Drag | null) => { dragRef.current = value; setDrag(value) }
  const cancel = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    dragRef.current = null
    setDrag(null)
  }, [])
  const drop = () => {
    const current = dragRef.current
    cancel()
    if (current && !disabled && blocks.indexOf(current.id) !== current.target) onMove(current.id, current.target)
  }
  function locate() {
    const current = dragRef.current
    if (!current || current.keyboard || !root.current) return
    const elements = [...root.current.querySelectorAll<HTMLElement>('[data-workout-block]')]
      .filter((element) => element.dataset.workoutBlock !== current.id)
    // A tall expanded exercise may extend below the viewport. Its header,
    // rather than its offscreen body midpoint, is the reachable drop anchor.
    const target = elements.filter((element) => {
      const rect = (element.querySelector<HTMLElement>('.workout-drag-handle, .live-exercise-head, .workout-exercise-compact, .circuit-head') ?? element).getBoundingClientRect()
      return pointerY.current > rect.top + rect.height / 2
    }).length
    if (preview.current) preview.current.style.top = `${Math.max(100, Math.min(innerHeight - 140, pointerY.current))}px`
    if (target !== current.target) setCurrent({ ...current, target })
  }
  function scrollFrame() {
    const current = dragRef.current
    if (!current || current.keyboard || !root.current) return
    let scroller: HTMLElement | null = root.current
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement
    const rect = scroller?.getBoundingClientRect()
    const top = Math.max(0, rect?.top ?? 0), bottom = Math.min(innerHeight, rect?.bottom ?? innerHeight)
    const dy = pointerY.current < top + 64 ? -12 : pointerY.current > bottom - 64 ? 12 : 0
    if (dy) { if (scroller) scroller.scrollTop += dy; else window.scrollBy(0, dy) }
    locate()
    frame.current = requestAnimationFrame(scrollFrame)
  }
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current) }, [])
  useEffect(() => {
    if (!holdCards) return
    // Do not disable native pan on cards. Only an already activated hold owns
    // touchmove; moving before the hold remains ordinary browser scrolling.
    const move = (event: TouchEvent) => {
      if (dragRef.current?.held && event.touches.length === 1 && event.cancelable && event.target instanceof Node && root.current?.contains(event.target)) event.preventDefault()
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && dragRef.current?.held) { event.preventDefault(); cancel() } }
    // Register before the browser chooses its touch-scroll path, including a
    // new hold immediately after a native pan. A local late listener can receive
    // only non-cancelable moves once that fast scroll path has been selected.
    window.addEventListener('touchmove', move, { passive: false, capture: true })
    document.addEventListener('keydown', escape)
    return () => { window.removeEventListener('touchmove', move, true); document.removeEventListener('keydown', escape) }
  }, [cancel, holdCards])
  useEffect(() => {
    if (!open) return
    const close = (event: globalThis.PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element) || target.closest('[data-workout-swipe]')?.getAttribute('data-workout-swipe') !== open.id) setOpen(null)
    }
    document.addEventListener('pointerdown', close, true)
    return () => document.removeEventListener('pointerdown', close, true)
  }, [open])
  const context: GestureContext = { blocks, disabled, drag, open, setOpen, cancel, nativeSwipe,
    start(id, event, name, held = false) {
      if (disabled || blocks.length < 2 || dragRef.current || event?.isPrimary === false) return
      event?.preventDefault()
      event?.currentTarget.setPointerCapture(event.pointerId)
      setOpen(null)
      const label = name ?? event?.currentTarget.getAttribute('aria-label')?.replace(/^Переместить: /, '') ?? ''
      setCurrent({ id, target: blocks.indexOf(id), keyboard: !event, pointerId: event?.pointerId, label, held })
      if (event) { pointerY.current = event.clientY; frame.current = requestAnimationFrame(scrollFrame) }
    },
    keyboard(id, key) {
      if (disabled) return false
      if (key === 'Escape') { cancel(); return true }
      if (key === ' ' || key === 'Enter') {
        if (dragRef.current?.id === id) drop()
        else context.start(id)
        return true
      }
      const current = dragRef.current
      if (current?.id === id && current.keyboard && ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) {
        const target = key === 'Home' ? 0 : key === 'End' ? blocks.length - 1 : current.target + (key === 'ArrowUp' ? -1 : 1)
        setCurrent({ ...current, target: Math.max(0, Math.min(blocks.length - 1, target)) })
        return true
      }
      return false
    },
  }
  return <Context.Provider value={context}><div ref={root} className="workout-gesture-list"
    onPointerMove={(event) => { if (dragRef.current && !dragRef.current.keyboard && dragRef.current.pointerId === event.pointerId) { event.preventDefault(); pointerY.current = event.clientY; locate() } }}
    onPointerUp={(event) => { if (dragRef.current && !dragRef.current.keyboard && dragRef.current.pointerId === event.pointerId) drop() }}
    onPointerCancel={(event) => { if (dragRef.current && !dragRef.current.keyboard && dragRef.current.pointerId === event.pointerId) cancel() }}>
    {children}
    {drag && !drag.keyboard && <div ref={preview} className="workout-drag-preview" aria-hidden="true" style={{ top: Math.max(100, Math.min(innerHeight - 140, pointerY.current)) }}>
      <GripIcon /><span><strong>{drag.label}</strong><small>Позиция {drag.target + 1} из {blocks.length} · отпустите, чтобы переместить</small></span>
    </div>}
    <span className="sr-only" role="status">{drag ? `Перенос: позиция ${drag.target + 1} из ${blocks.length}` : ''}</span>
  </div></Context.Provider>
}

export function WorkoutDragBlock({ id, children, holdToDrag = false, label = '' }: { id: string; children: ReactNode; holdToDrag?: boolean; label?: string }) {
  const context = useWorkoutGestures()
  const { drag, blocks, disabled } = context
  const pending = useRef<{ pointerId: number; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null)
  const suppressClick = useRef(false)
  const heldPointer = useRef<number | null>(null)
  const releaseClick = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearHold = () => { if (pending.current) clearTimeout(pending.current.timer); pending.current = null }
  useEffect(() => {
    if (disabled || !holdToDrag) clearHold()
    return () => { clearHold(); if (releaseClick.current) clearTimeout(releaseClick.current) }
  }, [disabled, holdToDrag])
  function isControl(target: EventTarget) {
    if (!(target instanceof Element)) return true
    const control = target.closest('button,input,textarea,select,a,details,summary,video,.exercise-thumbnail,.live-technique,[role="button"],[contenteditable="true"]')
    // A title/compact card keeps its short tap; holding its text may move it.
    return Boolean(control && !control.matches('.exercise-technique-trigger,.workout-exercise-compact'))
  }
  const index = blocks.indexOf(id)
  // Marker represents final insertion position without unmounting any form.
  const before = drag && drag.id !== id && index === (drag.target > blocks.indexOf(drag.id) ? drag.target + 1 : drag.target)
  const after = drag && drag.id !== id && drag.target === blocks.length - 1 && index === blocks.length - 1
  return <div data-workout-block={id} data-card-drag={holdToDrag && !disabled && blocks.length > 1 || undefined} className={`workout-drag-block${drag?.id === id ? ' dragging' : ''}${before ? ' drop-before' : ''}${after ? ' drop-after' : ''}`}
    onPointerDownCapture={(event) => {
      if (!holdToDrag || disabled || blocks.length < 2 || drag || pending.current || event.isPrimary === false || event.button !== 0 || isControl(event.target)) return
      const element = event.currentTarget, pointerId = event.pointerId, x = event.clientX, y = event.clientY
      suppressClick.current = false
      pending.current = { pointerId, x, y, timer: setTimeout(() => {
        pending.current = null
        suppressClick.current = true
        heldPointer.current = pointerId
        context.start(id, { currentTarget: element, pointerId, clientY: y, isPrimary: true, preventDefault() {} }, label, true)
      }, 350) }
    }}
    onPointerMoveCapture={(event) => {
      const hold = pending.current
      if (hold && hold.pointerId === event.pointerId && Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > 8) clearHold()
    }}
    onPointerUpCapture={(event) => {
      if (pending.current?.pointerId === event.pointerId) clearHold()
      if (heldPointer.current === event.pointerId) releaseClick.current = setTimeout(() => { suppressClick.current = false; heldPointer.current = null }, 0)
    }}
    onPointerCancel={(event) => { if (pending.current?.pointerId === event.pointerId) clearHold(); if (heldPointer.current === event.pointerId) { suppressClick.current = false; heldPointer.current = null } }}
    onLostPointerCapture={(event) => { if (drag?.id === id && drag.held && drag.pointerId === event.pointerId) context.cancel() }}
    onContextMenu={(event) => { if (holdToDrag && !isControl(event.target)) event.preventDefault() }}
    onClickCapture={(event) => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false } }}>{children}</div>
}

export function WorkoutDragHandle({ id, label, children }: { id: string; label: string; children?: ReactNode }) {
  const context = useWorkoutGestures()
  return <button type="button" className="workout-drag-handle" aria-label={`Переместить: ${label}`}
    aria-describedby={`workout-drag-help-${id}`} aria-pressed={context.drag?.id === id}
    disabled={context.disabled || context.blocks.length < 2}
    onPointerDown={(event) => { if (event.button === 0) context.start(id, event) }}
    onLostPointerCapture={(event) => { if (context.drag?.pointerId === event.pointerId && !context.drag.keyboard) context.cancel() }}
    onKeyDown={(event) => { if (context.keyboard(id, event.key)) event.preventDefault() }}
    onBlur={() => { if (context.drag?.keyboard) context.cancel() }}>
    {children ?? <GripIcon />}
    <span id={`workout-drag-help-${id}`} className="sr-only">Перетаскивайте за точки и отпустите на нужной позиции. Пробел — взять, стрелки — выбрать позицию, Enter — сохранить, Escape — отменить.</span>
  </button>
}

export function WorkoutSwipe({ id, disabled, onDelete, onReplace, children, variant = 'exercise', actionLabel, swipeFromFields = false }: {
  id: string; disabled: boolean; onDelete: () => void; onReplace?: () => void; children: ReactNode
  variant?: 'exercise' | 'set'; actionLabel?: string; swipeFromFields?: boolean
}) {
  const context = useWorkoutGestures()
  const start = useRef<{ x: number; y: number; pointerId: number; horizontal: boolean; side: 'delete' | 'replace' | null; field?: HTMLInputElement | HTMLButtonElement } | null>(null)
  const surface = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState(0)
  const offsetRef = useRef(0)
  const suppressClick = useRef(false)
  const side = context.open?.id === id ? context.open.side : null
  const inactive = disabled || context.disabled || !!context.drag
  useEffect(() => {
    const element = surface.current
    if (!element || !(context.nativeSwipe || swipeFromFields && variant === 'set') || inactive) return
    // Pointer preventDefault alone does not stop Chromium's native touch
    // recognizer: it can swallow the next rail tap after a horizontal swipe.
    // Own only our committed direction; vertical/pinch remain native.
    const move = (event: TouchEvent) => {
      const origin = start.current, touch = event.touches[0]
      if (!origin || event.touches.length !== 1 || !touch || !event.cancelable) return
      const dx = touch.clientX - origin.x, dy = touch.clientY - origin.y
      if (origin.horizontal || Math.abs(dx) > 16 && Math.abs(dx) > Math.abs(dy) * 1.4) event.preventDefault()
    }
    element.addEventListener('touchmove', move, { passive: false })
    return () => element.removeEventListener('touchmove', move)
  }, [context.nativeSwipe, inactive, swipeFromFields, variant])
  const threshold = variant === 'set' ? 24 : 48
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    if (!start.current || start.current.pointerId !== event.pointerId) return
    const origin = start.current
    if (origin.horizontal && !inactive) {
      const reverse = origin.side === 'delete' && offsetRef.current > 16 || origin.side === 'replace' && offsetRef.current < -16
      context.setOpen(reverse ? null : offsetRef.current < -threshold ? { id, side: 'delete' } : onReplace && offsetRef.current > threshold ? { id, side: 'replace' } : null)
    }
    start.current = null; offsetRef.current = 0; setOffset(0)
    if (origin.field && !origin.horizontal && !inactive && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 12) {
      // Focus within the trusted pointer-up, only after this is known to be a tap.
      // A swipe never opens the keyboard; an already edited input is never intercepted.
      if (origin.field instanceof HTMLInputElement) {
        origin.field.focus({ preventScroll: true })
        if (origin.field.type === 'text') origin.field.select()
      } else {
        suppressClick.current = false
        origin.field.click()
      }
      suppressClick.current = true
    }
  }
  return <div ref={surface} data-workout-swipe={id} className={`workout-swipe${variant === 'set' ? ' workout-set-swipe' : ''}`}
    tabIndex={variant === 'set' && !inactive ? 0 : undefined}
    role={variant === 'set' ? 'group' : undefined}
    aria-label={variant === 'set' ? actionLabel : undefined}
    onKeyDown={(event) => {
      suppressClick.current = false
      if (variant !== 'set' || inactive || event.target !== event.currentTarget) return
      if (event.key === 'Delete') { event.preventDefault(); context.setOpen({ id, side: 'delete' }) }
      if (event.key === 'Escape') { event.preventDefault(); context.setOpen(null) }
    }}
    onPointerDownCapture={(event) => {
      suppressClick.current = false
      if (!swipeFromFields || variant !== 'set' || inactive || start.current || event.isPrimary === false || event.button !== 0) return
      const target = event.target as Element
      if (target.closest('[data-workout-swipe]') !== event.currentTarget) return
      const field = target.closest('input:not([type="hidden"]):not(:disabled),button.workout-duration-trigger:not(:disabled)')
      if (!(field instanceof HTMLInputElement || field instanceof HTMLButtonElement) || document.activeElement === field) return
      event.preventDefault(); event.stopPropagation()
      start.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, horizontal: false, side, field }
      suppressClick.current = true
      event.currentTarget.setPointerCapture(event.pointerId)
    }}
    onPointerDown={(event) => {
      // A set row owns its pointer stream; the exercise must not also swipe.
      if ((event.target as Element).closest('[data-workout-swipe]') !== event.currentTarget) return
      if (inactive || start.current || event.isPrimary === false || event.button !== 0 || (event.target as Element).closest('button,input,textarea,select,a,video,[role="button"],[contenteditable="true"]')) return
      // Native text selection can turn the next swipe into HTML drag-and-drop
      // and cancel its pointer stream. Editable controls are excluded above.
      event.preventDefault()
      start.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, horizontal: false, side }; suppressClick.current = false
      // The narrow set-number gutter ends before the horizontal threshold.
      // Keep its stream until direction is known; pan-y still permits native scrolling.
      if (variant === 'set') event.currentTarget.setPointerCapture(event.pointerId)
    }}
    onMouseDownCapture={(event) => { if (start.current?.field) event.preventDefault() }}
    onPointerMove={(event) => {
      const origin = start.current
      if (!origin || inactive || origin.pointerId !== event.pointerId) return
      const dx = event.clientX - origin.x, dy = event.clientY - origin.y
      if (!origin.horizontal && Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) { start.current = null; return }
      if (!origin.horizontal && Math.abs(dx) > 16 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        origin.horizontal = true; suppressClick.current = true; event.currentTarget.setPointerCapture(event.pointerId)
      }
      if (origin.horizontal) { event.preventDefault(); offsetRef.current = Math.max(-96, Math.min(onReplace || origin.side === 'delete' ? 96 : 0, dx)); setOffset(offsetRef.current) }
    }} onPointerUp={finish} onPointerCancel={(event) => { if (start.current?.pointerId === event.pointerId) { start.current = null; offsetRef.current = 0; setOffset(0) } }}
    onLostPointerCapture={(event) => {
      // Native touch initially captures the heading/field implicitly. Moving
      // capture to the swipe surface bubbles that child's loss; it is not a
      // cancellation of the surface's newly captured pointer.
      if (context.nativeSwipe && event.target !== event.currentTarget) return
      if (start.current?.pointerId === event.pointerId) { start.current = null; offsetRef.current = 0; setOffset(0) }
    }}
    onClickCapture={(event) => { if (suppressClick.current && !(event.target as Element).closest('.workout-swipe-action')) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false } }}>
    {side && <button type="button" className={`workout-swipe-action ${side}`} disabled={inactive}
      aria-label={side === 'delete' ? actionLabel : undefined}
      onClick={() => { context.setOpen(null); if (side === 'delete') onDelete(); else onReplace?.() }}>{side === 'delete' ? 'Удалить' : 'Заменить'}</button>}
    <div className="workout-swipe-content" style={{ transform: `translateX(${offset || (side === 'delete' ? -96 : side === 'replace' ? 96 : 0)}px)` }}>{children}</div>
  </div>
}
