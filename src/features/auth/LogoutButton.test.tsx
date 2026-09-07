import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LogoutButton } from './LogoutButton'

const auth = vi.hoisted(() => ({ signOut: vi.fn() }))

vi.mock('../../app/auth-context', () => ({
  useAuth: () => ({ signOut: auth.signOut }),
}))

function renderButton() {
  return render(
    <MemoryRouter initialEntries={['/profile']}>
      <Routes>
        <Route path="/profile" element={<LogoutButton />} />
        <Route path="/auth" element={<p>Экран входа</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('LogoutButton', () => {
  beforeEach(() => {
    auth.signOut.mockReset().mockResolvedValue(undefined)
  })

  it('переходит на вход только после успешного выхода', async () => {
    renderButton()

    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }))

    expect(await screen.findByText('Экран входа')).toBeVisible()
  })

  it('показывает ошибку и разрешает повторить выход', async () => {
    auth.signOut.mockRejectedValue(new Error('Не удалось выйти. Проверьте интернет и попробуйте ещё раз.'))
    renderButton()

    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось выйти')
    expect(screen.getByRole('button', { name: 'Выйти' })).toBeEnabled()
    expect(screen.queryByText('Экран входа')).not.toBeInTheDocument()
  })

  it('блокирует повторное нажатие, пока выход выполняется', async () => {
    let resolveSignOut: (() => void) | undefined
    auth.signOut.mockImplementation(() => new Promise<void>((resolve) => { resolveSignOut = resolve }))
    renderButton()

    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }))

    expect(screen.getByRole('button', { name: 'Выходим…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Выходим…' })).toHaveAttribute('aria-busy', 'true')
    resolveSignOut?.()
    await waitFor(() => expect(screen.getByText('Экран входа')).toBeVisible())
  })
})
