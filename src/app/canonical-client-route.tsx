import { useQuery } from '@tanstack/react-query'
import { Navigate, Outlet, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { clientsRepository } from '../data/repositories/clients.repository'

function RouteState({ error, retry }: { error?: Error | null; retry?: () => void }) {
  if (error) return <main className="state error"><p>{error.message}</p><button type="button" className="secondary" onClick={retry}>Повторить</button></main>
  return <main className="state">Открываем карточку клиента…</main>
}

export function CanonicalClientParamRoute() {
  const { clientId = '' } = useParams()
  const location = useLocation()
  const query = useQuery({
    queryKey: ['client-canonical-id', clientId],
    queryFn: () => clientsRepository.resolveId(clientId),
    enabled: Boolean(clientId),
  })
  if (query.isLoading) return <RouteState />
  if (query.error) return <RouteState error={query.error} retry={() => void query.refetch()} />
  if (query.data && query.data !== clientId) {
    const pathname = location.pathname.split('/').map((part) => part === clientId ? query.data : part).join('/')
    return <Navigate to={`${pathname}${location.search}${location.hash}`} replace />
  }
  return <Outlet />
}

export function CanonicalWorkoutClientRoute() {
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const clientId = searchParams.get('client') ?? ''
  const query = useQuery({
    queryKey: ['client-canonical-id', clientId],
    queryFn: () => clientsRepository.resolveId(clientId),
    enabled: Boolean(clientId),
  })
  if (!clientId) return <Outlet />
  if (query.isLoading) return <RouteState />
  if (query.error) return <RouteState error={query.error} retry={() => void query.refetch()} />
  if (query.data && query.data !== clientId) {
    const next = new URLSearchParams(searchParams)
    next.set('client', query.data)
    return <Navigate to={`${location.pathname}?${next.toString()}${location.hash}`} replace />
  }
  return <Outlet />
}
