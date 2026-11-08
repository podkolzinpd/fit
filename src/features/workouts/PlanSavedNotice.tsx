import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

/** Consume only the save receipt, preserving the calendar's other route state. */
export function PlanSavedNotice() {
  const location = useLocation()
  const navigate = useNavigate()
  const state = location.state as Record<string, unknown> | null
  const id = state?.savedPlanId
  const consumed = useRef<unknown>(undefined)
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id) || consumed.current === id) return
    consumed.current = id
    setNotice(id)
    const remaining = { ...state }
    delete remaining.savedPlanId
    navigate(`${location.pathname}${location.search}`, { replace: true, state: Object.keys(remaining).length ? remaining : null })
  }, [id, state, location.pathname, location.search, navigate])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 3000)
    return () => window.clearTimeout(timer)
  }, [notice])
  return notice ? <section className="fit-lime-plan-saved" role="status">План сохранён</section> : null
}
