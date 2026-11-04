import type { ComponentProps } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useDataBackend } from '../../app/data-backend-context'
import { FitLimeDatePicker } from '../../shared/FitLimeDatePicker'
import { workoutDateMarks } from './workout-date-marks'

/** The workout feature owns the read; the shared calendar only renders marks. */
export function WorkoutDatePicker({ clientId, excludeWorkoutId, ...props }: Omit<ComponentProps<typeof FitLimeDatePicker>, 'dayMarks'> & { clientId?: string; excludeWorkoutId?: string }) {
  const { workouts } = useDataBackend()
  const schedule = useQuery({ queryKey: ['workouts', 'date-marks', clientId],
    queryFn: () => workouts.list(undefined, undefined, clientId), enabled: Boolean(clientId) })
  return <FitLimeDatePicker {...props} dayMarks={clientId ? workoutDateMarks(schedule.data ?? [], clientId, excludeWorkoutId) : undefined} />
}
