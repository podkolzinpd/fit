import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useDataBackend } from '../../app/data-backend-context'
import { prepareImage } from '../../shared/image-prep'
import { bmiLabel } from '../../data/repositories/workout-rules'
import type { Client } from '../../shared/domain'

export function ClientProfileHeader({ client }: { client: Client }) {
  const { clients } = useDataBackend()
  const cache = useQueryClient()
  const [imageFailed, setImageFailed] = useState(false)
  const key = ['client-photo', client.id]
  const photo = useQuery({ queryKey: key, queryFn: () => clients.photo!(client.id), enabled: typeof clients.photo === 'function', staleTime: 60_000 })
  const save = useMutation({
    mutationFn: async (file: File) => {
      const current = cache.getQueryData<{ url: string | null; version: number }>(key)
      if (!clients.uploadPhoto || !current) throw new Error('Сначала дождитесь загрузки фотографии')
      const image = await prepareImage(file, { maxBytes: 160_000, maxEdge: 480 })
      return clients.uploadPhoto(client.id, current.version, image)
    },
    onSuccess: result => { setImageFailed(false); cache.setQueryData(key, result) },
    onError: () => { void cache.invalidateQueries({ queryKey: key }) },
  })
  return <section className="client-profile-header" aria-label="Профиль спортсмена">
    <input id="client-profile-photo-input" type="file" hidden accept="image/*" disabled={save.isPending || photo.isPending || Boolean(client.archivedAt)} onChange={event => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (file) save.mutate(file)
    }} />
    {photo.data?.url && <img className="client-profile-photo" src={photo.data.url} onError={() => setImageFailed(true)} alt={`Фото: ${client.fullName}`} width={121} height={120} />}
    <h2>{client.fullName}</h2>
    {(photo.error || save.error || imageFailed) && <div role="alert" className="client-profile-photo-error">
      <span>{save.error instanceof Error ? save.error.message : 'Не удалось загрузить фото'}</span>
      <button type="button" disabled={photo.isFetching || save.isPending} onClick={async () => {
        const result = await photo.refetch()
        if (result.isError) return
        setImageFailed(false)
        if (save.error && save.variables) save.mutate(save.variables)
        else save.reset()
      }}>Повторить загрузку</button>
    </div>}
    {save.isPending && <p role="status">Сохраняем фото…</p>}
    <dl className="client-profile-vitals">
      <div><dd>{client.ageYears ?? '—'}</dd><dt>возраст</dt></div>
      <div><dd>{client.heightCm ?? '—'}</dd><dt>рост</dt></div>
      <div><dd>{client.currentWeightKg?.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) ?? '—'}</dd><dt>вес</dt></div>
      <div><dd>{bmiLabel(client.heightCm, client.currentWeightKg).replace('.', ',')}</dd><dt>ИМТ</dt></div>
    </dl>
  </section>
}
