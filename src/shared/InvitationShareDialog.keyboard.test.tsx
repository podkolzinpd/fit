import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InvitationShareDialog } from './InvitationShareDialog'

function Example() {
  const [open, setOpen] = useState(false)
  return <><button onClick={() => setOpen(true)}>Пригласить</button>{open && <InvitationShareDialog
    share={{ code: 'A'.repeat(32), targetRole: 'client', expiresAt: '2099-01-01T00:00:00Z' }}
    source="yandex" invitationUrl={`https://fit-training.ru/connect?code=${'A'.repeat(32)}`}
    message="Приглашение" onClose={() => setOpen(false)} onRevoke={() => Promise.resolve()} />}</>
}

describe('invitation dialog keyboard boundaries', () => {
  afterEach(() => vi.restoreAllMocks())
  it('wraps keyboard focus, preserves focus through QR state changes and restores the trigger', async () => {
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList)
    const user = userEvent.setup()
    render(<Example />)
    const trigger = screen.getByRole('button', { name: 'Пригласить' })
    await user.click(trigger)
    const close = screen.getByRole('button', { name: 'Закрыть' })
    const revoke = screen.getByRole('button', { name: 'Отменить приглашение' })
    expect(close).toHaveFocus()
    await user.tab({ shift: true })
    expect(revoke).toHaveFocus()
    await user.tab()
    expect(close).toHaveFocus()
    const qr = screen.getByRole('button', { name: 'Показать QR-код' })
    await user.click(qr)
    expect(screen.getByRole('button', { name: 'Скрыть QR-код' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
