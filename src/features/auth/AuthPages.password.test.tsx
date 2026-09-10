import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthPage } from './AuthPages'

const signIn = vi.hoisted(() => vi.fn())
vi.mock('../../data/repositories/auth.repository', () => ({
  authRepository: {
    signIn,
    signUp: vi.fn(),
  },
}))

vi.mock('../../app/auth-context', () => ({
  useAuth: () => ({ actor: null, loading: false, error: null }),
}))

vi.mock('../../app/yandex-app-session-context', () => ({
  useYandexAppSession: () => ({
    session: null,
    loading: false,
    error: null,
    retry: vi.fn(),
  }),
}))

describe('AuthPage password sign-in', () => {
  beforeEach(() => {
    signIn.mockReset()
  })

  it('после сетевой ошибки снова включает кнопку и показывает понятное сообщение', async () => {
    const user = userEvent.setup()
    signIn.mockRejectedValue(new Error('Не удалось войти. Проверьте интернет и попробуйте ещё раз.'))
    render(<MemoryRouter><AuthPage /></MemoryRouter>)

    await user.type(screen.getByLabelText('Email'), 'client@example.test')
    await user.type(screen.getByLabelText('Пароль'), 'FitLocal123!')
    await user.click(screen.getByRole('button', { name: /^Войти$/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось войти. Проверьте интернет и попробуйте ещё раз.')
    expect(screen.getByRole('button', { name: /^Войти$/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /^Войти$/ })).toHaveAttribute('aria-busy', 'false')
  })

  it('не предлагает Google ни для входа, ни для регистрации', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><AuthPage /></MemoryRouter>)

    expect(screen.queryByRole('button', { name: /Google/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Создать аккаунт' }))
    expect(screen.queryByRole('button', { name: /Google/ })).not.toBeInTheDocument()
    expect(screen.getByText(/Создавая аккаунт, вы принимаете/)).toBeVisible()
    expect(screen.getAllByRole('link', { name: 'Условия использования' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: /Политик|Конфиденциальность/ }).length).toBeGreaterThan(0)
  })
})
