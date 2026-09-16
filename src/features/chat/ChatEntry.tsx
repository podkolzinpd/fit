import { useMutation } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { useDataBackend } from '../../app/data-backend-context'
import { useAuth } from '../../app/auth-context'
import { MessageIcon } from '../../shared/icons'
import { useChatThreads } from './use-chat-threads'

export function ChatHeaderAction() {
  const threads = useChatThreads()
  const unread = (threads.data ?? []).reduce((sum, item) => sum + item.unreadCount, 0)
  return <Link className="chat-header-action" to="/chat" aria-label={unread ? `Сообщения, непрочитанных: ${unread}` : 'Сообщения'}>
    <MessageIcon />
    {unread > 0 && <span className="chat-unread-badge" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
  </Link>
}

export function ChatStartButton({ clientId, trainerId, conversationId = null, className = 'link', iconOnly = false,
  partnerName = '', unreadCount = 0, back = 'history', onBeforeOpen }: {
  clientId: string; trainerId: string; conversationId?: string | null; className?: string; iconOnly?: boolean
  partnerName?: string; unreadCount?: number; back?: string; onBeforeOpen?: () => void
}) {
  const { chat } = useDataBackend()
  const navigate = useNavigate()
  const open = useMutation({
    mutationFn: () => conversationId ? Promise.resolve(conversationId) : chat.open(clientId, trainerId),
    onSuccess: (id) => navigate(`/chat/${id}`, { state: { chatBack: back } }),
  })
  const label = partnerName
    ? `Сообщения с ${partnerName}${unreadCount > 0 ? `, непрочитанных: ${unreadCount}` : ''}`
    : 'Написать'
  return <span className={`chat-start-wrap${iconOnly ? ' chat-start-wrap-icon' : ''}`}>
    <button type="button" className={`${className}${open.error ? ' chat-start-error' : ''}`} disabled={open.isPending}
      aria-label={iconOnly ? label : undefined} aria-busy={open.isPending}
      onClick={() => { onBeforeOpen?.(); open.mutate() }}>
      {iconOnly ? <><MessageIcon />{unreadCount > 0 && <span className="chat-unread-badge" aria-hidden="true">{unreadCount > 99 ? '99+' : unreadCount}</span>}</>
        : open.isPending ? 'Открываем…' : 'Написать'}
    </button>
    {open.error && <small className="error" role="alert">{iconOnly ? 'Повторить' : 'Не удалось открыть чат'}</small>}
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
