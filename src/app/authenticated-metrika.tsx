import { useEffect, useRef } from 'react'
import { trackAuthenticatedOpen } from '../shared/yandex-metrika'
import { useAuth } from './auth-context'

export function AuthenticatedMetrika() {
  const { actor } = useAuth()
  const identifiedActor = useRef<string | null>(null)

  useEffect(() => {
    if (!actor) {
      identifiedActor.current = null
      return
    }
    const actorKey = `${actor.role}:${actor.userId}`
    if (identifiedActor.current === actorKey) return
    identifiedActor.current = actorKey
    trackAuthenticatedOpen(actor.userId, actor.role)
  }, [actor])

  return null
}
