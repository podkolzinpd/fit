import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { ClientFirstRunIntro, TrainerFirstPlanPrompt, TrainerFirstRun } from './FirstRunExperience'

describe('first-run experience', () => {
  it('gives an athlete one useful promise and keeps the workout action', () => {
    render(<MemoryRouter><ClientFirstRunIntro actions={<button>Надиктовать тренировку</button>} /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Тренируйтесь и следите за прогрессом' })).toBeVisible()
    expect(screen.getByText('изменения в упражнениях')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Надиктовать тренировку' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Подключиться по приглашению' })).toHaveAttribute('href', '/join')
  })

  it('starts with account connection instead of creating a placeholder client', () => {
    render(<MemoryRouter><TrainerFirstRun /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Подключить первого спортсмена' })).toHaveAttribute('href', '/connect')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByText(/После его согласия/)).toBeVisible()
  })

  it('connects the first client to the next plan step', () => {
    render(<TrainerFirstPlanPrompt clientName="Антон" />)
    expect(screen.getByRole('heading', { name: 'Первая тренировка: Антон' })).toBeVisible()
    expect(screen.getByText(/Надиктуйте тренировку/)).toBeVisible()
  })
})
