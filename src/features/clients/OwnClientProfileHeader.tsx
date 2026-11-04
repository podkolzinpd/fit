import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useDataBackend } from '../../app/data-backend-context'
import { bmiLabel } from '../../data/repositories/workout-rules'
import type { Client } from '../../shared/domain'
import { PhotoIcon } from '../../shared/icons'
import { prepareImage } from '../../shared/image-prep'

/** The same private photo and photo version as the trainer's canonical card. */
export function OwnClientProfileHeader({ client, email }: { client: Client; email: string | null }) {
  const { clients } = useDataBackend()
  const cache = useQueryClient()
  const inputId = useId()
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const key = ['client-photo', client.id]
  const supported = typeof clients.photo === 'function' && typeof clients.uploadPhoto === 'function'
  const photo = useQuery({ queryKey: key, queryFn: () => clients.photo!(client.id), enabled: supported, staleTime: 60_000 })
  const save = useMutation({
    mutationFn: async (file: File) => {
      const current = cache.getQueryData<{ url: string | null; version: number }>(key)
      if (!clients.uploadPhoto || !current) throw new Error('Сначала дождитесь загрузки фотографии')
      const image = await prepareImage(file, { maxBytes: 160_000, maxEdge: 480 })
      return clients.uploadPhoto(client.id, current.version, image)
    },
    onSuccess: result => { setFailedUrl(null); cache.setQueryData(key, result) },
    onError: () => { void cache.invalidateQueries({ queryKey: key }) },
  })
  const url = photo.data?.url
  const busy = photo.isFetching || save.isPending
  const initials = client.fullName.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()
  return <section className="client-own-profile-hero" aria-label="Мои данные">
    <input id={inputId} type="file" accept="image/*" hidden
      disabled={!supported || photo.isPending || save.isPending || Boolean(client.archivedAt)}
      onChange={event => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (file) save.mutate(file)
      }} />
    <button type="button" className="client-own-photo-button" aria-label={url ? 'Изменить фото профиля' : 'Добавить фото профиля'}
      disabled={!supported || photo.isPending || save.isPending || Boolean(client.archivedAt)}
      onClick={() => document.getElementById(inputId)?.click()}>
      {url && url !== failedUrl
        ? <img src={url} alt={`Фото: ${client.fullName}`} width={121} height={120} onError={() => setFailedUrl(url)} />
        : <span className="client-own-photo-placeholder" aria-hidden="true">{initials || 'Я'}</span>}
      <span className="client-own-photo-action"><PhotoIcon /></span>
    </button>
    <h2>{client.fullName}</h2>
    {email && <p className="client-own-profile-email">{email}</p>}
    {save.isPending && <p role="status">Сохраняем фото…</p>}
    {(photo.error || save.error || (url && url === failedUrl)) && <div className="client-own-photo-error" role="alert">
      <p>{save.error instanceof Error ? save.error.message : 'Не удалось загрузить фото'}</p>
      <button type="button" className="link" disabled={busy} onClick={async () => {
        const result = await photo.refetch()
        if (result.isError) return
        setFailedUrl(null)
        if (save.error && save.variables) save.mutate(save.variables)
        else save.reset()
      }}>Повторить загрузку фото</button>
    </div>}
    <dl className="client-own-profile-vitals">
      <div><dd>{client.ageYears ?? '—'}</dd><dt>возраст</dt></div>
      <div><dd>{client.heightCm?.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) ?? '—'}</dd><dt>рост, см</dt></div>
      <div><dd>{client.currentWeightKg?.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) ?? '—'}</dd><dt>вес, кг</dt></div>
      <div><dd>{bmiLabel(client.heightCm, client.currentWeightKg).replace('.', ',')}</dd><dt>ИМТ</dt></div>
    </dl>
    <Link className="client-own-profile-edit" to="/me/edit" state={{ from: '/me/profile' }}>Изменить данные</Link>
  </section>
}
