import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../app/auth-context'
import { useDataBackend } from '../../app/data-backend-context'
import { isNutritionPilotEnabled } from '../../app/feature-flags'
import { Switch } from '../../shared/ui'

/** The same consent and cache as the diary's existing access settings. */
export function TrainerNutritionConsent({ clientId, trainerId }: { clientId: string; trainerId: string }) {
  const { actor } = useAuth()
  const { nutrition } = useDataBackend()
  const queryClient = useQueryClient()
  const available = !!actor && isNutritionPilotEnabled(actor.userId, actor.experiments?.nutrition)
  const key = ['nutrition', actor?.userId, 'consents']
  const connections = useQuery({ queryKey: key, queryFn: () => nutrition.consents(), enabled: available, staleTime: 0, retry: false })
  const connection = connections.data?.find(item => item.clientId === clientId && item.trainerId === trainerId)
  const mutation = useMutation({
    mutationFn: (granted: boolean) => nutrition.setConsent(connection!, granted),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['nutrition'] }) },
  })
  return <>
    <Switch label="Питание" checked={connection?.granted ?? false}
      disabled={!connection || connections.isFetching || mutation.isPending} onChange={granted => mutation.mutate(granted)} />
    {!available || connections.isSuccess && !connection ? <p className="muted">Питание пока недоступно для этой связки.</p> : null}
    {(connections.isLoading || mutation.isPending) && <p role="status">{mutation.isPending ? 'Сохраняем доступ к питанию…' : 'Проверяем доступ к питанию…'}</p>}
    {(connections.error || mutation.error) && <p className="error" role="alert">Не удалось обновить доступ к питанию. <button className="link" onClick={() => { mutation.reset(); void connections.refetch() }}>Повторить проверку питания</button></p>}
  </>
}
