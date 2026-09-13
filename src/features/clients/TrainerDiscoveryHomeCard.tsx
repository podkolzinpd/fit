import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useDataBackend } from '../../app/data-backend-context'
import { isTrainerDiscoveryHomeEnabled } from '../../app/feature-flags'
import type { TrainerDiscoveryPromptAction, TrainerDiscoveryPromptPreference } from '../../shared/domain'
import { useConfirm } from '../../shared/ui'

export function TrainerDiscoveryHomeCard({ clientId }: { clientId: string }) {
  const { invitations, trainerDiscovery } = useDataBackend()
  const queryClient = useQueryClient()
  const [hidden, setHidden] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [confirm, confirmDialog] = useConfirm()
  const trainers = useQuery({
    queryKey: ['client-trainers', clientId],
    queryFn: () => invitations.listTrainers(clientId),
    enabled: isTrainerDiscoveryHomeEnabled(),
  })
  const preferenceKey = ['trainer-discovery-prompt', clientId] as const
  const preference = useQuery({
    queryKey: preferenceKey,
    queryFn: () => trainerDiscovery.getPromptPreference(),
    enabled: isTrainerDiscoveryHomeEnabled() && trainers.data?.length === 0,
  })
  const savePreference = useMutation({
    mutationFn: (action: TrainerDiscoveryPromptAction) => trainerDiscovery.setPromptPreference(action),
    onMutate: () => setFeedback(null),
    onSuccess: (next, action) => {
      queryClient.setQueryData<TrainerDiscoveryPromptPreference>(preferenceKey, next)
      setFeedback(action === 'snooze' ? 'Напомним через месяц.' : 'Карточка больше не появится.')
    },
  })

  useEffect(() => {
    if (!feedback) return
    const timer = window.setTimeout(() => setHidden(true), 1_400)
    return () => window.clearTimeout(timer)
  }, [feedback])

  if (!isTrainerDiscoveryHomeEnabled()
    || hidden
    || !trainers.data
    || trainers.data.length > 0) return null

  if (feedback) return <section className="trainer-discovery-home-card trainer-discovery-home-feedback" role="status">
    <strong>{feedback}</strong>
  </section>

  if (preference.data?.state !== 'visible') return null

  return <section className="trainer-discovery-home-card" aria-labelledby="trainer-discovery-home-title">
    <div>
      <h2 id="trainer-discovery-home-title">Нужен тренер?</h2>
      <p>Посмотрите анкеты и напишите подходящему тренеру.</p>
    </div>
    <Link className="button primary wide" to="/me/trainers">Найти тренера</Link>
    <div className="trainer-discovery-home-actions">
      <button type="button" className="link" disabled={savePreference.isPending} onClick={() => savePreference.mutate('snooze')}>Напомнить через месяц</button>
      <button type="button" className="link muted" disabled={savePreference.isPending} onClick={async () => {
        if (await confirm({ message: 'Больше не показывать эту карточку?', confirmLabel: 'Больше не показывать', danger: true })) savePreference.mutate('dismiss')
      }}>Неинтересно</button>
    </div>
    {savePreference.error && <p className="error" role="alert">Не удалось сохранить. Попробуйте ещё раз.</p>}
    {confirmDialog}
  </section>
}
