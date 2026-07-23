import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type PropsWithChildren } from 'react'
import { queryRetryDelay, shouldRetryQuery } from './query-retry-policy'

export function QueryProvider({ children }: PropsWithChildren) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 20_000,
        retry: shouldRetryQuery,
        retryDelay: queryRetryDelay,
      },
    },
  }))
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
