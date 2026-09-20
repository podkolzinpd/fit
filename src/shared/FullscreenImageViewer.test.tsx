import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { FullscreenImageViewer } from './FullscreenImageViewer'

describe('FullscreenImageViewer gallery', () => {
  it('opens the selected image and navigates through the gallery', async () => {
    const user = userEvent.setup()
    render(<FullscreenImageViewer
      src="https://storage.example/one.jpg"
      alt="Фото 1"
      images={[
        { src: 'https://storage.example/one.jpg', alt: 'Фото 1' },
        { src: 'https://storage.example/two.jpg', alt: 'Фото 2' },
        { src: 'https://storage.example/three.jpg', alt: 'Фото 3' },
      ]}
      initialIndex={1}
      onClose={vi.fn()}
    />)

    expect(screen.getByAltText('Фото 2')).toBeVisible()
    expect(screen.getByText('2 из 3')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Следующее фото' }))
    expect(screen.getByAltText('Фото 3')).toBeVisible()
    expect(screen.getByText('3 из 3')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Следующее фото' }))
    expect(screen.getByAltText('Фото 1')).toBeVisible()
    expect(screen.getByText('1 из 3')).toBeVisible()
  })
})
