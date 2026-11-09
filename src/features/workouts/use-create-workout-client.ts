import { useQueryClient } from '@tanstack/react-query'
import { useDataBackend } from '../../app/data-backend-context'
import type { ClientPickerSelection } from '../clients/ClientPicker'

/** Reuses the client-card command and refreshes the picker after either outcome. */
export function useCreateWorkoutClient() {
  const { clients } = useDataBackend()
  const queryClient = useQueryClient()
  return async (fullName: string): Promise<ClientPickerSelection> => {
    try {
      const id = await clients.createQuick(fullName)
      return { id, fullName }
    } finally {
      await queryClient.invalidateQueries({ queryKey: ['clients'] })
    }
  }
}
