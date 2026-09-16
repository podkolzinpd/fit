import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useDataBackend } from '../../app/data-backend-context'

const CHAT_THREADS_QUERY_KEY = ['chat-threads'] as const

export function useChatThreads() {
  const { chat } = useDataBackend()
  const query = useQuery({
    queryKey: CHAT_THREADS_QUERY_KEY,
    queryFn: () => chat.listThreads(),
    refetchInterval: 5_000,
    refetchOnMount: 'always',
  })

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') void query.refetch()
    }
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('pageshow', refresh)
    window.addEventListener('online', refresh)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('pageshow', refresh)
      window.removeEventListener('online', refresh)
    }
  }, [query.refetch])

  return query
}
