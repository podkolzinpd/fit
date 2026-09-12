import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useDataBackend } from '../../app/data-backend-context'
import { isTrainerDiscoveryHomeEnabled } from '../../app/feature-flags'
import type { TrainerDiscoveryPromptAction, TrainerDiscoveryPromptPreference } from '../../shared/domain'

export function TrainerDiscoveryHomeCard({ clientId }: { clientId: string }) {
  const { invitations, trainerDiscovery } = useDataBackend()
  const queryClient = useQueryClient()
  const [hiddenWhileSaving, setHiddenWhileSaving] = useState(false)
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
    onMutate: () => setHiddenWhileSaving(true),
    onSuccess: (next) => queryClient.setQueryData<TrainerDiscoveryPromptPreference>(preferenceKey, next),
    onError: () => setHiddenWhileSaving(false),
  })

  if (!isTrainerDiscoveryHomeEnabled()
    || hiddenWhileSaving
    || !trainers.data
    || trainers.data.length > 0
    || preference.data?.state !== 'visible') return null

  return <section className="trainer-discovery-home-card" aria-labelledby="trainer-discovery-home-title">
    <div>
      <h2 id="trainer-discovery-home-title">Нужен тренер?</h2>
      <p>Посмотрите анкеты и напишите подходящему тренеру.</p>
    </div>
    <Link className="button primary wide" to="/me/trainers">Найти тренера</Link>
    <div className="trainer-discovery-home-actions">
      <button type="button" className="link" disabled={savePreference.isPending} onClick={() => savePreference.mutate('snooze')}>Напомнить позже</button>
      <button type="button" className="link muted" disabled={savePreference.isPending} onClick={() => savePreference.mutate('dismiss')}>Неинтересно</button>
    </div>
    {savePreference.error && <p className="error" role="alert">Не удалось сохранить. Попробуйте ещё раз.</p>}
  </section>
}
