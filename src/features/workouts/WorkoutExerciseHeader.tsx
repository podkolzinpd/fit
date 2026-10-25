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
  summary?: ReactNode
  description?: ReactNode
  onTitleClick?: () => void
  titleActionLabel?: string
  titleExpanded?: boolean
  showTechniqueLabel?: boolean
}

// Общий каркас шапки упражнения. Содержимое действий и бизнес-логика остаются
// в конкретном сценарии, поэтому эта основа не меняет поведение карточек.
export function WorkoutExerciseHeader({ name, className, as: Container = 'div', titleAs: Title = 'h2', leading, actions, summary, description, onTitleClick, titleActionLabel, titleExpanded, showTechniqueLabel = true }: WorkoutExerciseHeaderProps) {
  const title = onTitleClick
    ? <button type="button" className="exercise-technique-trigger" aria-label={titleActionLabel ?? `Посмотреть технику: ${name}`} aria-expanded={titleExpanded} onClick={event => { if (titleExpanded !== undefined) event.currentTarget.focus({ preventScroll: true }); onTitleClick() }}><Title>{name}</Title>{showTechniqueLabel && <span>Техника</span>}</button>
    : <Title>{name}</Title>
  const copy = description ? <span className="workout-exercise-header-copy">{title}{description}</span> : title
  return <Container className={className}>
    {leading ? <span className="workout-exercise-header-main">{leading}{copy}</span> : copy}
    {actions && <span className="exercise-head-actions">{actions}</span>}
    {summary && <p className="workout-exercise-header-summary">{summary}</p>}
  </Container>
}
