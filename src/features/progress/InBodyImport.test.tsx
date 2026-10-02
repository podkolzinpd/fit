import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { InBodyImport } from './InBodyImport'
import { localDate } from '../../shared/local-date'

describe('InBodyImport', () => {
  it('shows a review summary and requires an explicit apply action', async () => {
    const apply = vi.fn()
    render(<InBodyImport busy={false} error={null} result={{
      recordedOn: localDate('2026-10-02'), weightKg: 59.1,
      inBody: { schemaVersion: 1, skeletalMuscleMassKg: 22.4, bodyFatPercent: 21 },
      recognizedFieldCount: 4, warnings: [],
    }} onRecognize={vi.fn()} onApply={apply} onReset={vi.fn()} />)
    expect(screen.getByText('вес 59.1 кг · мышцы 22.4 кг · жир 21%')).toBeInTheDocument()
    expect(apply).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Проверить и сохранить' }))
    expect(apply).toHaveBeenCalledOnce()
  })

  it('opens the native image picker without forcing the camera', () => {
    const { container } = render(<InBodyImport busy={false} error={null} result={null} onRecognize={vi.fn()} onApply={vi.fn()} onReset={vi.fn()} />)
    const input = container.querySelector('input[type="file"]')
    expect(input).toHaveAttribute('hidden')
    expect(input).toHaveAttribute('accept', 'image/*')
    expect(input).not.toHaveAttribute('capture')
  })
})
