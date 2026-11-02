import { render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { VoiceNoteField, replaceWithTranscript } from './VoiceNoteField'

vi.mock('./VoiceInputButton', () => ({
  VoiceInputButton: ({ onTranscript }: { onTranscript: (text: string) => void | (() => void) }) => {
    const [undo, setUndo] = useState<(() => void) | null>(null)
    return <>
      <button type="button" onClick={() => { const revert = onTranscript('Жим лёжа 40 кг'); setUndo(() => revert ?? null) }}>Надиктовать заметку</button>
      {undo && <button type="button" onClick={undo}>Отменить диктовку</button>}
    </>
  },
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

  it('allows voice updates to avoid the manual input handler', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    const onTranscriptValueChange = vi.fn()
    render(<VoiceNoteField name="note" source="test" value="Старый текст" onValueChange={onValueChange} onTranscriptValueChange={onTranscriptValueChange} />)

    await user.click(screen.getByRole('button', { name: 'Надиктовать заметку' }))

    expect(onTranscriptValueChange).toHaveBeenCalledWith('Старый текст\nЖим лёжа 40 кг')
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('reports manual typing separately from voice transcription', async () => {
    const user = userEvent.setup()
    const onManualValueChange = vi.fn()
    function ControlledField() {
      const [value, setValue] = useState('')
      return <VoiceNoteField name="note" source="test" value={value} onValueChange={setValue} onManualValueChange={onManualValueChange} />
    }
    render(<ControlledField />)

    await user.type(screen.getByRole('textbox'), 'Жим лёжа')

    expect(onManualValueChange).toHaveBeenLastCalledWith('Жим лёжа')
  })

  it.each([false, true])('undoes the owned formatted transcript without removing later typing (edited=%s)', async (edited) => {
    const user = userEvent.setup()
    const formatted = 'Старый текст\nЖим штанги лёжа — 1 × 10 повт. × 40 кг'
    const manualChange = vi.fn()
    function FormattedField() {
      const [value, setValue] = useState('Старый текст')
      return <VoiceNoteField name="workout" source="today" value={value}
        onValueChange={(next) => { manualChange(next); setValue(next) }}
        onTranscriptValueChange={setValue}
        onTranscriptAppended={async () => { await Promise.resolve(); setValue(formatted); return formatted }} />
    }
    render(<FormattedField />)
    const text = screen.getByRole('textbox')
    await user.click(screen.getByRole('button', { name: 'Надиктовать заметку' }))
    await waitFor(() => expect(text).toHaveValue(formatted))
    if (edited) await user.type(text, ' моя правка')
    await user.click(screen.getByRole('button', { name: 'Отменить диктовку' }))
    expect(text).toHaveValue(edited ? `${formatted} моя правка` : 'Старый текст')
    if (!edited) expect(manualChange).toHaveBeenLastCalledWith('Старый текст')
  })

  it('shows processing status until the workout parser finishes', async () => {
    const user = userEvent.setup()
    let finishProcessing!: () => void
    const onTranscriptAppended = vi.fn(() => new Promise<void>((resolve) => { finishProcessing = resolve }))
    render(<VoiceNoteField name="workout" source="today" onTranscriptAppended={onTranscriptAppended} />)

    await user.click(screen.getByRole('button', { name: 'Надиктовать заметку' }))

    expect(screen.getByRole('status')).toHaveTextContent('Текст распознан. Обрабатываем упражнения…')
    expect(onTranscriptAppended).toHaveBeenCalledWith(expect.objectContaining({ transcript: 'Жим лёжа 40 кг' }))

    finishProcessing()
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
  })
})
