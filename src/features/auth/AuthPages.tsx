import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { authRepository } from '../../data/repositories/auth.repository'
import { useAuth } from '../../app/auth-context'
import { Field } from '../../shared/ui'

type Mode = 'login' | 'register'

export function AuthPage() {
  const [mode, setMode] = useState<Mode>('login')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { actor } = useAuth()
  const location = useLocation()
  if (actor) return <Navigate to={(location.state as { from?: string } | null)?.from ?? (actor.kind === 'client' ? '/me/progress' : '/clients')} replace />

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null)
    const values = new FormData(event.currentTarget)
    try {
      if (mode === 'login') await authRepository.signIn(String(values.get('email')), String(values.get('password')))
      else {
        await authRepository.signUp(String(values.get('email')), String(values.get('password')), String(values.get('firstName')))
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось войти') }
    finally { setBusy(false) }
  }

  return <main className="auth-screen">
    <div className="brand">FIT</div><h1>{mode === 'login' ? 'Вход' : 'Регистрация тренера'}</h1>
    <p className="muted">{mode === 'login' ? 'Для тренеров и приглашённых клиентов.' : 'Планируйте тренировки и следите за прогрессом клиентов.'}</p>
    <form className="stack" onSubmit={(event) => void submit(event)}>
      {mode === 'register' && <Field label="Имя"><input name="firstName" autoComplete="given-name" required /></Field>}
      <Field label="Email"><input name="email" type="email" autoComplete="email" required /></Field>
      <Field label="Пароль"><input name="password" type="password" minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required /></Field>
      {error && <p className="error" role="alert">{error}</p>}
      <button disabled={busy}>{busy ? 'Подождите…' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}</button>
    </form>
    <button className="secondary" onClick={() => void authRepository.signInWithGoogle()}>Продолжить с Google</button>
    <div className="auth-links"><button className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'Создать аккаунт тренера' : 'У меня есть аккаунт'}</button>{mode === 'login' && <Link to="/auth/forgot">Забыли пароль?</Link>}</div>
  </main>
}

export function ForgotPasswordPage() {
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null)
    try { await authRepository.resetPassword(String(new FormData(event.currentTarget).get('email'))); setMessage('Ссылка отправлена, если такой аккаунт существует.') }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Ошибка') }
  }
  return <main className="auth-screen"><h1>Восстановление пароля</h1><form className="stack" onSubmit={(e) => void submit(e)}><Field label="Email"><input name="email" type="email" required /></Field>{error && <p className="error">{error}</p>}{message && <p className="success">{message}</p>}<button>Отправить ссылку</button></form><Link to="/auth">Вернуться ко входу</Link></main>
}

export function ResetPasswordPage() {
  const navigate = useNavigate(); const { actor } = useAuth(); const [error, setError] = useState<string | null>(null)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try { await authRepository.updatePassword(String(new FormData(event.currentTarget).get('password'))); navigate(actor?.kind === 'client' ? '/me/progress' : '/clients') }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Ошибка') }
  }
  return <main className="auth-screen"><h1>Новый пароль</h1><form className="stack" onSubmit={(e) => void submit(e)}><Field label="Пароль"><input name="password" type="password" minLength={8} required /></Field>{error && <p className="error">{error}</p>}<button>Сохранить</button></form></main>
}

export function AuthCallbackPage() {
  const { loading, error, actor } = useAuth()
  if (actor) return <Navigate to={actor.kind === 'client' ? '/me/progress' : '/clients'} replace />
  return <main className="auth-screen"><h1>Завершаем вход</h1><p>{loading ? 'Проверяем сессию…' : error ?? 'Не удалось получить сессию.'}</p><Link to="/auth">Вернуться</Link></main>
}
