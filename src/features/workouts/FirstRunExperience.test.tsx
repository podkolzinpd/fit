import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ClientFirstRunIntro, TrainerFirstPlanPrompt, TrainerFirstRun } from './FirstRunExperience'

describe('first-run experience', () => {
  it('gives an athlete one useful promise and keeps the workout action', () => {
    render(<MemoryRouter><ClientFirstRunIntro actions={<button>Надиктовать тренировку</button>} /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Тренируйтесь и следите за прогрессом' })).toBeVisible()
    expect(screen.getByText('изменения в упражнениях')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Надиктовать тренировку' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Подключиться по приглашению' })).toHaveAttribute('href', '/join')
  })

  it('creates the first trainer client from a single name field', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined)
    render(<TrainerFirstRun creating={false} error={null} onCreate={onCreate} />)
    fireEvent.change(screen.getByLabelText('Имя клиента'), { target: { value: ' Антон ' } })
    const create = screen.getByRole('button', { name: 'Добавить первого клиента' })
    expect(create).toHaveClass('primary')
    fireEvent.click(create)
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('Антон'))
  })

  it('connects the first client to the next plan step', () => {
    render(<TrainerFirstPlanPrompt clientName="Антон" />)
    expect(screen.getByRole('heading', { name: 'Первая тренировка: Антон' })).toBeVisible()
    expect(screen.getByText(/Надиктуйте тренировку/)).toBeVisible()
  })
})
