import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { TrainerFinanceOverview, TrainerFinanceOverviewClient } from '../../data/contracts/trainer-finance'
import { FinanceMonthlySummary } from './FinanceMonthlySummary'
import { financeChartSegments, financeClientColor, financeMoney } from './finance-monthly'

const client = (id: string, receivedCents: number, completedSessions: number): TrainerFinanceOverviewClient => ({
  clientId: id, fullName: `Спортсмен ${id}`, archivedAt: null, receivedCents, completedSessions,
  dueCents: 0, nearestPaymentDueOn: null, unpaidPackageCount: 0, activePackageCount: 0,
  upcomingPackageCount: 0, sessionsRemaining: null, overdue: false, lowSessions: false,
  unassignedSessions: 0, needsAttention: false,
})
const data: TrainerFinanceOverview = { month: '2026-11', receivedCents: 30003, completedSessions: 3,
  dueCents: 0, attentionCount: 0, clients: [client('a',10001,1),client('b',20002,2)] }

describe('monthly finance readout', () => {
  it('uses the compact metric menu without dropping totals or changing personal composition', async () => {
    const change = vi.fn()
    const { container, rerender } = render(<FinanceMonthlySummary data={data} metric="money" onMetricChange={change} compact />)
    expect(container.querySelector('.finance-monthly-compact')).not.toBeNull()
    expect(container.querySelector('.finance-monthly-companion')).toBeNull()
    expect(container.querySelector('[data-finance-monthly-total]')?.textContent).toBe(financeMoney(30003))
    expect(screen.getByText('3 тренировки')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Показатель итогов: Поступления' }))
    await userEvent.click(screen.getByRole('menuitem', { name: /^Тренировки$/ }))
    expect(change).toHaveBeenLastCalledWith('sessions')
    rerender(<FinanceMonthlySummary data={data} metric="money" onMetricChange={change} clientId="b" compact />)
    expect(container.querySelector('.finance-monthly-compact')).toBeNull()
    expect(container.querySelector('.finance-monthly-center')).not.toBeNull()
  })
  it('keeps exact cents, companion total and local metric control without percentages', async () => {
    const change = vi.fn()
    const { container } = render(<FinanceMonthlySummary data={data} metric="money" onMetricChange={change} />)
    expect(screen.getByRole('img')).toHaveAccessibleName(/300,03/)
    expect(container.querySelector('[data-finance-monthly-total]')?.textContent).toBe(financeMoney(30003))
    expect(container.querySelector('.finance-monthly-companion')).toHaveTextContent('3')
    expect(container.textContent).not.toContain('%')
    await userEvent.click(screen.getByRole('button', { name: 'Тренировки' }))
    expect(change).toHaveBeenCalledWith('sessions')
    await userEvent.click(screen.getByRole('button', { name: 'Поступления' }))
    expect(change).toHaveBeenLastCalledWith('money')
  })
  it('uses completed sessions independently of received money', () => {
    const { container } = render(<FinanceMonthlySummary data={data} metric="sessions" onMetricChange={vi.fn()} />)
    expect(screen.getByRole('img')).toHaveAccessibleName('Проведено: 3')
    expect(container.querySelector('.finance-monthly-companion strong')?.textContent).toBe(financeMoney(30003))
  })
  it.each(['money','sessions'] as const)('renders a zero %s period without phantom segments', metric => {
    const { container } = render(<FinanceMonthlySummary data={{...data,receivedCents:0,completedSessions:0,clients:[]}} metric={metric} onMetricChange={vi.fn()} />)
    expect(container.querySelectorAll('circle')).toHaveLength(1)
    expect(screen.getByText(metric === 'money' ? 'Поступлений за месяц нет' : 'Проведённых занятий за месяц нет')).toBeVisible()
  })
  it('groups the tail without dropping its value or attaching percentages', () => {
    const clients = Array.from({ length: 8 }, (_,i) => client(String(i),i+1,i+1))
    const segments = financeChartSegments(clients,'money')
    expect(segments).toHaveLength(5)
    expect(segments[4]).toMatchObject({ label:'Остальные',value:10 })
    expect(segments.reduce((sum,item) => sum+item.value,0)).toBe(36)
    render(<FinanceMonthlySummary data={{...data,clients,receivedCents:36,completedSessions:36}} metric="money" onMetricChange={vi.fn()} />)
    expect(screen.getByText(/Остальные:/, { selector: 'p' })).toBeVisible()
    expect(financeChartSegments([client('zero',0,0)],'money')).toEqual([])
    expect(financeClientColor('a')).toBe(financeClientColor('a'))
  })
  it.each(['money','sessions'] as const)('shows a personal %s contribution with the same overall denominator', metric => {
    const { container } = render(<FinanceMonthlySummary data={data} metric={metric} clientId="b" onMetricChange={vi.fn()} />)
    expect(container.querySelector('[data-finance-monthly-total]')?.textContent).toBe(metric === 'money'?financeMoney(20002):'2')
    expect(container.textContent).not.toContain('%')
    expect(container.querySelectorAll('circle')).toHaveLength(3)
    expect(within(screen.getByRole('group')).getByRole('button',{name:metric==='money'?'Поступления':'Тренировки'})).toHaveAttribute('aria-pressed','true')
  })
  it('shows no personal value for an absent athlete without reusing global totals', () => {
    const { container } = render(<FinanceMonthlySummary data={data} metric="money" clientId="missing" onMetricChange={vi.fn()} />)
    expect(container.querySelector('[data-finance-monthly-total]')?.textContent).toBe(financeMoney(0))
  })
})


it('preserves every kopeck at the safe integer boundary of the read model', () => {
  expect(financeMoney(Number.MAX_SAFE_INTEGER)).toMatch(/^90\s071\s992\s547\s409,91\s₽$/)
})
