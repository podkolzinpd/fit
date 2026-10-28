export interface MeetingState {
  available: boolean
  mediaOrigin?: string
  meeting: { id: string; participantCount: number } | null
}
export interface MeetingCredentials {
  origin: string
  domain: string
  muc: string
  room: string
  token: string
  expiresAt: string
}
export interface MeetingResult extends MeetingState { credentials?: MeetingCredentials }
export type MeetingAction = 'prepare' | 'joined' | 'heartbeat' | 'leave'
export interface MeetingTrack {
  id: string
  kind: 'audio' | 'video'
  local: boolean
  attach(element: HTMLMediaElement): void
  detach(element: HTMLMediaElement): void
}
export type MeetingMediaStatus = 'connecting' | 'joined' | 'reconnecting' | 'failed'
export interface MeetingMedia {
  tracks(this: void): MeetingTrack[]
  connect(this: void, credentials: MeetingCredentials, events: {
    status: (value: MeetingMediaStatus) => void
    tracks: (value: MeetingTrack[]) => void
  }): Promise<void>
  mute(this: void, kind: 'audio' | 'video', value: boolean): Promise<void>
  switchCamera(this: void): Promise<void>
  dispose(this: void): Promise<void>
}
export interface ChatMeetingsRepository {
  state(this: void, conversationId: string): Promise<MeetingState>
  command(this: void, conversationId: string, action: MeetingAction, tabId: string, meetingId?: string): Promise<MeetingResult>
  preview(this: void, origin: string): Promise<MeetingMedia>
}

export class MeetingAccessError extends Error {}
