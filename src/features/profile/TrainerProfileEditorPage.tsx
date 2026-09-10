import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { useDataBackend } from '../../app/data-backend-context'
import { forgetPublicTrainerProfile } from '../../data/repositories/trainer-profiles.repository'
import type { TrainerCertificate, TrainerProfileDraft, TrainerTrainingMode } from '../../shared/domain'
import { copyText } from '../../shared/clipboard'
import { prepareProfileImage } from '../../shared/profile-image'
import { emptyTrainerProfileDraft, validatePublishableTrainerProfile } from '../../shared/trainer-profile'
import { AsyncView, Field, SaveStatus, Switch } from '../../shared/ui'
import { TrainerProfileCard } from './TrainerProfileCard'

const key = ['trainer-professional-profile'] as const

function commaList(value: string): string[] {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))].slice(0, 12)
}

export function TrainerProfessionalProfileSection() {
  const { actor } = useAuth()
  const { trainerProfiles } = useDataBackend()
  const queryClient = useQueryClient()
  const profile = useQuery({ queryKey: key, queryFn: () => trainerProfiles.getOwn() })
  const [draft, setDraft] = useState<TrainerProfileDraft | null>(null)
  const [preview, setPreview] = useState(false)
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
    onSuccess: (value) => { queryClient.setQueryData(key, value); setDraft(value.draft); setStatus('saved') },
    onError: () => setStatus('error'),
  })
  const publish = useMutation({
    mutationFn: async (value: TrainerProfileDraft) => {
      await trainerProfiles.saveDraft(value)
      return trainerProfiles.publish()
    },
    onSuccess: (value) => { forgetPublicTrainerProfile(value.publicId); queryClient.setQueryData(key, value); setDraft(value.draft); setStatus('saved'); setLocalError(null) },
    onError: (error) => { setStatus('error'); setLocalError(error.message) },
  })
  const unpublish = useMutation({
    mutationFn: () => trainerProfiles.unpublish(),
    onSuccess: (value) => { forgetPublicTrainerProfile(value.publicId); queryClient.setQueryData(key, value); setStatus('saved') },
  })
  const catalogListing = useMutation({
    mutationFn: (listed: boolean) => trainerProfiles.setCatalogListing(listed),
    onSuccess: (value) => { queryClient.setQueryData(key, value); setStatus('saved') },
  })

  function set<K extends keyof TrainerProfileDraft>(field: K, value: TrainerProfileDraft[K]) {
    setDraft((current) => current === null ? current : { ...current, [field]: value })
    setStatus('idle'); setLocalError(null)
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
  function submit(event: FormEvent) { event.preventDefault(); if (draft) save.mutate(draft) }
  function publishNow() {
    if (!draft) return
    const error = validatePublishableTrainerProfile(draft)
    if (error) { setLocalError(error); return }
    publish.mutate(draft)
  }
  async function copyLink() {
    if (!profile.data?.published) return
    await copyText(`${window.location.origin}/trainers/${profile.data.publicId}`)
    setCopied(true); window.setTimeout(() => setCopied(false), 1800)
  }

  return <section className="trainer-professional-editor trainer-professional-embedded ui-identity" aria-labelledby="trainer-professional-title">
    <div className="trainer-professional-heading"><p className="eyebrow">ПРОФИЛЬ ТРЕНЕРА</p><h2 id="trainer-professional-title">Профессиональная анкета</h2></div>
    <AsyncView loading={profile.isLoading} error={profile.error} onRetry={() => void profile.refetch()}>
      {draft && <>
        <section className="trainer-profile-state">
          <div><strong>{profile.data?.published ? 'Анкета опубликована' : 'Анкета пока скрыта'}</strong>
            <p>{profile.data?.published ? 'Спортсмены видят последнюю опубликованную версию.' : 'Заполните анкету и опубликуйте её.'}</p></div>
          {profile.data?.published && <Link className="button secondary" to={`/trainers/${profile.data.publicId}`}>Открыть</Link>}
        </section>
        <form className="trainer-profile-form" onSubmit={submit}>
          <section className="card trainer-profile-fields">
            <h2>О вас</h2>
            <div className="trainer-avatar-editor">
              {draft.avatarDataUrl ? <img src={draft.avatarDataUrl} alt="Фото тренера" /> : <span aria-hidden="true">{draft.displayName.slice(0, 1).toUpperCase() || 'Ф'}</span>}
              <div><label className="button secondary trainer-photo-button">Выбрать фото<input type="file" accept="image/*" onChange={(event) => void imageChanged(event)} /></label>
                {draft.avatarDataUrl && <button type="button" className="link" onClick={() => set('avatarDataUrl', null)}>Удалить фото</button>}</div>
            </div>
            <Field label="Как вас увидят спортсмены"><input value={draft.displayName} maxLength={120} onChange={(event) => set('displayName', event.target.value)} /></Field>
            <Field label="О себе"><textarea value={draft.bio} maxLength={1200} placeholder="Опыт, подход и кому вы помогаете" onChange={(event) => set('bio', event.target.value)} /></Field>
            <Field label="Направления"><input value={specialtiesText} placeholder="Силовые, бег, снижение веса" onChange={(event) => { setSpecialtiesText(event.target.value); set('specialties', commaList(event.target.value)) }} /></Field>
          </section>
          <section className="card trainer-profile-fields">
            <h2>Работа</h2>
            <div className="trainer-mode-fields" role="group" aria-label="Формат занятий">
              <Switch label="Онлайн" checked={draft.trainingModes.includes('online')} onChange={(checked) => toggleMode('online', checked)} />
              <Switch label="Лично" checked={draft.trainingModes.includes('in_person')} onChange={(checked) => toggleMode('in_person', checked)} />
            </div>
            <Field label="Город"><input value={draft.city} maxLength={100} onChange={(event) => set('city', event.target.value)} /></Field>
            <Field label="Год начала практики"><input type="number" min="1950" max={new Date().getFullYear()} value={draft.experienceStartYear ?? ''} onChange={(event) => set('experienceStartYear', event.target.value ? Number(event.target.value) : null)} /></Field>
            <Field label="Как проходят занятия"><textarea value={draft.formats} maxLength={800} onChange={(event) => set('formats', event.target.value)} /></Field>
            <Field label="Стоимость"><input value={draft.price} maxLength={120} placeholder="Например, от 3 000 ₽ за занятие" onChange={(event) => set('price', event.target.value)} /></Field>
            <Switch label="Беру новых клиентов" checked={draft.acceptingClients} onChange={(checked) => set('acceptingClients', checked)} />
          </section>
          <section className="card trainer-profile-fields">
            <h2>Образование</h2>
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
            <div className="trainer-profile-actions-panel">
              {localError && <p className="error" role="alert">{localError}</p>}
              <SaveStatus status={save.isPending || publish.isPending || unpublish.isPending ? 'saving' : status} error={save.error?.message ?? publish.error?.message ?? unpublish.error?.message} />
              <div className="trainer-profile-actions">
                <button type="submit" className="secondary" disabled={save.isPending || publish.isPending}>Сохранить анкету</button>
                <button type="button" className="secondary" onClick={() => setPreview((value) => !value)}>{preview ? 'Скрыть предпросмотр' : 'Предпросмотр'}</button>
                <button type="button" className="primary" onClick={publishNow} disabled={publish.isPending}>Опубликовать</button>
              </div>
            </div>
          </section>
        </form>
        {preview && <section className="trainer-profile-preview"><p className="eyebrow">ПРЕДПРОСМОТР</p><TrainerProfileCard profile={draft} /></section>}
        {profile.data?.published && <section className="trainer-profile-publish-tools card"><h2>Опубликованная анкета</h2>
          <div className="trainer-catalog-visibility"><Switch label="Показывать в каталоге" checked={profile.data.listedInCatalog} disabled={catalogListing.isPending} onChange={(listed) => catalogListing.mutate(listed)} /><p>Спортсмены смогут найти вашу анкету.</p></div>
          {catalogListing.error && <p className="error">{catalogListing.error.message}</p>}
          <p>Ссылку можно отправить спортсмену напрямую.</p><div className="actions"><button type="button" className="secondary" onClick={() => void copyLink()}>{copied ? 'Скопировано' : 'Скопировать ссылку'}</button><button type="button" className="link danger" onClick={() => unpublish.mutate()}>Снять с публикации</button></div></section>}
      </>}
    </AsyncView>
  </section>
}

export function TrainerProfileEditorPage() {
  return <Navigate to="/profile" replace />
}
