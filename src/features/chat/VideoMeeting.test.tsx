import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMeetingsRepository, MeetingMedia, MeetingResult } from '../../shared/meeting'
import { VideoMeeting } from './VideoMeeting'

const id = '11111111-1111-4111-8111-111111111111'
const prepared: MeetingResult = { available:true, meeting:{ id,participantCount:0 }, credentials:{ origin:'https://video.example.test',domain:'meet.jitsi',muc:'muc.meet.jitsi',room:'fit-test',token:'test-token',expiresAt:'2026-10-28T12:00:00Z' } }
function harness() {
  let connected: (() => void) | undefined
  const media: MeetingMedia = {
    tracks:vi.fn(() => []), connect:vi.fn(() => new Promise<void>((resolve) => { connected = resolve })),
    mute:vi.fn(() => Promise.resolve(undefined)), switchCamera:vi.fn(() => Promise.resolve(undefined)), dispose:vi.fn(() => Promise.resolve(undefined)),
  }
  const command = vi.fn<ChatMeetingsRepository['command']>().mockResolvedValue(prepared)
  const repository: ChatMeetingsRepository = { state:vi.fn(() => Promise.resolve(prepared)), command, preview:vi.fn(() => Promise.resolve(media)) }
  const onJoined = vi.fn(), onClose = vi.fn()
  const view = render(<VideoMeeting repository={repository} conversationId="conversation" origin="https://video.example.test" partnerName="Тренер" onClose={onClose} onJoined={onJoined} />)
  return { ...view, repository, media, command, onJoined, onClose, connected:() => connected?.() }
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
})
afterEach(() => vi.restoreAllMocks())
describe('Fit conference UX', () => {
  it('creates no invitation during preview and confirms presence only after media joins', async () => {
    const h = harness()
    const join = await screen.findByRole('button',{ name:'Присоединиться' })
    expect(h.command).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button',{ name:'Выключить микрофон' }))
    await waitFor(() => expect(h.media.mute).toHaveBeenCalledWith('audio',true))
    fireEvent.click(join)
    await waitFor(() => expect(h.media.connect).toHaveBeenCalled())
    expect(h.command.mock.calls.map(call => call[1])).toEqual(['prepare'])
    await act(() => { h.connected(); return Promise.resolve() })
    await waitFor(() => expect(h.command.mock.calls.map(call => call[1])).toEqual(['prepare','joined']))
    expect(h.onJoined).toHaveBeenCalledOnce()
    expect(screen.getByRole('button',{ name:'Выйти из встречи' })).toBeInTheDocument()
    h.unmount()
    expect(h.media.dispose).toHaveBeenCalled()
    expect(h.command.mock.calls.at(-1)?.[1]).toBe('leave')
  })
  it('shows capture errors and supports retry without creating a room or notice', async () => {
    const repository: ChatMeetingsRepository = { state:vi.fn(),command:vi.fn(),preview:vi.fn().mockRejectedValue(new Error('Разрешите доступ к камере')) }
    render(<VideoMeeting repository={repository} conversationId="conversation" origin="https://video.example.test" partnerName="Тренер" onClose={() => undefined} onJoined={() => undefined} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Разрешите доступ к камере')
    fireEvent.click(screen.getByRole('button',{ name:'Повторить' }))
    await waitFor(() => expect(repository.preview).toHaveBeenCalledTimes(2))
    expect(repository.command).not.toHaveBeenCalled()
  })
  it('stops capture and releases the prepared room if the media connection fails', async () => {
    const h = harness()
    vi.mocked(h.media.connect).mockRejectedValueOnce(new Error('Нет связи'))
    fireEvent.click(await screen.findByRole('button',{ name:'Присоединиться' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Нет связи')
    expect(h.command.mock.calls.map(call => call[1])).toEqual(['prepare','leave'])
    expect(h.onJoined).not.toHaveBeenCalled()
    expect(h.media.dispose).toHaveBeenCalled()
  })
})
