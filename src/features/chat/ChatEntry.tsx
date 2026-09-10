import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { useDataBackend } from '../../app/data-backend-context'
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
  const open = useMutation({ mutationFn: () => chat.open(clientId, trainerId), onSuccess: (id) => navigate(`/chat/${id}`) })
  return <span className="chat-start-wrap">
    <button type="button" className={className} disabled={open.isPending} onClick={() => open.mutate()}>{open.isPending ? 'Открываем…' : 'Написать'}</button>
    {open.error && <small className="error">Не удалось открыть чат</small>}
  </span>
}
