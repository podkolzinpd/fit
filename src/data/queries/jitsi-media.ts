import type { MeetingMedia, MeetingMediaStatus, MeetingTrack } from '../../shared/meeting'

// Deliberately narrow boundary: no SDK objects escape into feature/UI code.
interface SdkTrack {
  getId(): string
  getType(): 'audio' | 'video'
  isLocal(): boolean
  isMuted(): boolean
  attach(element: HTMLMediaElement): void
  detach(element: HTMLMediaElement): void
  mute(): Promise<void>
  unmute(): Promise<void>
  dispose(): Promise<void>
}
type Listener = (() => void) | ((track: SdkTrack) => void)
interface Conference {
  on(event: string, listener: Listener): void
  addTrack(track: SdkTrack): Promise<void>
  replaceTrack(old: SdkTrack, next: SdkTrack | null): Promise<void>
  join(): void
  leave(): Promise<void>
}
interface Connection {
  addEventListener(event: string, listener: () => void): void
  initJitsiConference(room: string, options: object): Conference
  connect(): void
  disconnect(): Promise<void> | boolean
}
interface JitsiSdk {
  init(options: object): void
  setLogLevel(level: string): void
  createLocalTracks(options: { devices: string[]; cameraDeviceId?: string }): Promise<SdkTrack[]>
  JitsiConnection: new (app: null, token: string, options: object) => Connection
  events: { connection: { CONNECTION_ESTABLISHED: string; CONNECTION_FAILED: string; CONNECTION_DISCONNECTED: string }; conference: { TRACK_ADDED: string; TRACK_REMOVED: string; CONNECTION_INTERRUPTED: string; CONNECTION_RESTORED: string; CONFERENCE_FAILED: string; CONFERENCE_JOINED: string } }
}
declare global { interface Window { JitsiMeetJS?: JitsiSdk } }
let sdkPromise: Promise<JitsiSdk> | undefined
let sdkOrigin: string | undefined
async function loadSdk(origin: string): Promise<JitsiSdk> {
  const url = new URL(origin)
  if (url.protocol !== 'https:' || url.origin !== origin) throw new Error('Некорректный адрес видеосервера.')
  if (sdkPromise && sdkOrigin !== origin) throw new Error('Адрес видеосервера изменился. Перезагрузите страницу.')
  if (!sdkPromise) {
    sdkOrigin = origin
    sdkPromise = new Promise<JitsiSdk>((resolve, reject) => {
      const script = document.createElement('script')
      const timer = window.setTimeout(() => fail(), 15_000)
      function fail() {
        window.clearTimeout(timer); script.remove(); sdkPromise = undefined
        reject(new Error('Видеосервер недоступен. Попробуйте ещё раз.'))
      }
      script.src = `${origin}/libs/lib-jitsi-meet.min.js`
      script.crossOrigin = 'anonymous'
      script.referrerPolicy = 'no-referrer'
      script.onerror = fail
      script.onload = () => {
        window.clearTimeout(timer)
        const sdk = window.JitsiMeetJS
        if (!sdk) { fail(); return }
        sdk.init({ disableAudioLevels: true, disableSimulcast: true, analytics: { disabled: true } })
        sdk.setLogLevel('error')
        resolve(sdk)
      }
      document.head.append(script)
    })
  }
  return sdkPromise
}
function expose(track: SdkTrack): MeetingTrack {
  return { id: track.getId(), kind: track.getType(), local: track.isLocal(),
    attach: (element) => track.attach(element), detach: (element) => track.detach(element) }
}
export async function createMeetingPreview(origin: string): Promise<MeetingMedia> {
  const sdk = await loadSdk(origin)
  let local: SdkTrack[]
  try { local = await sdk.createLocalTracks({ devices: ['audio', 'video'] }) }
  catch { throw new Error('Разрешите доступ к камере и микрофону в настройках приложения или браузера и попробуйте ещё раз.') }
  const remote = new Map<string, SdkTrack>()
  let connection: Connection | undefined, conference: Conference | undefined
  let disposed = false
  let emitTracks: ((value: MeetingTrack[]) => void) | undefined
  let emitStatus: ((value: MeetingMediaStatus) => void) | undefined
  let rejectConnecting: ((error: Error) => void) | undefined
  let cameraIndex = 0
  let connectTimer: number | undefined
  const all = () => [...local, ...remote.values()].map(expose)
  return {
    tracks: all,
    async connect(credentials, events) {
      if (disposed || connection) throw new Error('Вернитесь в чат и присоединитесь заново.')
      emitTracks = events.tracks; emitStatus = events.status
      const established = sdk.events.connection.CONNECTION_ESTABLISHED
      connection = new sdk.JitsiConnection(null, credentials.token, {
        hosts: { domain: credentials.domain, muc: credentials.muc },
        serviceUrl: `${credentials.origin.replace('https:', 'wss:')}/xmpp-websocket`,
        enableWebsocketResume: true, p2pStunServers: [],
      })
      const currentConnection = connection
      return new Promise<void>((resolve, reject) => {
        rejectConnecting = reject
        const timeout = window.setTimeout(() => { emitStatus?.('failed'); reject(new Error('Не удалось подключиться к видеовстрече.')) }, 25_000)
        connectTimer = timeout
        const fail = () => { window.clearTimeout(timeout); emitStatus?.('failed'); reject(new Error('Соединение с видеовстречей потеряно.')) }
        currentConnection.addEventListener(sdk.events.connection.CONNECTION_FAILED, fail)
        currentConnection.addEventListener(sdk.events.connection.CONNECTION_DISCONNECTED, () => {
          if (!disposed) fail()
        })
        currentConnection.addEventListener(established, () => {
          if (disposed) return
          conference = currentConnection.initJitsiConference(credentials.room, {
            openBridgeChannel: true, p2p: { enabled: false }, enableLayerSuspension: true,
          })
          const room = conference
          room.on(sdk.events.conference.TRACK_ADDED, (track: SdkTrack) => {
            if (!track.isLocal()) { remote.set(track.getId(), track); emitTracks?.(all()) }
          })
          room.on(sdk.events.conference.TRACK_REMOVED, (track: SdkTrack) => {
            remote.delete(track.getId()); emitTracks?.(all())
          })
          room.on(sdk.events.conference.CONNECTION_INTERRUPTED, () => emitStatus?.('reconnecting'))
          room.on(sdk.events.conference.CONNECTION_RESTORED, () => emitStatus?.('joined'))
          room.on(sdk.events.conference.CONFERENCE_FAILED, fail)
          room.on(sdk.events.conference.CONFERENCE_JOINED, () => {
            window.clearTimeout(timeout); rejectConnecting = undefined
            emitStatus?.('joined'); resolve()
          })
          void Promise.all(local.map((track) => room.addTrack(track))).then(() => {
            if (!disposed) room.join()
          }, fail)
        })
        emitStatus?.('connecting'); currentConnection.connect()
      })
    },
    async mute(kind, value) {
      const track = local.find((item) => item.getType() === kind)
      if (!track || disposed) return
      if (value) await track.mute(); else await track.unmute()
    },
    async switchCamera() {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter((item) => item.kind === 'videoinput')
      if (devices.length < 2) throw new Error('Другая камера недоступна.')
      const previous = local.find((item) => item.getType() === 'video')
      if (!previous || disposed) return
      const muted = previous.isMuted()
      // Mobile browsers cannot always open two cameras simultaneously.
      if (conference) await conference.replaceTrack(previous, null)
      await previous.dispose()
      local = local.filter((track) => track !== previous)
      emitTracks?.(all())
      cameraIndex = (cameraIndex + 1) % devices.length
      try {
        const [next] = await sdk.createLocalTracks({ devices: ['video'], cameraDeviceId: devices[cameraIndex]!.deviceId })
        if (!next) throw new Error('Camera unavailable')
        if (disposed) { await next.dispose(); return }
        if (muted) await next.mute()
        if (conference) await conference.addTrack(next)
        local = [...local, next]
        emitTracks?.(all())
      } catch { throw new Error('Не удалось переключить камеру. Выйдите и присоединитесь снова.') }
    },
    async dispose() {
      if (disposed) return
      window.clearTimeout(connectTimer)
      disposed = true; emitStatus = undefined; emitTracks = undefined
      rejectConnecting?.(new Error('Подключение отменено.'))
      // Stop capture first, even if the network/leave request never completes.
      await Promise.allSettled(local.map((track) => track.dispose()))
      local = []; remote.clear()
      if (conference) void conference.leave().catch(() => undefined)
      if (connection) void Promise.resolve(connection.disconnect()).catch(() => undefined)
    },
  }
}
