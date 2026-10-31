import { useMutation } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { useDataBackend, useOptionalDataBackend } from '../../app/data-backend-context'
import { useAuth } from '../../app/auth-context'
import { MessageIcon } from '../../shared/icons'
import { useChatThreads } from './use-chat-threads'

export function ChatHeaderAction({ returnTo }: { returnTo?: string }) {
  const threads = useChatThreads()
  const unread = (threads.data ?? []).reduce((sum, item) => sum + item.unreadCount, 0)
  return <Link className="chat-header-action" to="/chat" state={returnTo ? { chatBack: 'history', returnTo } : undefined} aria-label={unread ? `Сообщения, непрочитанных: ${unread}` : 'Сообщения'}>
    <MessageIcon />
    {unread > 0 && <span className="chat-unread-badge" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
  </Link>
}

export function ChatThreadsNotice({ loading, error, onRetry }: { loading: boolean; error: unknown; onRetry: () => void }) {
  if (error) return <p className="error" role="alert">Не удалось загрузить переписки. <button type="button" className="link" onClick={onRetry}>Повторить</button></p>
  if (loading) return <p role="status">Загружаем переписки…</p>
  return null
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
  const backend = useOptionalDataBackend()
  if (actor?.role === 'trainer') return null
  // The public profile can finish loading before the private session restores.
  // Keep its login action available without mounting a protected chat consumer.
  if (!actor || backend === null) return <Link className={`button ${className}`} to="/auth" state={{ from: `/trainers/${publicProfileId}` }}>Войти, чтобы написать</Link>
  return <ReadyPublicTrainerChatButton publicProfileId={publicProfileId} className={className} />
}

function ReadyPublicTrainerChatButton({ publicProfileId, className }: { publicProfileId: string; className: string }) {
  const { chat } = useDataBackend()
  const navigate = useNavigate()
  const open = useMutation({ mutationFn: () => chat.openPublicTrainer(publicProfileId), onSuccess: (id) => navigate(`/chat/${id}`, { state: { chatBack: 'profile' } }) })
  return <span className="chat-start-wrap">
    <button type="button" className={className} disabled={open.isPending} onClick={() => open.mutate()}>{open.isPending ? 'Открываем…' : 'Написать тренеру'}</button>
    {open.error && <small className="error">Не удалось открыть диалог</small>}
  </span>
}
