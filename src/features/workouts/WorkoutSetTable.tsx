import type { PropsWithChildren } from 'react'
import type { InputKind } from '../../shared/domain'

type SetTableVariant = 'planned' | 'live'
type SetTableLayout = 'full' | 'singleValue'

function columnLabels(inputKind: InputKind, layout: SetTableLayout): string[] {
  if (layout === 'singleValue' && inputKind !== 'strength') {
    if (inputKind === 'duration') return ['Сек.']
    if (inputKind === 'distance') return ['Км']
    return ['Повт.']
  }
  if (inputKind === 'strength') return ['Кг', 'Повт.']
  if (inputKind === 'reps') return ['Сек.', 'Повт.']
  if (inputKind === 'duration') return ['Сек.']
  return ['Сек.', 'Км']
}

interface WorkoutSetTableProps {
  variant: SetTableVariant
  inputKind: InputKind
  showRpe: boolean
  layout?: SetTableLayout
  trailingLabel?: string
  className?: string
}

// Общая presentation-основа таблиц подходов. Она отвечает только за подписи и
// сетку колонок; ввод, факт и действия остаются в соответствующих сценариях.
export function WorkoutSetTable({ variant, inputKind, showRpe, layout = 'full', trailingLabel, className = '', children }: PropsWithChildren<WorkoutSetTableProps>) {
  const columns = columnLabels(inputKind, layout)
  return <div className={`workout-set-table ${variant}-set-table ${showRpe ? 'rpe-visible' : ''} ${className}`.trim()}>
    <div className={`workout-set-table-head ${variant}-set-table-head ${showRpe ? 'rpe-visible' : ''}`} aria-hidden="true">
      <span>№</span>
      {columns.map((column) => <span key={column}>{column}</span>)}
      {columns.length === 1 && <span />}
      {showRpe && <span>RPE</span>}
      <span>{trailingLabel}</span>
    </div>
    {children}
  </div>
}
