import { useHasUnsavedPreferences } from '../../app/preference-storage'

export function PreferenceStorageNotice({ keys }: { keys: readonly (string | undefined)[] }) {
  const unsaved = useHasUnsavedPreferences(keys)
  return unsaved ? <p className="muted" role="status">Не удалось сохранить на устройстве. После перезагрузки выбор может сброситься.</p> : null
}
