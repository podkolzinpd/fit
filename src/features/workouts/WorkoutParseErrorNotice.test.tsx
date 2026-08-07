import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkoutParseErrorNotice, workoutParseErrorKind } from './WorkoutParseErrorNotice'

describe('WorkoutParseErrorNotice', () => {
  it('distinguishes a network failure and retries without removing the composer', async () => {
    const retry = vi.fn()
    const user = userEvent.setup()
    render(<WorkoutParseErrorNotice kind={workoutParseErrorKind(new TypeError('Failed to fetch'))} onRetry={retry} />)

    expect(screen.getByRole('alert')).toHaveTextContent('Нет соединения')
    await user.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(retry).toHaveBeenCalledOnce()
  })

  it('explains an unrecognized text without offering a meaningless retry', () => {
    render(<WorkoutParseErrorNotice kind="unrecognized" onRetry={vi.fn()} />)

    expect(screen.getByRole('alert')).toHaveTextContent('Допишите название точнее')
    expect(screen.queryByRole('button', { name: 'Повторить' })).not.toBeInTheDocument()
  })

  it('does not call a service interruption a network failure', () => {
    render(<WorkoutParseErrorNotice kind={workoutParseErrorKind(new Error('Service unavailable'))} onRetry={vi.fn()} />)

    expect(screen.getByRole('alert')).toHaveTextContent('Разбор временно недоступен')
  })
})
