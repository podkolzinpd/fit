import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import type { Workout } from '../../shared/domain'
import { FavoriteWorkoutNameSheet } from './FavoriteWorkoutNameSheet'

export function WorkoutRenameSheet({ workout, lime, onSave, onReload, onClose }: {
  workout: Workout; lime: boolean
  onSave: (title: string, expectedVersion: number) => Promise<void>
  onReload: () => Promise<Workout>; onClose: () => void
}) {
  const [version, setVersion] = useState(workout.version)
  const [needsReload, setNeedsReload] = useState(false)
  const [currentTitle, setCurrentTitle] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: (title: string) => onSave(title, version),
    onSuccess: onClose,
    onError: () => setNeedsReload(true),
  })
  const reload = useMutation({
    mutationFn: onReload,
    onSuccess: fresh => { setVersion(fresh.version); setCurrentTitle(fresh.title?.trim() || 'Тренировка'); setNeedsReload(false); save.reset() },
  })
  return <FavoriteWorkoutNameSheet heading="Переименовать тренировку" lime={lime} initialTitle={workout.title ?? ''}
    pending={save.isPending || reload.isPending} error={reload.error ?? save.error}
    recovery={needsReload ? <div><p>Название не сохранено. Перечитайте тренировку перед повторной попыткой.</p><button type="button" className="secondary" disabled={reload.isPending} onClick={() => reload.mutate()}>Перечитать тренировку</button></div>
      : undefined}
    notice={currentTitle ? <p role="status">Сейчас сохранено: {currentTitle}. Проверьте название и нажмите «Сохранить».</p> : undefined}
    onSave={title => save.mutate(title)} onClose={onClose} />
}
