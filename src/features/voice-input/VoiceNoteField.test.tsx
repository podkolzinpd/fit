import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { VoiceNoteField, replaceWithTranscript } from './VoiceNoteField'

vi.mock('./VoiceInputButton', () => ({
  VoiceInputButton: ({ onTranscript }: { onTranscript: (text: string) => void }) => (
    <button type="button" onClick={() => onTranscript('Жим лёжа 40 кг')}>Надиктовать заметку</button>
  ),
}))

describe('appendTranscript', () => {
  it('normalizes the transcript used to replace the note', () => {
    expect(replaceWithTranscript('  Жим лёжа 40 кг ')).toBe('Жим лёжа 40 кг')
    expect(replaceWithTranscript('  ')).toBe('')
  })

  it('appends recognized text and returns focus', async () => {
    const user = userEvent.setup()
    render(<VoiceNoteField name="notes" source="test" defaultValue="Самочувствие хорошее" />)

    const textarea = screen.getByLabelText('Заметка')
    await user.click(screen.getByRole('button', { name: 'Надиктовать заметку' }))

    expect(textarea).toHaveValue('Самочувствие хорошее\nЖим лёжа 40 кг')
    expect(textarea).toHaveFocus()
  })

  it('updates a controlled form field with the recognized text', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(<VoiceNoteField name="note" source="test" label="Заметка тренера" value="Старый текст" onValueChange={onValueChange} />)

    await user.click(screen.getByRole('button', { name: 'Надиктовать заметку' }))

    expect(onValueChange).toHaveBeenCalledWith('Старый текст\nЖим лёжа 40 кг')
  })
})
