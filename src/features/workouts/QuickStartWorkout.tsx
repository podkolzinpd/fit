import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { invalidateWorkoutResults } from '../../app/invalidate-workout-results'
import { useAuth } from '../../app/auth-context'
import { useDataBackend } from '../../app/data-backend-context'
import type { Client, Workout } from '../../shared/domain'
import { trackGoal } from '../../shared/yandex-metrika'
import { ClientPicker } from '../clients/ClientPicker'

interface QuickStartWorkoutProps {
  role: 'client' | 'trainer'
  clientId?: string
  clients?: Client[]
  workouts?: Workout[]
  loading?: boolean
  error?: Error | null
  onRetry?: () => void
  returnTo: string
  compact?: boolean
}

export function QuickStartWorkout({ role, clientId, clients = [], workouts, loading, error, onRetry, returnTo, compact = false }: QuickStartWorkoutProps) {
  const { workouts: repository } = useDataBackend()
  const { actor } = useAuth()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [formatLocked, setFormatLocked] = useState(false)
  const [formatOpen, setFormatOpen] = useState(false)
  const [trainingFormat, setTrainingFormat] = useState<'self' | 'with_trainer'>('with_trainer')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [targetClientId, setTargetClientId] = useState<string | null>(null)
  const operation = useRef<{ clientId: string | null; id: string; format: 'self' | 'with_trainer' } | null>(null)
  const active = clientId && workouts?.find((workout) => workout.clientId === clientId && workout.status === 'in_progress')
  const canContinue = Boolean(active)
  const start = useMutation({
    mutationFn: async (selectedClientId: string | null) => {
      if (operation.current?.clientId !== selectedClientId) operation.current = { clientId: selectedClientId, id: crypto.randomUUID(), format: role === 'client' ? 'self' : trainingFormat }
      return repository.quickStart(selectedClientId ?? undefined, operation.current.id, operation.current.format)
    },
    onSuccess: async ({ id, resumed }) => {
      trackGoal(resumed ? 'quick_start_resumed' : 'quick_start_created')
      operation.current = null
      await invalidateWorkoutResults(queryClient)
      await queryClient.invalidateQueries({ queryKey: ['today-workouts'] })
      navigate(`/workouts/${id}/live`, { state: { returnTo } })
    },
    onError: () => trackGoal('quick_start_failed'),
  })

  function begin(selectedClientId: string | null) {
    if (start.isPending) return
    setPickerOpen(false)
    setTargetClientId(selectedClientId)
    const current = workouts?.find((workout) => workout.clientId === selectedClientId && workout.status === 'in_progress')
    if (current) {
      navigate(`/workouts/${current.id}/live`, { state: { returnTo } })
      return
    }
    setFormatLocked(true)
    start.mutate(selectedClientId)
  }

  function chooseClient(selectedClientId: string | null) {
    setPickerOpen(false)
    setTargetClientId(selectedClientId)
    const current = workouts?.find((workout) => workout.clientId === selectedClientId && workout.status === 'in_progress')
    if (current) { navigate(`/workouts/${current.id}/live`, { state: { returnTo } }); return }
    setFormatLocked(operation.current?.clientId === selectedClientId)
    setTrainingFormat(operation.current?.clientId === selectedClientId ? operation.current.format : 'with_trainer')
    setFormatOpen(true)
  }

  const buttonLabel = canContinue ? 'Продолжить тренировку' : 'Начать тренировку'
  const unavailable = Boolean(error || loading || (role === 'client' && !clientId) || (role === 'trainer' && !clientId && !clients.length))
  const action = () => {
    if (canContinue && active) {
      navigate(`/workouts/${active.id}/live`, { state: { returnTo } })
    } else if (role === 'trainer' && !clientId) {
      setPickerOpen(true)
    } else if (role === 'trainer') {
      chooseClient(clientId ?? null)
    } else {
      begin(clientId ?? null)
    }
  }

  return <section className={`quick-start-workout${compact ? ' compact' : ''}`} aria-label="Тренировка сейчас">
    {!compact && <div className="quick-start-copy"><h2>{buttonLabel}</h2><p>{canContinue ? 'Вернитесь к упражнениям и результатам.' : role === 'trainer' ? 'Выберите клиента и добавляйте упражнения по ходу занятия.' : 'Тренировка начнётся сразу. Упражнения добавите по ходу.'}</p></div>}
    {!formatOpen && <button type="button" className="quick-start-button" disabled={unavailable || start.isPending} onClick={action}>{start.isPending ? 'Начинаем…' : buttonLabel}</button>}
    {formatOpen && <div className="quick-start-format" aria-busy={start.isPending}>
      <p>{clients.find((item) => item.id === targetClientId)?.fullName ?? 'Формат тренировки'}</p>
      <div className="workout-record-mode" role="group" aria-label="Формат тренировки"><button type="button" disabled={start.isPending || formatLocked} className={trainingFormat === 'with_trainer' ? 'active' : ''} aria-pressed={trainingFormat === 'with_trainer'} onClick={() => setTrainingFormat('with_trainer')}>С тренером</button><button type="button" disabled={start.isPending || formatLocked} className={trainingFormat === 'self' ? 'active' : ''} aria-pressed={trainingFormat === 'self'} onClick={() => setTrainingFormat('self')}>Самостоятельно</button></div>
      <div className="actions"><button type="button" className="secondary" disabled={start.isPending} onClick={() => { setFormatOpen(false); start.reset() }}>Отмена</button><button type="button" className="primary" disabled={start.isPending} onClick={() => begin(targetClientId)}>{start.isPending ? 'Начинаем…' : start.error ? 'Повторить' : 'Начать'}</button></div>
    </div>}
    {role === 'trainer' && !clientId && !loading && !error && clients.length === 0 && <p className="quick-start-status">Сначала <Link to="/clients/new">добавьте клиента</Link>.</p>}
    {error && <p className="quick-start-status" role="alert">Не удалось загрузить тренировки. {onRetry && <button type="button" onClick={onRetry}>Повторить</button>}</p>}
    {start.error && <p className="quick-start-status" role="alert">{start.error instanceof Error && 'code' in start.error && start.error.code === 'active_workout_exists'
      ? 'У клиента уже есть активная тренировка другого тренера.'
      : 'Не удалось начать тренировку. Данные не потеряны.'} {!formatOpen && <button type="button" onClick={() => begin(targetClientId)}>Повторить</button>}</p>}
    {pickerOpen && <ClientPicker userId={actor?.userId} clients={clients} selectedId="" onChange={chooseClient} initialOpen hideTrigger onDismiss={() => setPickerOpen(false)} label="Для кого тренировка" />}
  </section>
}

export function TrainerActiveWorkouts({ workouts, returnTo }: { workouts?: Workout[]; returnTo: string }) {
  const active = workouts?.filter((workout) => workout.status === 'in_progress') ?? []
  if (!active.length) return null
  return <section className="trainer-active-workouts" aria-label="Активные тренировки">
    <h2>Продолжить тренировку</h2>
    {active.map((workout) => <Link key={workout.id} to={`/workouts/${workout.id}/live`} state={{ returnTo }}><span>{workout.clientName}</span><span>Продолжить →</span></Link>)}
  </section>
}
