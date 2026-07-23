interface LoadMoreButtonProps {
  hasMore: boolean
  loading: boolean
  onLoadMore: () => void
}

export function LoadMoreButton({ hasMore, loading, onLoadMore }: LoadMoreButtonProps) {
  if (!hasMore) return null
  return <button className="wide secondary" disabled={loading} onClick={onLoadMore}>
    {loading ? 'Загружаем…' : 'Показать ещё'}
  </button>
}
