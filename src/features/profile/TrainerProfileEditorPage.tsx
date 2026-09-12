import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { useDataBackend } from '../../app/data-backend-context'
import { forgetPublicTrainerProfile } from '../../data/repositories/trainer-profiles.repository'
import type { TrainerCertificate, TrainerProfileDraft, TrainerTrainingMode } from '../../shared/domain'
import { copyText } from '../../shared/clipboard'
import { ChevronDownIcon } from '../../shared/icons'
import { prepareProfileImage } from '../../shared/profile-image'
import { emptyTrainerProfileDraft, trainerProfileDraftSchema, validatePublishableTrainerProfile } from '../../shared/trainer-profile'
import { AsyncView, Field, SaveStatus, Switch } from '../../shared/ui'
import { TrainerProfileCard } from './TrainerProfileCard'

const key = ['trainer-professional-profile'] as const

function commaList(value: string): string[] {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))].slice(0, 12)
}

function hasProfileContent(draft: TrainerProfileDraft): boolean {
  return Boolean(
    draft.avatarDataUrl
    || draft.bio.trim()
    || draft.specialties.length
    || draft.city.trim()
    || draft.trainingModes.length
    || draft.experienceStartYear
    || draft.education.trim()
    || draft.formats.trim()
    || draft.price.trim()
    || draft.acceptingClients
    || draft.certificates.length,
  )
}

function profilesMatch(first: TrainerProfileDraft | null | undefined, second: TrainerProfileDraft | null | undefined): boolean {
  if (!first || !second) return false
  return first.displayName === second.displayName
    && first.bio === second.bio
    && first.city === second.city
    && first.experienceStartYear === second.experienceStartYear
    && first.education === second.education
    && first.formats === second.formats
    && first.price === second.price
    && first.acceptingClients === second.acceptingClients
    && first.avatarDataUrl === second.avatarDataUrl
    && first.specialties.length === second.specialties.length
    && first.specialties.every((value, index) => value === second.specialties[index])
    && first.trainingModes.length === second.trainingModes.length
    && first.trainingModes.every((value, index) => value === second.trainingModes[index])
    && first.certificates.length === second.certificates.length
    && first.certificates.every((value, index) => {
      const other = second.certificates[index]
      return other !== undefined
        && value.title === other.title
        && value.organization === other.organization
        && value.year === other.year
    })
}

export function TrainerProfessionalProfileSection() {
  const { actor } = useAuth()
  const { trainerProfiles } = useDataBackend()
  const queryClient = useQueryClient()
  const profile = useQuery({ queryKey: key, queryFn: () => trainerProfiles.getOwn() })
  const [draft, setDraft] = useState<TrainerProfileDraft | null>(null)
  const [editing, setEditing] = useState(false)
  const [specialtiesText, setSpecialtiesText] = useState('')
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [localError, setLocalError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (profile.isLoading || draft !== null) return
    const name = [actor?.firstName, actor?.lastName].filter(Boolean).join(' ')
    const initial = profile.data?.draft ?? emptyTrainerProfileDraft(name)
    setDraft(initial)
    setSpecialtiesText(initial.specialties.join(', '))
  }, [actor?.firstName, actor?.lastName, draft, profile.data, profile.isLoading])

  const save = useMutation({
    mutationFn: (value: TrainerProfileDraft) => trainerProfiles.saveDraft(value),
    onSuccess: (value) => {
      queryClient.setQueryData(key, value)
      setDraft(value.draft)
      setSpecialtiesText(value.draft.specialties.join(', '))
      setStatus('saved')
      setEditing(false)
    },
    onError: () => setStatus('error'),
  })
  const publish = useMutation({
    mutationFn: async (value: TrainerProfileDraft) => {
      await trainerProfiles.saveDraft(value)
      return trainerProfiles.publish()
    },
    onSuccess: (value) => {
      forgetPublicTrainerProfile(value.publicId)
      queryClient.setQueryData(key, value)
      setDraft(value.draft)
      setSpecialtiesText(value.draft.specialties.join(', '))
      setStatus('saved')
      setLocalError(null)
    },
    onError: (error) => { setStatus('error'); setLocalError(error.message) },
  })
  const unpublish = useMutation({
    mutationFn: () => trainerProfiles.unpublish(),
    onSuccess: (value) => {
      forgetPublicTrainerProfile(value.publicId)
      queryClient.setQueryData(key, value)
      setStatus('saved')
      setLocalError(null)
    },
    onError: (error) => { setStatus('error'); setLocalError(error.message) },
  })
  const catalogListing = useMutation({
    mutationFn: (listed: boolean) => trainerProfiles.setCatalogListing(listed),
    onSuccess: (value) => { queryClient.setQueryData(key, value); setStatus('saved'); setLocalError(null) },
    onError: (error) => { setStatus('error'); setLocalError(error.message) },
  })

  const publishedMatchesDraft = useMemo(
    () => profilesMatch(draft, profile.data?.published),
    [draft, profile.data?.published],
  )
  const publishValidation = useMemo(() => draft ? validatePublishableTrainerProfile(draft) : null, [draft])
  const pending = save.isPending || publish.isPending || unpublish.isPending || catalogListing.isPending
  const showPublishAction = !profile.data?.published || !publishedMatchesDraft

  function set<K extends keyof TrainerProfileDraft>(field: K, value: TrainerProfileDraft[K]) {
    setDraft((current) => current === null ? current : { ...current, [field]: value })
    setStatus('idle')
    setLocalError(null)
  }
  function toggleMode(mode: TrainerTrainingMode, checked: boolean) {
    if (!draft) return
    set('trainingModes', checked ? [...new Set([...draft.trainingModes, mode])] : draft.trainingModes.filter((item) => item !== mode))
  }
  async function imageChanged(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setLocalError(null)
    try { set('avatarDataUrl', await prepareProfileImage(file)) }
    catch (error) { setLocalError(error instanceof Error ? error.message : 'Не удалось подготовить фото.') }
    event.target.value = ''
  }
  function updateCertificate(index: number, value: TrainerCertificate) {
    if (!draft) return
    set('certificates', draft.certificates.map((item, itemIndex) => itemIndex === index ? value : item))
  }
  function prepareDraft(): TrainerProfileDraft | null {
    if (!draft) return null
    const result = trainerProfileDraftSchema.safeParse(draft)
    if (result.success) return result.data
    const certificateError = result.error.issues.some((issue) => issue.path[0] === 'certificates')
    setLocalError(certificateError ? 'Укажите название сертификата или удалите его.' : 'Проверьте заполнение анкеты.')
    return null
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    const value = prepareDraft()
    if (value) save.mutate(value)
  }
  function cancelEditing() {
    const name = [actor?.firstName, actor?.lastName].filter(Boolean).join(' ')
    const savedDraft = profile.data?.draft ?? emptyTrainerProfileDraft(name)
    setDraft(savedDraft)
    setSpecialtiesText(savedDraft.specialties.join(', '))
    setStatus('idle')
    setLocalError(null)
    setEditing(false)
  }
  function publishNow() {
    const value = prepareDraft()
    if (!value) return
    const error = validatePublishableTrainerProfile(value)
    if (error) { setLocalError(error); return }
    publish.mutate(value)
  }
  async function copyLink() {
    if (!profile.data?.published) return
    await copyText(`${window.location.origin}/trainers/${profile.data.publicId}`)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return <section className="trainer-professional-editor trainer-professional-embedded ui-identity" aria-label="Анкета тренера">
    <AsyncView loading={profile.isLoading} error={profile.error} onRetry={() => void profile.refetch()}>
      {draft && editing && <form className="trainer-profile-form trainer-profile-edit-card card" onSubmit={submit} aria-label="Редактирование анкеты тренера">
        <header className="trainer-profile-edit-head"><div><p className="eyebrow">АНКЕТА ТРЕНЕРА</p><h2>Редактирование</h2></div></header>
        <div className="trainer-avatar-editor">
          {draft.avatarDataUrl ? <img src={draft.avatarDataUrl} alt="Фото тренера" /> : <span aria-hidden="true">{draft.displayName.slice(0, 1).toUpperCase() || 'Ф'}</span>}
          <div><label className="button secondary trainer-photo-button">Выбрать фото<input type="file" accept="image/*" onChange={(event) => void imageChanged(event)} /></label>
            {draft.avatarDataUrl && <button type="button" className="link" onClick={() => set('avatarDataUrl', null)}>Удалить фото</button>}</div>
        </div>
        <div className="trainer-profile-form-section">
          <Field label="Имя в анкете"><input value={draft.displayName} maxLength={120} onChange={(event) => set('displayName', event.target.value)} /></Field>
          <Field label="О себе"><textarea value={draft.bio} maxLength={1200} placeholder="Опыт, подход и кому вы помогаете" onChange={(event) => set('bio', event.target.value)} /></Field>
          <Field label="Направления"><input value={specialtiesText} placeholder="Силовые, бег, снижение веса" onChange={(event) => { setSpecialtiesText(event.target.value); set('specialties', commaList(event.target.value)) }} /></Field>
        </div>
        <div className="trainer-profile-form-section">
          <div className="trainer-profile-form-grid">
            <Field label="Город"><input value={draft.city} maxLength={100} onChange={(event) => set('city', event.target.value)} /></Field>
            <Field label="Год начала практики"><input type="number" min="1950" max={new Date().getFullYear()} value={draft.experienceStartYear ?? ''} onChange={(event) => set('experienceStartYear', event.target.value ? Number(event.target.value) : null)} /></Field>
            <Field label="Стоимость"><input value={draft.price} maxLength={120} placeholder="От 3 000 ₽" onChange={(event) => set('price', event.target.value)} /></Field>
          </div>
          <div className="trainer-mode-fields" role="group" aria-label="Формат занятий">
            <Switch label="Онлайн" checked={draft.trainingModes.includes('online')} onChange={(checked) => toggleMode('online', checked)} />
            <Switch label="Лично" checked={draft.trainingModes.includes('in_person')} onChange={(checked) => toggleMode('in_person', checked)} />
          </div>
          <Field label="Как проходят занятия"><textarea value={draft.formats} maxLength={800} onChange={(event) => set('formats', event.target.value)} /></Field>
          <Switch label="Беру новых клиентов" checked={draft.acceptingClients} onChange={(checked) => set('acceptingClients', checked)} />
        </div>
        <details className="trainer-profile-form-disclosure">
          <summary><span>Образование и сертификаты{draft.certificates.length > 0 ? ` · ${draft.certificates.length}` : ''}</span><ChevronDownIcon /></summary>
          <div className="trainer-profile-education-fields">
            <Field label="Образование и квалификация"><textarea value={draft.education} maxLength={800} onChange={(event) => set('education', event.target.value)} /></Field>
            <div className="trainer-certificates-editor"><strong>Сертификаты</strong>
              {draft.certificates.map((item, index) => <div className="trainer-certificate-fields" key={index}>
                <input aria-label={`Название сертификата ${index + 1}`} placeholder="Название" value={item.title} maxLength={120} onChange={(event) => updateCertificate(index, { ...item, title: event.target.value })} />
                <input aria-label={`Организация ${index + 1}`} placeholder="Организация" value={item.organization} maxLength={120} onChange={(event) => updateCertificate(index, { ...item, organization: event.target.value })} />
                <input aria-label={`Год сертификата ${index + 1}`} placeholder="Год" type="number" min="1950" max={new Date().getFullYear()} value={item.year ?? ''} onChange={(event) => updateCertificate(index, { ...item, year: event.target.value ? Number(event.target.value) : null })} />
                <button type="button" className="link danger" onClick={() => set('certificates', draft.certificates.filter((_, itemIndex) => itemIndex !== index))}>Удалить</button>
              </div>)}
              {draft.certificates.length < 10 && <button type="button" className="secondary" onClick={() => set('certificates', [...draft.certificates, { title: '', organization: '', year: null }])}>Добавить сертификат</button>}
            </div>
          </div>
        </details>
        {localError && <p className="error" role="alert">{localError}</p>}
        <SaveStatus status={pending ? 'saving' : status} error={save.error?.message ?? publish.error?.message ?? unpublish.error?.message ?? catalogListing.error?.message} />
        <div className="trainer-profile-actions">
          <button type="button" className="secondary" onClick={cancelEditing} disabled={pending}>Отмена</button>
          <button type="submit" className="primary" disabled={pending} aria-busy={save.isPending}>{save.isPending ? 'Сохраняем…' : 'Сохранить'}</button>
        </div>
      </form>}
      {draft && !editing && !hasProfileContent(draft) && <article className="trainer-card trainer-card-compact trainer-profile-empty">
        <header className="trainer-card-head">
          <span className="trainer-card-avatar trainer-card-avatar-placeholder" aria-hidden="true">{draft.displayName.slice(0, 1).toUpperCase() || 'Ф'}</span>
          <div className="trainer-card-identity"><h2>{draft.displayName || 'Профиль тренера'}</h2><p>Анкета пока не заполнена</p></div>
        </header>
        <p className="trainer-profile-empty-copy">Добавьте направления, опыт и формат занятий — спортсмены увидят всё в одной анкете.</p>
        <button type="button" className="primary" onClick={() => setEditing(true)}>Заполнить анкету</button>
      </article>}
      {draft && !editing && hasProfileContent(draft) && <TrainerProfileCard
        profile={draft}
        compact
        action={<button type="button" className="primary trainer-profile-edit-action" onClick={() => setEditing(true)}>Редактировать</button>}
        footer={<>
          <SaveStatus status={pending ? 'saving' : status} error={save.error?.message ?? publish.error?.message ?? unpublish.error?.message ?? catalogListing.error?.message} />
          {showPublishAction && <div className="trainer-profile-publish-cta">
            {localError && <p className="error" role="alert">{localError}</p>}
            <button type="button" className="primary wide" onClick={publishNow} disabled={pending} aria-busy={publish.isPending}>
              {publish.isPending ? 'Публикуем…' : profile.data?.published ? 'Обновить анкету' : 'Опубликовать'}
            </button>
          </div>}
          <details className="trainer-card-disclosure trainer-publication-disclosure">
            <summary><span><strong>Публикация</strong><small>{profile.data?.published ? publishedMatchesDraft ? profile.data.listedInCatalog ? 'Видна в каталоге' : 'Доступна по ссылке' : 'Есть сохранённые изменения' : publishValidation ? 'Пока не опубликована' : 'Готова к публикации'}</small></span><ChevronDownIcon /></summary>
            <div className="trainer-publication-controls">
              {!showPublishAction && localError && <p className="error" role="alert">{localError}</p>}
              {!profile.data?.published && publishValidation && <p>{publishValidation}</p>}
              {profile.data?.published && <div className="trainer-catalog-visibility"><Switch label="Показывать в каталоге" checked={profile.data.listedInCatalog} disabled={pending} onChange={(listed) => catalogListing.mutate(listed)} /></div>}
              {profile.data?.published && <div className="trainer-publication-actions"><Link className="button secondary" to={`/trainers/${profile.data.publicId}`}>Открыть анкету</Link></div>}
              {profile.data?.published && <div className="trainer-publication-links"><button type="button" className="link" onClick={() => void copyLink()}>{copied ? 'Скопировано' : 'Скопировать ссылку'}</button><button type="button" className="link danger" onClick={() => unpublish.mutate()} disabled={pending}>Снять с публикации</button></div>}
            </div>
          </details>
        </>}
      />}
    </AsyncView>
  </section>
}

export function TrainerProfileEditorPage() {
  return <Navigate to="/profile" replace />
}
