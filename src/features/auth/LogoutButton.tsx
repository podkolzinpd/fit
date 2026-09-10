import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'

export function LogoutButton() {
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function logout() {
    setPending(true)
    setError(null)
    void signOut().then(
      () => navigate('/auth'),
      (caught: unknown) => {
        setError(caught instanceof Error ? caught.message : 'Не удалось выйти. Попробуйте ещё раз.')
        setPending(false)
      },
    )
  }

  return <>
    {error && <p className="error" role="alert">{error}</p>}
    <button
      type="button"
      className="danger secondary wide"
      disabled={pending}
      aria-busy={pending}
      onClick={logout}
    >
      {pending ? 'Выходим…' : 'Выйти'}
    </button>
  </>
}
