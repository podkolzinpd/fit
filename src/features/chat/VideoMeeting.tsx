import { MeetingAccessError } from '../../shared/meeting'
import { useEffect, useRef, useState } from 'react'
import type { ChatMeetingsRepository, MeetingMedia, MeetingMediaStatus, MeetingTrack } from '../../shared/meeting'
import { CloseIcon, MicIcon, VideoIcon } from '../../shared/icons'
import { StatePanel } from '../../shared/ui'

function Track({ track }: { track: MeetingTrack }) {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    track.attach(element)
    return () => track.detach(element)
  }, [track.id])
  return track.kind === 'video'
    ? <video ref={ref} className={track.local ? 'meeting-self-video' : 'meeting-partner-video'} aria-label={track.local ? 'Ваше видео' : 'Видео собеседника'} autoPlay playsInline muted={track.local} />
    : track.local ? null : <audio ref={ref} autoPlay />
}

export function VideoMeeting({ repository, conversationId, origin, partnerName, onClose, onJoined }:
  { repository: ChatMeetingsRepository; conversationId: string; origin: string; partnerName: string; onClose: () => void; onJoined: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [tabId, setTabId] = useState(() => crypto.randomUUID())
  const [entered, setEntered] = useState(false)
  const [canRetry, setCanRetry] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const [tracks, setTracks] = useState<MeetingTrack[]>([])
  const [status, setStatus] = useState<'loading' | 'preview' | MeetingMediaStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [audioMuted, setAudioMuted] = useState(false)
  const [videoMuted, setVideoMuted] = useState(false)
  const [controlBusy, setControlBusy] = useState(false)
  const mediaRef = useRef<MeetingMedia | null>(null)
  const meetingRef = useRef<string | null>(null)
  const joinedRef = useRef(false)
  const busyRef = useRef(false)
  const aliveRef = useRef(true)
  const mediaStatusRef = useRef<MeetingMediaStatus>('connecting')
  const lastHeartbeatRef = useRef(0)
  const onJoinedRef = useRef(onJoined)
  useEffect(() => { onJoinedRef.current = onJoined }, [onJoined])

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog?.showModal) dialog.showModal()
    return () => dialog?.close()
  }, [])
  useEffect(() => {
    let cancelled = false
    aliveRef.current = true
    setStatus('loading'); setError(null); setEntered(false); setCanRetry(true)
    void repository.preview(origin).then((media) => {
      if (cancelled) { void media.dispose(); return }
      mediaRef.current = media; setTracks(media.tracks()); setStatus('preview')
      setAudioMuted(false); setVideoMuted(false)
    }, (failure: unknown) => {
      if (!cancelled) { setError(failure instanceof Error ? failure.message : 'Не удалось включить камеру.'); setStatus('failed') }
    })
    return () => {
      cancelled = true; aliveRef.current = false; joinedRef.current = false
      void mediaRef.current?.dispose(); mediaRef.current = null
      const id = meetingRef.current
      if (id) void repository.command(conversationId, 'leave', tabId, id).catch(() => undefined)
      meetingRef.current = null
    }
  }, [attempt, repository, origin, conversationId, tabId])
  useEffect(() => {
    if (status !== 'joined' && status !== 'reconnecting') return
    let sending = false
    const interval = window.setInterval(() => {
      const id = meetingRef.current
      if (!id || !joinedRef.current || sending) return
      sending = true
      void repository.command(conversationId, 'heartbeat', tabId, id).then((state) => {
        if (!aliveRef.current) return
        if (!state.available || !state.meeting) throw new Error('Видеовстреча недоступна.')
        lastHeartbeatRef.current = Date.now()
        if (mediaStatusRef.current === 'joined') setStatus('joined')
      }).catch((failure: unknown) => {
        if (!aliveRef.current) return
        setStatus('reconnecting')
        if (failure instanceof MeetingAccessError || Date.now() - lastHeartbeatRef.current > 60_000) {
          joinedRef.current = false; void mediaRef.current?.dispose()
          setStatus('failed'); setError(failure instanceof MeetingAccessError ? failure.message : 'Связь потеряна. Вернитесь в чат и присоединитесь заново.')
        }
      }).finally(() => { sending = false })
    }, 20_000)
    return () => window.clearInterval(interval)
  }, [status, repository, conversationId, tabId])

  async function join() {
    const media = mediaRef.current
    if (!media || busyRef.current) return
    busyRef.current = true; setStatus('connecting'); setError(null)
    let mediaConnected = false
    try {
      const result = await repository.command(conversationId, 'prepare', tabId)
      if (!result.available || !result.meeting || !result.credentials) throw new Error('Видеовстречи сейчас недоступны.')
      meetingRef.current = result.meeting.id
      if (!aliveRef.current) {
        await repository.command(conversationId, 'leave', tabId, result.meeting.id)
        return
      }
      await media.connect(result.credentials, {
        tracks: (items) => { if (aliveRef.current) setTracks(items) },
        status: (value) => {
          mediaStatusRef.current = value
          if (value === 'failed' && joinedRef.current) {
            joinedRef.current = false
            void media.dispose()
            // A transport failure is not an explicit exit: retain the lease
            // for the reconnection grace period, preserving notice dedupe.
            meetingRef.current = null
            if (aliveRef.current) { setError('Связь потеряна. Попробуйте присоединиться снова.'); setCanRetry(true) }
          }
          if (aliveRef.current && (value !== 'joined' || joinedRef.current)) setStatus(value)
        },
      })
      mediaConnected = true
      if (!aliveRef.current) return
      const confirmed = await repository.command(conversationId, 'joined', tabId, result.meeting.id)
      if (!confirmed.available || !confirmed.meeting) throw new Error('Встреча завершилась.')
      if (!aliveRef.current) return
      joinedRef.current = true; setEntered(true); setCanRetry(false); lastHeartbeatRef.current = Date.now(); setStatus('joined'); onJoinedRef.current()
    } catch (failure) {
      await media.dispose()
      const id = meetingRef.current
      // A lost joined response may have committed. Preserve that room's lease
      // so retry reuses the same meeting and its existing per-user notice.
      if (id && (!mediaConnected || failure instanceof MeetingAccessError)) await repository.command(conversationId, 'leave', tabId, id).catch(() => undefined)
      meetingRef.current = null; setCanRetry(true)
      if (aliveRef.current) { setStatus('failed'); setError(failure instanceof Error ? failure.message : 'Не удалось присоединиться.') }
    } finally { busyRef.current = false }
  }
  async function toggle(kind: 'audio' | 'video') {
    if (controlBusy) return
    setControlBusy(true); setError(null)
    const value = kind === 'audio' ? !audioMuted : !videoMuted
    try {
      await mediaRef.current?.mute(kind, value)
      if (kind === 'audio') setAudioMuted(value); else setVideoMuted(value)
    } catch { setError('Не удалось переключить устройство. Попробуйте ещё раз.') }
    finally { setControlBusy(false) }
  }
  async function switchCamera() {
    if (controlBusy) return
    setControlBusy(true); setError(null)
    try { await mediaRef.current?.switchCamera(); setTracks(mediaRef.current?.tracks() ?? []) }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось переключить камеру.') }
    finally { setControlBusy(false) }
  }
  const hasRemoteVideo = tracks.some((track) => !track.local && track.kind === 'video')
  const hasRemote = tracks.some((track) => !track.local)
  const caption = status === 'preview' ? 'Проверьте камеру и микрофон'
    : status === 'loading' ? 'Подготавливаем камеру…' : status === 'connecting' ? 'Соединяем…'
      : status === 'reconnecting' ? 'Восстанавливаем связь…' : status === 'failed' ? 'Не удалось подключиться'
        : hasRemote ? 'Вы во встрече' : 'Ожидаем собеседника'
  const canControl = status === 'preview' || status === 'joined' || status === 'reconnecting'
  return <dialog ref={dialogRef} className="fit-video-meeting" aria-labelledby="meeting-title" onKeyDown={(event) => { if (event.key === 'Escape') event.stopPropagation() }} onCancel={(event) => { event.preventDefault(); onClose() }}>
    <header><div><h2 id="meeting-title">Видеовстреча</h2><p>{partnerName}</p></div><button type="button" className="icon-button" aria-label="Вернуться в чат" onClick={onClose}><CloseIcon /></button></header>
    <div className="meeting-stage" data-preview={status === 'preview' || status === 'connecting'} aria-busy={status === 'loading' || status === 'connecting'}>
      {!hasRemoteVideo && <div className="meeting-placeholder"><VideoIcon /><span>{hasRemote ? 'Камера собеседника выключена' : partnerName}</span></div>}
      {tracks.map((track) => <Track key={`${track.local}:${track.kind}:${track.id}`} track={track} />)}
      {videoMuted && <span className="meeting-camera-off">Ваша камера выключена</span>}
    </div>
    <p className="meeting-status" role="status">{caption}</p>
    {error && <StatePanel compact tone="error" title="Видеовстреча" description={error} />}
    <footer>
      {canControl && <div className="meeting-controls">
        <button type="button" className="secondary" disabled={controlBusy} aria-pressed={audioMuted} aria-label={audioMuted ? 'Включить микрофон' : 'Выключить микрофон'} onClick={() => void toggle('audio')}><MicIcon /><span>{audioMuted ? 'Включить микрофон' : 'Микрофон'}</span></button>
        <button type="button" className="secondary" disabled={controlBusy} aria-pressed={videoMuted} aria-label={videoMuted ? 'Включить камеру' : 'Выключить камеру'} onClick={() => void toggle('video')}><VideoIcon /><span>{videoMuted ? 'Включить камеру' : 'Камера'}</span></button>
        <button type="button" className="secondary" disabled={controlBusy} onClick={() => void switchCamera()}>Сменить камеру</button>
      </div>}
      {status === 'preview' && <button type="button" className="primary" onClick={() => void join()}>Присоединиться</button>}
      {status === 'failed' && canRetry && <button type="button" className="primary" onClick={() => { setTabId(crypto.randomUUID()); setAttempt((value) => value + 1) }}>Повторить</button>}
      <button type="button" className={entered ? 'danger' : 'secondary'} onClick={onClose}>{entered ? 'Выйти из встречи' : 'Вернуться в чат'}</button>
    </footer>
  </dialog>
}
