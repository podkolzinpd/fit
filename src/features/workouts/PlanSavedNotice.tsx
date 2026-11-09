import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { CloseIcon } from '../../shared/icons'

/** Consume only the save receipt, preserving the calendar's other route state. */
export function PlanSavedNotice() {
  const location = useLocation()
  const navigate = useNavigate()
  const state = location.state as Record<string, unknown> | null
  const id = state?.savedPlanId
  const consumed = useRef<unknown>(undefined)
  const route = `${location.pathname}${location.search}`
  const [notice, setNotice] = useState<{ id: string; route: string } | null>(null)
  useEffect(() => {
    setNotice(previous => previous?.route === route ? previous : null)
  }, [route])
  useEffect(() => {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id) || consumed.current === id) return
    consumed.current = id
    setNotice({ id, route })
    const remaining = { ...state }
    delete remaining.savedPlanId
    navigate(`${location.pathname}${location.search}`, { replace: true, state: Object.keys(remaining).length ? remaining : null })
  }, [id, state, location.pathname, location.search, navigate, route])
  return notice?.route === route ? <section className="fit-lime-plan-saved" role="status">
    <span>План сохранён</span>
    <Link to={`/workouts/${notice.id}`} state={{ returnTo: `${location.pathname}${location.search}` }}>Открыть</Link>
    <button type="button" className="link" aria-label="Скрыть подтверждение" onClick={() => setNotice(null)}><CloseIcon /></button>
  </section> : null
}
