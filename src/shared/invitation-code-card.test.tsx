import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InvitationCodeCard } from './invitation-code-card'

const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
const execCommandDescriptor = Object.getOwnPropertyDescriptor(document, 'execCommand')

function setClipboard(value: { writeText: (text: string) => Promise<void> } | undefined) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value })
}

function setExecCommand(value: (command: string) => boolean) {
  Object.defineProperty(document, 'execCommand', { configurable: true, value })
}

afterEach(() => {
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
  else Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
  if (execCommandDescriptor) Object.defineProperty(document, 'execCommand', execCommandDescriptor)
  else Object.defineProperty(document, 'execCommand', { configurable: true, value: undefined })
})

describe('InvitationCodeCard', () => {
  it('copies a client code and confirms the action in the button', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard({ writeText })
    render(<InvitationCodeCard code="D0A35DC4DBA1" label="Код клиента" description="Действует 7 дней." />)

    await userEvent.click(screen.getByRole('button', { name: 'Скопировать код клиента' }))

    expect(writeText).toHaveBeenCalledWith('D0A35DC4DBA1')
    const copied = screen.getByRole('button', { name: 'Код клиента скопирован' })
    expect(copied).toHaveTextContent('Скопировано')
    expect(copied.querySelector('svg')).toHaveAttribute('data-icon', 'check')
  })

  it('falls back to selection copy when iOS WebView rejects Clipboard API', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'))
    const execCommand = vi.fn().mockReturnValue(true)
    setClipboard({ writeText })
    setExecCommand(execCommand)
    render(<InvitationCodeCard code="ABC123DEF456" label="Код для тренера" description="Одноразовый код." />)

    await userEvent.click(screen.getByRole('button', { name: 'Скопировать код для тренера' }))

    expect(writeText).toHaveBeenCalledWith('ABC123DEF456')
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(document.querySelector('textarea[aria-hidden="true"]')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Код для тренера скопирован' })).toBeVisible()
  })

  it('keeps the code selectable and explains a complete clipboard failure', async () => {
    setClipboard(undefined)
    setExecCommand(() => false)
    render(<InvitationCodeCard code="ABC123DEF456" label="Код клиента" description="Одноразовый код." />)

    await userEvent.click(screen.getByRole('button', { name: 'Скопировать код клиента' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Нажмите и удерживайте код')
    expect(screen.getByText('ABC123DEF456')).toHaveClass('invitation-code-value')
    expect(screen.getByRole('button', { name: 'Повторить копирование: код клиента' })).toHaveTextContent('Повторить')
  })
})
