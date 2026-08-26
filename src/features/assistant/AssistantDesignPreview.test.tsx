import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { AssistantDesignPreview } from './AssistantDesignPreview'

describe('assistant workout production surface', () => {
  it('resolves an ambiguous exercise in place and enables the final action', async () => {
    const user = userEvent.setup()
    render(<AssistantDesignPreview />)

    const submit = screen.getByRole('button', { name: 'Проверить и сохранить' })
    expect(submit).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /Жим штанги лёжа/i }))

    expect(screen.queryByText('Уточните упражнение')).not.toBeInTheDocument()
    expect(screen.getByText('Жим штанги лёжа')).toBeInTheDocument()
    expect(submit).toBeEnabled()
  })
})
