import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthPage, ForgotPasswordPage, ResetPasswordPage } from './AuthPages'
import { readPendingInvitation, savePendingInvitation } from './invitation-auth'

const signIn = vi.hoisted(() => vi.fn())
const resetPassword = vi.hoisted(() => vi.fn())
const updatePassword = vi.hoisted(() => vi.fn())
vi.mock('../../data/repositories/auth.repository', () => ({
  authRepository: {
    resetPassword,
    signIn,
    signUp: vi.fn(),
    updatePassword,
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
    resetPassword.mockReset().mockResolvedValue(undefined)
    updatePassword.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    sessionStorage.clear()
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

  it('сохраняет email первым действием, когда Yandex app-session выключена', () => {
    vi.stubEnv('VITE_YANDEX_APP_SESSION_ENABLED', '')
    render(<MemoryRouter><AuthPage /></MemoryRouter>)

    expect(screen.getByRole('button', { name: /^Войти$/ })).toHaveClass('primary')
    expect(screen.queryByRole('button', { name: 'Продолжить с Yandex ID' })).not.toBeInTheDocument()
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

  it('возвращает к защищённому приглашению после смены пароля', async () => {
    const user = userEvent.setup()
    const token = `AB12CD34EF56.${'a'.repeat(64)}`
    savePendingInvitation(`/invite?token=${token}`)
    render(<MemoryRouter initialEntries={['/auth/reset']}>
      <Routes>
        <Route path="/auth/reset" element={<ResetPasswordPage />} />
        <Route path="/invite" element={<p>invitation route</p>} />
      </Routes>
    </MemoryRouter>)

    await user.type(screen.getByLabelText('Пароль'), 'FitLocal123!')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(await screen.findByText('invitation route')).toBeVisible()
    expect(readPendingInvitation()).toBeNull()
  })

  it('сохраняет приглашение при возврате с восстановления пароля', async () => {
    const user = userEvent.setup()
    const token = `AB12CD34EF56.${'a'.repeat(64)}`
    savePendingInvitation(`/invite?token=${token}`)
    function StateProbe() {
      return <p>{JSON.stringify(useLocation().state)}</p>
    }
    render(<MemoryRouter initialEntries={['/auth/forgot']}>
      <Routes>
        <Route path="/auth/forgot" element={<ForgotPasswordPage />} />
        <Route path="/auth" element={<StateProbe />} />
      </Routes>
    </MemoryRouter>)

    await user.click(screen.getByRole('link', { name: 'Вернуться ко входу' }))

    expect(await screen.findByText(new RegExp(`invite\\?token=${token}`))).toBeVisible()
  })
})
