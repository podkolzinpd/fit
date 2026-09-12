import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { useDataBackend } from '../../app/data-backend-context'
import { useAuth } from '../../app/auth-context'
import { MessageIcon } from '../../shared/icons'

export function ChatHeaderAction() {
  const { chat } = useDataBackend()
  const threads = useQuery({ queryKey: ['chat-threads'], queryFn: () => chat.listThreads(), refetchInterval: 30_000 })
  const unread = (threads.data ?? []).reduce((sum, item) => sum + item.unreadCount, 0)
  return <Link className="chat-header-action" to="/chat" aria-label={unread ? `Сообщения, непрочитанных: ${unread}` : 'Сообщения'}>
    <MessageIcon />
    {unread > 0 && <span className="chat-unread-badge" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
  </Link>
}

export function ChatStartButton({ clientId, trainerId, className = 'link' }: { clientId: string; trainerId: string; className?: string }) {
  const { chat } = useDataBackend()
  const navigate = useNavigate()
  const open = useMutation({ mutationFn: () => chat.open(clientId, trainerId), onSuccess: (id) => navigate(`/chat/${id}`, { state: { chatBack: 'history' } }) })
  return <span className="chat-start-wrap">
    <button type="button" className={className} disabled={open.isPending} onClick={() => open.mutate()}>{open.isPending ? 'Открываем…' : 'Написать'}</button>
    {open.error && <small className="error">Не удалось открыть чат</small>}
  </span>
}

export function PublicTrainerChatButton({ publicProfileId, className = 'primary wide' }: { publicProfileId: string; className?: string }) {
  const { actor } = useAuth()
  const { chat } = useDataBackend()
  const navigate = useNavigate()
  const open = useMutation({ mutationFn: () => chat.openPublicTrainer(publicProfileId), onSuccess: (id) => navigate(`/chat/${id}`, { state: { chatBack: 'profile' } }) })
  if (actor?.role === 'trainer') return null
  if (!actor) return <Link className={`button ${className}`} to="/auth" state={{ from: `/trainers/${publicProfileId}` }}>Войти, чтобы написать</Link>
  return <span className="chat-start-wrap">
    <button type="button" className={className} disabled={open.isPending} onClick={() => open.mutate()}>{open.isPending ? 'Открываем…' : 'Написать тренеру'}</button>
    {open.error && <small className="error">Не удалось открыть диалог</small>}
  </span>
}
