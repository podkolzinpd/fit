import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { getPublicTrainerProfile } from '../../data/repositories/trainer-profiles.repository'
import type { TrainerProfessionalProfile } from '../../shared/domain'
import { FullscreenImageViewer } from '../../shared/FullscreenImageViewer'
import { AsyncView, Page } from '../../shared/ui'
import { TrainerProfileCard } from './TrainerProfileCard'
import { PublicTrainerChatButton } from '../chat/ChatEntry'

export function PublicTrainerProfilePage() {
  const { publicId = '' } = useParams()
  const location = useLocation()
  const { actor } = useAuth()
  const fromCatalog = (location.state as { from?: unknown } | null)?.from === '/me/trainers'
  const back = fromCatalog ? '/me/trainers' : actor?.role === 'client' ? '/me/profile' : actor?.role === 'trainer' ? '/profile' : '/auth'
  const [profile, setProfile] = useState<TrainerProfessionalProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [photoIndex, setPhotoIndex] = useState<number | null>(null)
  useEffect(() => {
    let active = true
    setLoading(true); setError(null)
    void getPublicTrainerProfile(publicId).then((value) => {
      if (active) { setProfile(value); setLoading(false) }
    }, (caught: unknown) => {
      if (active) { setError(caught instanceof Error ? caught : new Error('Не удалось открыть анкету.')); setLoading(false) }
    })
    return () => { active = false }
  }, [publicId])
  const published = profile?.published
  const photoItems = published
    ? (published.photos?.length
        ? published.photos.map((photo, index) => ({
          src: photo.url ?? photo.thumbnailUrl,
          alt: `Фото ${index + 1} тренера ${published.displayName}`,
        }))
        : published.avatarDataUrl ? [{ src: published.avatarDataUrl, alt: `Фото тренера ${published.displayName}` }] : [])
    : []
  return <Page title="Тренер Fit" back={back} swipeBack className="public-trainer-page ui-identity">
    <AsyncView loading={loading} error={error} empty={!profile?.published}
      emptyTitle="Анкета недоступна" emptyDescription="Тренер снял её с публикации или ссылка устарела."
      emptyAction={<Link className="button secondary" to="/auth">Открыть Fit</Link>} onRetry={() => { setLoading(true); setError(null); void getPublicTrainerProfile(publicId).then((value) => { setProfile(value); setLoading(false) }, (caught: unknown) => { setError(caught instanceof Error ? caught : new Error('Не удалось открыть анкету.')); setLoading(false) }) }}>
      {published && <TrainerProfileCard profile={published} isBrandTrainer={profile.isBrandTrainer} publicView
        onAvatarClick={photoItems.length ? (index) => setPhotoIndex(index) : undefined} primaryAction={published.acceptingClients
        ? <PublicTrainerChatButton publicProfileId={publicId} />
        : <p className="trainer-contact-unavailable">Тренер временно не принимает новых клиентов</p>} />}
    </AsyncView>
    {photoIndex !== null && photoItems[0] && <FullscreenImageViewer src={photoItems[0].src}
      alt={photoItems[0].alt} images={photoItems} initialIndex={photoIndex}
      label={photoItems.length > 1 ? 'Фотографии тренера' : 'Фото тренера'} onClose={() => setPhotoIndex(null)} />}
  </Page>
}
