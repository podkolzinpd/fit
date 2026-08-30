import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppErrorBoundary } from './error-boundary'

function ThrowsOnce({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('render failed')
  return <p>Экран восстановлен</p>
}

describe('AppErrorBoundary', () => {
  it('заменяет render error на безопасный экран и позволяет повторить', () => {
    const { rerender } = render(<AppErrorBoundary><ThrowsOnce shouldThrow /></AppErrorBoundary>)
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось открыть экран')
    expect(screen.getByRole('alert')).toHaveClass('identity-monochrome-preview', 'system-state-identity')
    expect(screen.queryByText('render failed')).toBeNull()

    rerender(<AppErrorBoundary><ThrowsOnce shouldThrow={false} /></AppErrorBoundary>)
    fireEvent.click(screen.getByRole('button', { name: 'Попробовать снова' }))
    expect(screen.getByText('Экран восстановлен')).toBeVisible()
  })

  it('даёт явное действие полного восстановления', () => {
    const reload = vi.fn()
    render(<AppErrorBoundary onReload={reload}><ThrowsOnce shouldThrow /></AppErrorBoundary>)
    fireEvent.click(screen.getByRole('button', { name: 'Обновить приложение' }))
    expect(reload).toHaveBeenCalledOnce()
  })
})
