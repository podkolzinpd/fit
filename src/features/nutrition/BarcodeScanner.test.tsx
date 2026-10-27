import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { BarcodePhotoPicker } from './BarcodeScanner'

const fixture = vi.hoisted(() => ({ decode: vi.fn<(file: File) => Promise<string>>(), native: vi.fn<() => boolean>(), pick: vi.fn<() => Promise<File | null>>() }))
vi.mock('./barcode-native', () => ({ usesNativeBarcodePicker: fixture.native, pickNativeBarcodePhoto: fixture.pick }))
vi.mock('./barcode-photo', () => ({ decodeBarcodePhoto: fixture.decode }))

beforeEach(() => { fixture.native.mockReturnValue(false); fixture.pick.mockReset(); fixture.decode.mockReset().mockResolvedValue('2001234567893') })
const photo = () => new File(['synthetic image'], 'barcode.png', { type: 'image/png' })
function setup(pending = false) {
  const onDetected = vi.fn(), onUnrecognized = vi.fn(), onStart = vi.fn()
  const view = render(<BarcodePhotoPicker pending={pending} onDetected={onDetected} onUnrecognized={onUnrecognized} onStart={onStart} />)
  return { ...view, onDetected, onUnrecognized, onStart, user: userEvent.setup(),
    input: screen.getByLabelText('Фото штрихкода') as HTMLInputElement }
}

it('does not start decoding or change the form when the chooser is cancelled', () => {
  const { input, onDetected, onUnrecognized, onStart } = setup()
  fireEvent.change(input, { target: { files: [] } })
  expect(fixture.decode).not.toHaveBeenCalled()
  expect(onStart).not.toHaveBeenCalled()
  expect(onDetected).not.toHaveBeenCalled()
  expect(onUnrecognized).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Сканировать штрихкод' })).toBeEnabled()
})

it('blocks a second decode while the first image is pending and emits the code once', async () => {
  let finish: (value: string) => void = () => { throw new Error('Decoder not started') }
  fixture.decode.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const { input, user, onStart, onDetected, onUnrecognized } = setup()
  await user.upload(input, photo())
  expect(screen.getByRole('button', { name: 'Распознаём фото…' })).toBeDisabled()
  fireEvent.change(input, { target: { files: [photo()] } })
  expect(fixture.decode).toHaveBeenCalledTimes(1)
  await act(async () => { finish('2001234567893'); await Promise.resolve() })
  expect(onStart).toHaveBeenCalledTimes(1)
  expect(onDetected).toHaveBeenCalledExactlyOnceWith('2001234567893')
  expect(onUnrecognized).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Сканировать штрихкод' })).toBeEnabled()
})

it('allows retrying the same file after failure without leaving the control disabled', async () => {
  fixture.decode.mockRejectedValueOnce(new Error('synthetic image failure'))
  const { input, user, onDetected, onUnrecognized } = setup(), file = photo()
  await user.upload(input, file)
  await waitFor(() => expect(onUnrecognized).toHaveBeenCalledTimes(1))
  expect(input.value).toBe('')
  await user.upload(input, file)
  await waitFor(() => expect(onDetected).toHaveBeenCalledExactlyOnceWith('2001234567893'))
  expect(fixture.decode).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('button', { name: 'Сканировать штрихкод' })).toBeEnabled()
})

it.each(['success', 'failure'])('ignores late decoder %s after leaving the form', async outcome => {
  let finish: () => void = () => { throw new Error('Decoder not started') }
  fixture.decode.mockImplementation(() => new Promise((resolve, reject) => {
    finish = () => outcome === 'success' ? resolve('2001234567893') : reject(new Error('synthetic late failure'))
  }))
  const { input, user, unmount, onDetected, onUnrecognized } = setup()
  await user.upload(input, photo())
  unmount()
  await act(async () => { finish(); await Promise.resolve() })
  expect(onDetected).not.toHaveBeenCalled()
  expect(onUnrecognized).not.toHaveBeenCalled()
})

it('prevents a new chooser and decoder call while the API lookup is pending', async () => {
  const { user, input } = setup(true)
  const open = vi.spyOn(input, 'click')
  const button = screen.getByRole('button', { name: 'Ищем продукт…' })
  expect(button).toBeDisabled()
  expect(button).toHaveAttribute('aria-busy', 'true')
  await user.click(button)
  expect(open).not.toHaveBeenCalled()
  expect(fixture.decode).not.toHaveBeenCalled()
})

it('uses one Android native prompt, preserves state on cancellation and allows retry', async () => {
  fixture.native.mockReturnValue(true)
  let finish: (value: File | null) => void = () => { throw new Error('Picker not started') }
  fixture.pick.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const { user, input, onStart, onDetected, onUnrecognized } = setup()
  const open = vi.spyOn(input, 'click')
  await user.click(screen.getByRole('button', { name: 'Сканировать штрихкод' }))
  await user.click(screen.getByRole('button', { name: 'Выбираем фото…' }))
  expect(fixture.pick).toHaveBeenCalledTimes(1)
  expect(open).not.toHaveBeenCalled()
  await act(async () => { finish(null); await Promise.resolve() })
  expect(onStart).not.toHaveBeenCalled()
  expect(onUnrecognized).not.toHaveBeenCalled()
  fixture.pick.mockResolvedValueOnce(photo())
  await user.click(screen.getByRole('button', { name: 'Сканировать штрихкод' }))
  await waitFor(() => expect(onDetected).toHaveBeenCalledExactlyOnceWith('2001234567893'))
})

it('offers manual entry on native permission errors', async () => {
  fixture.native.mockReturnValue(true)
  fixture.pick.mockRejectedValueOnce(new Error('Permission denied'))
  const { user, onUnrecognized } = setup()
  await user.click(screen.getByRole('button', { name: 'Сканировать штрихкод' }))
  await waitFor(() => expect(onUnrecognized).toHaveBeenCalledExactlyOnceWith('picker'))
  expect(screen.getByRole('button', { name: 'Сканировать штрихкод' })).toBeEnabled()
})
