import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { authRepository } from '../../data/repositories/auth.repository'
import { clientsRepository } from '../../data/repositories/clients.repository'
import { invitationsRepository } from '../../data/repositories/invitations.repository'
import { Field, Page } from '../../shared/ui'

export function ProfilePage() {
  const { actor, refresh } = useAuth(); const navigate = useNavigate(); const [saved, setSaved] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const queryClient = useQueryClient()
  const isClient = actor?.role === 'client'
  const myClient = useQuery({ queryKey: ['my-client'], queryFn: () => clientsRepository.getMine(), enabled: isClient })
  const trainers = useQuery({ queryKey: ['client-trainers', myClient.data?.id], queryFn: () => invitationsRepository.listTrainers(myClient.data!.id), enabled: Boolean(myClient.data) })
  const invitations = useQuery({ queryKey: ['client-invitations', myClient.data?.id], queryFn: () => invitationsRepository.list(myClient.data!.id), enabled: Boolean(myClient.data) })
  const invite = useMutation({ mutationFn: (clientId: string) => invitationsRepository.create(clientId, 'trainer'), onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['client-invitations', myClient.data?.id] }) })
  const revoke = useMutation({ mutationFn: (invitationId: string) => invitationsRepository.revoke(invitationId), onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['client-invitations', myClient.data?.id] }) })
  const removeTrainer = useMutation({ mutationFn: (trainerId: string) => invitationsRepository.removeTrainer(myClient.data!.id, trainerId), onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['client-trainers', myClient.data?.id] }) })

  const update = useMutation({ mutationFn: async (form: HTMLFormElement) => {
    if (!actor || actor.kind !== 'trainer') throw new Error('Профиль тренера недоступен')
    const data = new FormData(form)
    await authRepository.updateProfile({ ...actor, firstName: String(data.get('firstName') || '') || null, lastName: String(data.get('lastName') || '') || null, timezone: String(data.get('timezone')) })
  }, onSuccess: async () => { setSaved(true); await refresh() } })
  async function logout() { await authRepository.signOut(); navigate('/auth') }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); update.mutate(event.currentTarget) }
  // Отмена сбрасывает несохранённые правки к текущим значениям профиля.
  function cancel() { formRef.current?.reset(); setSaved(false) }

  return <Page title="Профиль">
    {!isClient && <form ref={formRef} className="stack" onSubmit={(event) => void submit(event)}>
      <Field label="Имя"><input name="firstName" defaultValue={actor?.firstName ?? ''} /></Field>
      <Field label="Фамилия"><input name="lastName" defaultValue={actor?.lastName ?? ''} /></Field>
      <Field label="Часовой пояс"><input name="timezone" defaultValue={actor?.timezone ?? 'Europe/Moscow'} /></Field>
      {update.error && <p className="error">{update.error.message}</p>}
      {saved && <p className="success">Сохранено</p>}
      <div className="actions"><button type="button" className="secondary" onClick={cancel}>Отмена</button><button disabled={update.isPending}>Сохранить</button></div>
    </form>}

    {isClient && myClient.data && <div className="stack">
      <Link className="button secondary wide" to="/me/edit">Изменить данные</Link>
      <button className="secondary" disabled={invite.isPending} onClick={() => invite.mutate(myClient.data!.id)}>Пригласить тренера</button>
      {invite.data && <div className="card"><strong>Код для тренера: {invite.data}</strong><p>Код действует 7 дней и используется один раз.</p></div>}
      {invite.error && <p className="error">{invite.error.message}</p>}
      <section><h2>Мои тренеры</h2>
        {trainers.isLoading && <p className="muted">Загрузка тренеров…</p>}
        {trainers.error && <div><p className="error">{trainers.error.message}</p><button className="secondary" onClick={() => void trainers.refetch()}>Повторить</button></div>}
        {trainers.data?.length === 0 && <p className="muted">Подключённых тренеров нет</p>}
        {trainers.data?.map((trainer) => <article className="card" key={trainer.trainerId}><div><strong>{[trainer.firstName, trainer.lastName].filter(Boolean).join(' ') || 'Тренер'}</strong><p>{trainer.isRoot ? 'Основной тренер' : 'Подключённый тренер'}</p></div>{!trainer.isRoot && <button className="link danger" disabled={removeTrainer.isPending} onClick={() => { if (window.confirm('Отключить этого тренера? Он потеряет доступ к вашим тренировкам и прогрессу.')) removeTrainer.mutate(trainer.trainerId) }}>Отключить</button>}</article>)}
      </section>
      {invitations.isLoading && <p className="muted">Загрузка приглашений…</p>}
      {invitations.data && invitations.data.length > 0 && <section><h2>Активные приглашения</h2>{invitations.data.map((item) => <article className="card" key={item.id}><div><strong>Для тренера</strong><p>Действует до {new Date(item.expiresAt).toLocaleDateString('ru-RU')}</p></div><button className="link danger" disabled={revoke.isPending} onClick={() => { if (window.confirm('Отозвать это приглашение? Код больше нельзя будет использовать.')) revoke.mutate(item.id) }}>Отозвать</button></article>)}</section>}
      {invitations.error && <div><p className="error">{invitations.error.message}</p><button className="secondary" onClick={() => void invitations.refetch()}>Повторить</button></div>}
      {(removeTrainer.error || revoke.error) && <p className="error">{(removeTrainer.error ?? revoke.error)?.message}</p>}
    </div>}

    <div className="menu"><Link to="/join">Ввести код приглашения</Link>{actor?.role === 'trainer' && <Link to="/exercises">Управление упражнениями</Link>}</div>
    <button className="danger secondary wide" onClick={() => void logout()}>Выйти</button>
  </Page>
}
