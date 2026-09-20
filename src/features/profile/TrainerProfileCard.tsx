import type { ReactNode } from 'react'
import type { TrainerProfileDraft } from '../../shared/domain'
import { ChevronDownIcon } from '../../shared/icons'
import { moscowMetroStationById } from '../../shared/moscow-metro'
import { MetroStationList } from './MetroStationPicker'

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

function Locations({ metroStationIds, customLocations }: { metroStationIds: string[]; customLocations: string[] }) {
  return <div className="trainer-locations">
    <MetroStationList stationIds={metroStationIds} />
    {customLocations.length > 0 && <ul className="trainer-location-list trainer-location-manual" aria-label="Места тренировок">
      {customLocations.map((location) => <li key={location}><span>{location}</span></li>)}
    </ul>}
  </div>
}

export function TrainerProfileCard({ profile, isBrandTrainer = false, publicView = false, compact = false, action, primaryAction, footer, onAvatarClick }: {
  profile: TrainerProfileDraft
  isBrandTrainer?: boolean
  publicView?: boolean
  compact?: boolean
  action?: ReactNode
  primaryAction?: ReactNode
  footer?: ReactNode
  onAvatarClick?: () => void
}) {
  const experience = experienceLabel(profile.experienceStartYear)
  const certificateCount = profile.certificates.length
  const metroStationIds = profile.metroStationIds.filter((id) => moscowMetroStationById(id) !== undefined)
  const locationCount = profile.trainingModes.includes('in_person') ? metroStationIds.length + profile.customLocations.length : 0
  return <article className={`trainer-card${publicView ? ' trainer-card-public' : ''}${compact ? ' trainer-card-compact' : ''}`}>
    <header className="trainer-card-head">
      {profile.avatarDataUrl
        ? onAvatarClick
          ? <button type="button" className="trainer-card-avatar-button" aria-label={`Открыть фото тренера ${profile.displayName}`} onClick={onAvatarClick}>
            <img src={profile.avatarDataUrl} alt="" className="trainer-card-avatar" />
          </button>
          : <img src={profile.avatarDataUrl} alt="" className="trainer-card-avatar" />
        : <span className="trainer-card-avatar trainer-card-avatar-placeholder" aria-hidden="true">{profile.displayName.slice(0, 1).toUpperCase() || 'Ф'}</span>}
      <div className="trainer-card-identity"><h2>{profile.displayName || 'Имя тренера'}</h2>
        <p>{profile.acceptingClients ? 'Берёт новых клиентов' : 'Сейчас без новых клиентов'}</p>
        {isBrandTrainer && <span className="trainer-brand-badge">👑 Бренд-тренер</span>}</div>
      {action && <div className="trainer-card-action">{action}</div>}
    </header>
    {profile.specialties.length > 0 && <ul className="trainer-specialties" aria-label="Направления">
      {profile.specialties.map((item) => <li key={item}>{item}</li>)}
    </ul>}
    {primaryAction && <div className="trainer-card-primary-action">{primaryAction}</div>}
    {compact
      ? profile.bio && <details className="trainer-card-disclosure"><summary><span>Подробнее о тренере</span><ChevronDownIcon /></summary><p className="trainer-card-bio">{profile.bio}</p></details>
      : profile.bio && <p className="trainer-card-bio">{profile.bio}</p>}
    <dl className="trainer-card-facts">
      {profile.trainingModes.length > 0 && <div><dt>Формат</dt><dd>{profile.trainingModes.map((mode) => mode === 'online' ? 'Онлайн' : 'Лично').join(' · ')}</dd></div>}
      {profile.city && <div><dt>Город</dt><dd>{profile.city}</dd></div>}
      {experience !== null && <div><dt>Опыт</dt><dd>{experience}</dd></div>}
      {profile.price && <div><dt>Стоимость</dt><dd>{profile.price}</dd></div>}
    </dl>
    {locationCount > 0 && (compact
      ? <details className="trainer-card-disclosure"><summary><span>Где тренирует · {locationCount}</span><ChevronDownIcon /></summary><Locations metroStationIds={metroStationIds} customLocations={profile.customLocations} /></details>
      : <section><h3>Где тренирует</h3><Locations metroStationIds={metroStationIds} customLocations={profile.customLocations} /></section>)}
    {compact
      ? profile.formats && <details className="trainer-card-disclosure"><summary><span>Как проходят занятия</span><ChevronDownIcon /></summary><p>{profile.formats}</p></details>
      : profile.formats && <section><h3>Как проходят занятия</h3><p>{profile.formats}</p></section>}
    {compact
      ? (profile.education || certificateCount > 0) && <details className="trainer-card-disclosure"><summary><span>Образование и сертификаты{certificateCount > 0 ? ` · ${certificateCount}` : ''}</span><ChevronDownIcon /></summary>{profile.education && <p>{profile.education}</p>}{certificateCount > 0 && <Certificates profile={profile} />}</details>
      : <>{profile.education && <section><h3>Образование</h3><p>{profile.education}</p></section>}{certificateCount > 0 && <section><h3>Сертификаты</h3><Certificates profile={profile} /></section>}</>}
    {footer}
  </article>
}
