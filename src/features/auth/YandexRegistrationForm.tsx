import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ClientLimeStandaloneLayout } from '../../app/ClientLimeStandaloneLayout'
import { FitLogo } from '../../shared/FitLogo'
import { BackIcon, CheckIcon } from '../../shared/icons'
import { Field } from '../../shared/ui'
import type { AccountRole } from '../../shared/domain'
import { LEGAL_PATHS } from '../../shared/legal'

export function YandexRegistrationForm({ role, onRoleChange, invitationRequiresClient, firstName, onNameChange, busy, error, onSubmit, onBack }: {
  role: AccountRole
  onRoleChange: (role: AccountRole) => void
  invitationRequiresClient: boolean
  firstName: string
  onNameChange: (name: string) => void
  busy: boolean
  error: string | null
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onBack: () => void
}) {
  return <ClientLimeStandaloneLayout registration>
    <main className="lime-registration" aria-label="Регистрация">
      <header className="lime-registration-header">
        <button className="page-back" type="button" aria-label="Назад" disabled={busy} onClick={onBack}><BackIcon /></button>
        <FitLogo />
      </header>
      <img className="lime-registration-photo" src="/assets/startup-photo-983c93dc4df8.jpg" width={940} height={1673} alt="" aria-hidden="true" onError={(event) => { event.currentTarget.hidden = true }} />
      <form className="lime-registration-form" onSubmit={onSubmit}>
        <p className="lime-registration-verified"><CheckIcon />Yandex ID подтверждён</p>
        <fieldset className="lime-registration-roles" disabled={busy}>
          <legend>Как вы будете пользоваться ФИТ?</legend>
          <div className="lime-registration-role-options">
            {(['client', 'trainer'] as const).map((value) => <label key={value} className="lime-registration-role">
              <input type="radio" name="accountRole" value={value} checked={role === value} disabled={invitationRequiresClient && value === 'trainer'} onChange={() => onRoleChange(value)} />
              <span>{value === 'client' ? 'Я спортсмен' : 'Я тренер'}</span>
            </label>)}
          </div>
        </fieldset>
        <Field label="Имя"><input name="firstName" minLength={2} maxLength={120} autoComplete="given-name" required disabled={busy} value={firstName} onChange={(event) => onNameChange(event.target.value)} /></Field>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={busy} aria-busy={busy}>{busy ? 'Создаём…' : 'Создать аккаунт'}</button>
        <p className="lime-registration-consent">Создавая аккаунт, вы принимаете <Link to={LEGAL_PATHS.terms}>Условия использования</Link> и <Link to={LEGAL_PATHS.privacy}>Политику конфиденциальности</Link>.</p>
      </form>
    </main>
  </ClientLimeStandaloneLayout>
}
