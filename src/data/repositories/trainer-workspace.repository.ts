import type { TrainerWorkspace } from '../../shared/domain'

export const trainerWorkspaceRepository = {
  read(): Promise<TrainerWorkspace> {
    return Promise.reject(new Error('Рабочая сводка тренера недоступна для этого источника данных.'))
  },
}
