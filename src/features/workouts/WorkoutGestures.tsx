import { createContext, useContext, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { GripIcon } from '../../shared/icons'

type Drag = { id: string; target: number; keyboard: boolean; pointerId?: number }
type GestureContext = {
  blocks: string[]; disabled: boolean; drag: Drag | null;
  open: { id: string; side: 'delete' | 'replace' } | null;
  setOpen: (value: GestureContext['open']) => void;
  start: (id: string, event?: PointerEvent<HTMLButtonElement>) => void;
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
export function WorkoutGestureList({ blocks, disabled, onMove, children }: {
  blocks: string[]; disabled: boolean; onMove: (id: string, targetIndex: number) => void; children: ReactNode
}) {
  const root = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [open, setOpen] = useState<GestureContext['open']>(null)
  const frame = useRef<number | null>(null)
  const pointerY = useRef(0)
  const setCurrent = (value: Drag | null) => { dragRef.current = value; setDrag(value) }
  const cancel = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    setCurrent(null)
  }
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
    const target = elements.filter((element) => pointerY.current > element.getBoundingClientRect().top + element.getBoundingClientRect().height / 2).length
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
    if (!open) return
    const close = (event: globalThis.PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element) || target.closest('[data-workout-swipe]')?.getAttribute('data-workout-swipe') !== open.id) setOpen(null)
    }
    document.addEventListener('pointerdown', close, true)
    return () => document.removeEventListener('pointerdown', close, true)
  }, [open])
  const context: GestureContext = { blocks, disabled, drag, open, setOpen, cancel,
    start(id, event) {
      if (disabled || blocks.length < 2 || dragRef.current || event?.isPrimary === false) return
      event?.preventDefault()
      event?.currentTarget.setPointerCapture(event.pointerId)
      setOpen(null)
      setCurrent({ id, target: blocks.indexOf(id), keyboard: !event, pointerId: event?.pointerId })
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
    <span className="sr-only" role="status">{drag ? `Перенос: позиция ${drag.target + 1} из ${blocks.length}` : ''}</span>
  </div></Context.Provider>
}

export function WorkoutDragBlock({ id, children }: { id: string; children: ReactNode }) {
  const { drag, blocks } = useWorkoutGestures()
  const index = blocks.indexOf(id)
  // Marker represents final insertion position without unmounting any form.
  const before = drag && drag.id !== id && index === (drag.target > blocks.indexOf(drag.id) ? drag.target + 1 : drag.target)
  const after = drag && drag.id !== id && drag.target === blocks.length - 1 && index === blocks.length - 1
  return <div data-workout-block={id} className={`workout-drag-block${drag?.id === id ? ' dragging' : ''}${before ? ' drop-before' : ''}${after ? ' drop-after' : ''}`}>{children}</div>
}

export function WorkoutDragHandle({ id, label, children }: { id: string; label: string; children?: ReactNode }) {
  const context = useWorkoutGestures()
  return <button type="button" className="workout-drag-handle" aria-label={`Переместить: ${label}`}
    aria-describedby={`workout-drag-help-${id}`} aria-pressed={context.drag?.id === id}
    disabled={context.disabled || context.blocks.length < 2}
    onPointerDown={(event) => { if (event.button === 0) context.start(id, event) }}
    onKeyDown={(event) => { if (context.keyboard(id, event.key)) event.preventDefault() }}
    onBlur={() => { if (context.drag?.keyboard) context.cancel() }}>
    {children ?? <GripIcon />}
    <span id={`workout-drag-help-${id}`} className="sr-only">Пробел — взять, стрелки — выбрать позицию, Enter — сохранить, Escape — отменить.</span>
  </button>
}

export function WorkoutSwipe({ id, disabled, onDelete, onReplace, children }: {
  id: string; disabled: boolean; onDelete: () => void; onReplace: () => void; children: ReactNode
}) {
  const context = useWorkoutGestures()
  const start = useRef<{ x: number; y: number; pointerId: number; horizontal: boolean; side: 'delete' | 'replace' | null } | null>(null)
  const [offset, setOffset] = useState(0)
  const offsetRef = useRef(0)
  const suppressClick = useRef(false)
  const side = context.open?.id === id ? context.open.side : null
  const inactive = disabled || context.disabled || !!context.drag
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    if (!start.current || start.current.pointerId !== event.pointerId) return
    if (start.current.horizontal && !inactive) {
      const reverse = start.current.side === 'delete' && offsetRef.current > 16 || start.current.side === 'replace' && offsetRef.current < -16
      context.setOpen(reverse ? null : offsetRef.current < -48 ? { id, side: 'delete' } : offsetRef.current > 48 ? { id, side: 'replace' } : null)
    }
    start.current = null; offsetRef.current = 0; setOffset(0)
  }
  return <div data-workout-swipe={id} className="workout-swipe"
    onPointerDown={(event) => {
      if (inactive || start.current || event.isPrimary === false || event.button !== 0 || (event.target as Element).closest('button,input,textarea,select,a,video,[role="button"],[contenteditable="true"]')) return
      start.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, horizontal: false, side }; suppressClick.current = false
    }}
    onPointerMove={(event) => {
      const origin = start.current
      if (!origin || inactive || origin.pointerId !== event.pointerId) return
      const dx = event.clientX - origin.x, dy = event.clientY - origin.y
      if (!origin.horizontal && Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) { start.current = null; return }
      if (!origin.horizontal && Math.abs(dx) > 16 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        origin.horizontal = true; suppressClick.current = true; event.currentTarget.setPointerCapture(event.pointerId)
      }
      if (origin.horizontal) { event.preventDefault(); offsetRef.current = Math.max(-96, Math.min(96, dx)); setOffset(offsetRef.current) }
    }} onPointerUp={finish} onPointerCancel={(event) => { if (start.current?.pointerId === event.pointerId) { start.current = null; offsetRef.current = 0; setOffset(0) } }}
    onClickCapture={(event) => { if (suppressClick.current && !(event.target as Element).closest('.workout-swipe-action')) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false } }}>
    {side && <button type="button" className={`workout-swipe-action ${side}`} disabled={inactive}
      onClick={() => { context.setOpen(null); if (side === 'delete') onDelete(); else onReplace() }}>{side === 'delete' ? 'Удалить' : 'Заменить'}</button>}
    <div className="workout-swipe-content" style={{ transform: `translateX(${offset || (side === 'delete' ? -96 : side === 'replace' ? 96 : 0)}px)` }}>{children}</div>
  </div>
}
