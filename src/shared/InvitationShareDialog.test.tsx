import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const toDataURL = vi.hoisted(() => vi.fn())
const copyText = vi.hoisted(() => vi.fn())
vi.mock('qrcode', () => ({ default: { toDataURL } }))
vi.mock('./clipboard', () => ({ copyText }))

import { InvitationShareDialog } from './InvitationShareDialog'

const share = {
  id: 'invite-1', clientId: 'client-1', targetRole: 'trainer' as const,
  code: 'ABC123DEF456', token: `ABC123DEF456.${'a'.repeat(64)}`,
  expiresAt: '2026-09-25T12:00:00.000Z',
}

describe('InvitationShareDialog', () => {
  beforeEach(() => {
    toDataURL.mockReset().mockResolvedValue('data:image/png;base64,qr')
    copyText.mockReset().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
  })

  it('copies a fragment link and keeps the manual code behind a disclosure', async () => {
    const user = userEvent.setup()
    render(<InvitationShareDialog share={share} source="supabase" message="Антон приглашает вас стать тренером в Fit." onClose={vi.fn()} onRevoke={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Скопировать ссылку' }))
    expect(copyText).toHaveBeenCalledOnce()
    const url = new URL(String(copyText.mock.calls[0]?.[0]))
    expect(url.pathname).toBe('/invite')
    expect(new URLSearchParams(url.hash.slice(1)).get('token')).toBe(share.token)
    expect(screen.getByRole('button', { name: 'Ссылка скопирована' })).toBeVisible()

    expect(screen.getByText('ABC123DEF456')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Скопировать код для тренера' }))
    expect(copyText).toHaveBeenLastCalledWith('ABC123DEF456')
  })

  it('creates a scannable QR image only when requested and offers saving it', async () => {
    const user = userEvent.setup()
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    render(<InvitationShareDialog share={share} source="yandex" message="Приглашение" onClose={vi.fn()} onRevoke={vi.fn()} />)

    expect(toDataURL).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Показать QR-код' }))
    const image = await screen.findByRole('img', { name: 'QR-код приглашения в Fit' })
    expect(image).toHaveAttribute('src', 'data:image/png;base64,qr')
    expect(String(toDataURL.mock.calls[0]?.[0])).toContain('source=yandex')

    await user.click(screen.getByRole('button', { name: 'Сохранить QR-код' }))
    expect(anchorClick).toHaveBeenCalledOnce()
    anchorClick.mockRestore()
  })

  it('requires confirmation before revoking the link', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onRevoke = vi.fn().mockResolvedValue(undefined)
    render(<InvitationShareDialog share={share} source="supabase" message="Приглашение" onClose={onClose} onRevoke={onRevoke} />)

    await user.click(screen.getByRole('button', { name: 'Отменить приглашение' }))
    expect(onRevoke).not.toHaveBeenCalled()
    const confirmation = screen.getByRole('alertdialog')
    await user.click(within(confirmation).getByRole('button', { name: 'Отозвать' }))

    await waitFor(() => expect(onRevoke).toHaveBeenCalledOnce())
    expect(onClose).toHaveBeenCalledOnce()
  })
})
