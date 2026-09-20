import type { ReactNode } from 'react'

type HeaderElement = 'div' | 'header'
type TitleElement = 'strong' | 'h2' | 'h3'

interface WorkoutExerciseHeaderProps {
  name: string
  className: string
  as?: HeaderElement
  titleAs?: TitleElement
  leading?: ReactNode
  actions?: ReactNode
  onTitleClick?: () => void
  showTechniqueLabel?: boolean
}

// Общий каркас шапки упражнения. Содержимое действий и бизнес-логика остаются
// в конкретном сценарии, поэтому эта основа не меняет поведение карточек.
export function WorkoutExerciseHeader({ name, className, as: Container = 'div', titleAs: Title = 'h2', leading, actions, onTitleClick, showTechniqueLabel = true }: WorkoutExerciseHeaderProps) {
  const title = onTitleClick
    ? <button type="button" className="exercise-technique-trigger" aria-label={`Посмотреть технику: ${name}`} onClick={onTitleClick}><Title>{name}</Title>{showTechniqueLabel && <span>Техника</span>}</button>
    : <Title>{name}</Title>
  return <Container className={className}>
    {leading ? <span className="workout-exercise-header-main">{leading}{title}</span> : title}
    {actions && <span className="exercise-head-actions">{actions}</span>}
  </Container>
}
