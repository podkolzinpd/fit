import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isCoachmarkSeen } from '../../shared/coachmarks'
import { CONTEST_WINNER_STORAGE_ID, ContestWinnerDialog, contestWinnerMessage } from './ContestWinnerDialog'

const submit = vi.hoisted(() => vi.fn<(kind: string, message: string) => Promise<string>>())

vi.mock('../../app/data-backend-context', () => ({
  useDataBackend: () => ({ appFeedback: { submit } }),
}))

function enablePilot(userIds = 'winner-1') {
  vi.stubEnv('VITE_CONTEST_WINNER_ENABLED', 'true')
  vi.stubEnv('VITE_CONTEST_WINNER_PILOT_USER_IDS', userIds)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-29T12:00:00+03:00'))
  submit.mockReset()
  localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('ContestWinnerDialog', () => {
  it('stays hidden with the flag off, outside the allowlist and while suppressed', () => {
    const { rerender } = render(<ContestWinnerDialog userId="winner-1" />)
    expect(screen.queryByRole('dialog')).toBeNull()

    enablePilot('someone-else')
    rerender(<ContestWinnerDialog userId="winner-1" />)
    expect(screen.queryByRole('dialog')).toBeNull()

    enablePilot()
    rerender(<ContestWinnerDialog userId="winner-1" suppressed />)
    expect(screen.queryByRole('dialog')).toBeNull()

    rerender(<ContestWinnerDialog userId="winner-1" />)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('mounts into the new frame when the public auth frame is replaced', () => {
    enablePilot()
    function Layout({ signedIn }: { signedIn: boolean }) {
      return signedIn
        ? <section key="client" className="phone-frame" data-testid="client-frame"><ContestWinnerDialog userId="winner-1" /></section>
        : <section key="public" className="phone-frame" data-testid="public-frame" />
    }
    const { rerender } = render(<Layout signedIn={false} />)
    const oldFrame = screen.getByTestId('public-frame')
    rerender(<Layout signedIn />)
    const dialog = screen.getByRole('dialog', { name: 'Вы выиграли персональную тренировку' })
    expect(oldFrame.isConnected).toBe(false)
    expect(dialog.isConnected).toBe(true)
    expect(screen.getByTestId('client-frame').contains(dialog)).toBe(true)
  })

  it('stays hidden for the allowlisted user after the announcement end date', () => {
    enablePilot()
    vi.setSystemTime(new Date('2026-10-13T00:00:00+03:00'))
    render(<ContestWinnerDialog userId="winner-1" />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('sends the contact through app feedback once and does not show again for this user', async () => {
    enablePilot()
    submit.mockResolvedValue('feedback-1')
    const user = userEvent.setup()
    const { unmount } = render(<ContestWinnerDialog userId="winner-1" />)

    expect(screen.getByRole('dialog', { name: 'Вы выиграли персональную тренировку' })).toBeTruthy()
    const send = screen.getByRole('button', { name: 'Отправить' })
    expect((send as HTMLButtonElement).disabled).toBe(true)

    await user.type(screen.getByLabelText('Как с вами связаться'), '  @winner  ')
    await user.click(send)

    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit).toHaveBeenCalledWith('suggestion', contestWinnerMessage('@winner'))
    expect(await screen.findByRole('dialog', { name: 'Спасибо, контакт у нас' })).toBeTruthy()
    expect(isCoachmarkSeen('winner-1', CONTEST_WINNER_STORAGE_ID)).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Готово' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    unmount()
    render(<ContestWinnerDialog userId="winner-1" />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps the entered contact after an error and lets the user retry', async () => {
    enablePilot()
    submit.mockRejectedValueOnce(new Error('Нет сети')).mockResolvedValueOnce('feedback-2')
    const user = userEvent.setup()
    render(<ContestWinnerDialog userId="winner-1" />)

    await user.type(screen.getByLabelText('Как с вами связаться'), 'winner@yandex.ru')
    await user.click(screen.getByRole('button', { name: 'Отправить' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Нет сети')
    expect((screen.getByLabelText('Как с вами связаться') as HTMLInputElement).value).toBe('winner@yandex.ru')
    expect(isCoachmarkSeen('winner-1', CONTEST_WINNER_STORAGE_ID)).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('dialog', { name: 'Спасибо, контакт у нас' })).toBeTruthy()
  })

  it('«Позже» and Escape hide the dialog for the session without sending anything', async () => {
    enablePilot()
    const user = userEvent.setup()
    const { unmount } = render(<ContestWinnerDialog userId="winner-1" />)

    await user.click(screen.getByRole('button', { name: 'Позже' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    unmount()

    render(<ContestWinnerDialog userId="winner-1" />)
    expect(screen.getByRole('dialog')).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(submit).not.toHaveBeenCalled()
    expect(isCoachmarkSeen('winner-1', CONTEST_WINNER_STORAGE_ID)).toBe(false)
  })
})
