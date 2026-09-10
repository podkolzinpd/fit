import type { ReactNode } from 'react'
import type { TrainerProfileDraft } from '../../shared/domain'
import { ChevronDownIcon } from '../../shared/icons'

function experienceLabel(startYear: number | null): string | null {
  if (startYear === null) return null
  const experience = Math.max(0, new Date().getFullYear() - startYear)
  if (experience === 0) return 'Меньше года'
  const suffix = experience % 10 === 1 && experience % 100 !== 11
    ? 'год'
    : experience % 10 >= 2 && experience % 10 <= 4 && (experience % 100 < 10 || experience % 100 >= 20)
      ? 'года'
      : 'лет'
  return `${experience} ${suffix}`
}

function Certificates({ profile }: { profile: TrainerProfileDraft }) {
  return <ul className="trainer-certificates">
    {profile.certificates.map((item, index) => <li key={`${item.title}-${index}`}><strong>{item.title}</strong>{item.organization && <span>{item.organization}</span>}{item.year && <span>{item.year}</span>}</li>)}
  </ul>
}

export function TrainerProfileCard({ profile, publicView = false, compact = false, action, footer }: {
  profile: TrainerProfileDraft
  publicView?: boolean
  compact?: boolean
  action?: ReactNode
  footer?: ReactNode
}) {
  const experience = experienceLabel(profile.experienceStartYear)
  const certificateCount = profile.certificates.length
  return <article className={`trainer-card${publicView ? ' trainer-card-public' : ''}${compact ? ' trainer-card-compact' : ''}`}>
    <header className="trainer-card-head">
      {profile.avatarDataUrl
        ? <img src={profile.avatarDataUrl} alt="" className="trainer-card-avatar" />
        : <span className="trainer-card-avatar trainer-card-avatar-placeholder" aria-hidden="true">{profile.displayName.slice(0, 1).toUpperCase() || 'Ф'}</span>}
      <div className="trainer-card-identity"><h2>{profile.displayName || 'Имя тренера'}</h2>
        <p>{profile.acceptingClients ? 'Берёт новых клиентов' : 'Сейчас без новых клиентов'}</p></div>
      {action && <div className="trainer-card-action">{action}</div>}
    </header>
    {profile.specialties.length > 0 && <ul className="trainer-specialties" aria-label="Направления">
      {profile.specialties.map((item) => <li key={item}>{item}</li>)}
    </ul>}
    {compact
      ? profile.bio && <details className="trainer-card-disclosure"><summary><span>Подробнее о тренере</span><ChevronDownIcon /></summary><p className="trainer-card-bio">{profile.bio}</p></details>
      : profile.bio && <p className="trainer-card-bio">{profile.bio}</p>}
    <dl className="trainer-card-facts">
      {profile.trainingModes.length > 0 && <div><dt>Формат</dt><dd>{profile.trainingModes.map((mode) => mode === 'online' ? 'Онлайн' : 'Лично').join(' · ')}</dd></div>}
      {profile.city && <div><dt>Город</dt><dd>{profile.city}</dd></div>}
      {experience !== null && <div><dt>Опыт</dt><dd>{experience}</dd></div>}
      {profile.price && <div><dt>Стоимость</dt><dd>{profile.price}</dd></div>}
    </dl>
    {compact
      ? profile.formats && <details className="trainer-card-disclosure"><summary><span>Как проходят занятия</span><ChevronDownIcon /></summary><p>{profile.formats}</p></details>
      : profile.formats && <section><h3>Как проходят занятия</h3><p>{profile.formats}</p></section>}
    {compact
      ? (profile.education || certificateCount > 0) && <details className="trainer-card-disclosure"><summary><span>Образование и сертификаты{certificateCount > 0 ? ` · ${certificateCount}` : ''}</span><ChevronDownIcon /></summary>{profile.education && <p>{profile.education}</p>}{certificateCount > 0 && <Certificates profile={profile} />}</details>
      : <>{profile.education && <section><h3>Образование</h3><p>{profile.education}</p></section>}{certificateCount > 0 && <section><h3>Сертификаты</h3><Certificates profile={profile} /></section>}</>}
    {footer}
  </article>
}
