import type { ExerciseSnapshot } from '../../shared/domain'
import type { WorkoutParseErrorKind } from './WorkoutParseErrorNotice'

export type ChatMessage =
  | { id: string; kind: 'user'; text: string; itemIds: string[] }
  /** Упражнения, добавленные вручную из каталога («+» → «Добавить упражнение») — без текстового пузыря, только карточки. */
  | { id: string; kind: 'manual'; itemIds: string[] }
  | { id: string; kind: 'thinking' }
  | { id: string; kind: 'clarification'; line: string; candidates: ExerciseSnapshot[] }
  | { id: string; kind: 'error'; error: WorkoutParseErrorKind; sourceText: string }
