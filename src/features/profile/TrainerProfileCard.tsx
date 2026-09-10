import type { TrainerProfileDraft } from '../../shared/domain'

export function TrainerProfileCard({ profile, publicView = false }: { profile: TrainerProfileDraft; publicView?: boolean }) {
  const currentYear = new Date().getFullYear()
  const experience = profile.experienceStartYear === null ? null : Math.max(0, currentYear - profile.experienceStartYear)
  return <article className={`trainer-card${publicView ? ' trainer-card-public' : ''}`}>
    <header className="trainer-card-head">
      {profile.avatarDataUrl
        ? <img src={profile.avatarDataUrl} alt="" className="trainer-card-avatar" />
        : <span className="trainer-card-avatar trainer-card-avatar-placeholder" aria-hidden="true">{profile.displayName.slice(0, 1).toUpperCase()}</span>}
      <div><h2>{profile.displayName || 'Имя тренера'}</h2>
        <p>{profile.acceptingClients ? 'Берёт новых клиентов' : 'Сейчас без новых клиентов'}</p></div>
    </header>
    {profile.specialties.length > 0 && <ul className="trainer-specialties" aria-label="Направления">
      {profile.specialties.map((item) => <li key={item}>{item}</li>)}
    </ul>}
    {profile.bio && <p className="trainer-card-bio">{profile.bio}</p>}
    <dl className="trainer-card-facts">
      {profile.trainingModes.length > 0 && <div><dt>Формат</dt><dd>{profile.trainingModes.map((mode) => mode === 'online' ? 'Онлайн' : 'Лично').join(' · ')}</dd></div>}
      {profile.city && <div><dt>Город</dt><dd>{profile.city}</dd></div>}
      {experience !== null && <div><dt>Опыт</dt><dd>{experience === 0 ? 'Меньше года' : `${experience} ${experience % 10 === 1 && experience % 100 !== 11 ? 'год' : experience % 10 >= 2 && experience % 10 <= 4 && (experience % 100 < 10 || experience % 100 >= 20) ? 'года' : 'лет'}`}</dd></div>}
      {profile.price && <div><dt>Стоимость</dt><dd>{profile.price}</dd></div>}
    </dl>
    {profile.formats && <section><h3>Как проходят занятия</h3><p>{profile.formats}</p></section>}
    {profile.education && <section><h3>Образование</h3><p>{profile.education}</p></section>}
    {profile.certificates.length > 0 && <section><h3>Сертификаты</h3><ul className="trainer-certificates">
      {profile.certificates.map((item, index) => <li key={`${item.title}-${index}`}><strong>{item.title}</strong>{item.organization && <span>{item.organization}</span>}{item.year && <span>{item.year}</span>}</li>)}
    </ul></section>}
  </article>
}
