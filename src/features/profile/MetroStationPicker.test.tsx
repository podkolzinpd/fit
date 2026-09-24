import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { MetroStationPicker } from './MetroStationPicker'

describe('MetroStationPicker', () => {
  it('offers Saint Petersburg stations for a Saint Petersburg profile', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<MetroStationPicker city="Санкт-Петербург" selectedIds={[]} onChange={onChange} />)

    await user.type(screen.getByRole('combobox', { name: 'Метро Санкт-Петербурга' }), 'Горный')
    await user.click(await screen.findByRole('option', { name: /Горный институт/ }))

    expect(onChange).toHaveBeenCalledWith(['spb-gorny-institut'])
  })

  it('searches both cities without a selected city and distinguishes equal names', async () => {
    const user = userEvent.setup()
    render(<MetroStationPicker selectedIds={[]} onChange={vi.fn()} />)

    await user.type(screen.getByRole('combobox', { name: 'Метро' }), 'Пионерская')

    const options = await screen.findAllByRole('option', { name: /Пионерская/ })
    expect(options).toHaveLength(2)
    expect(options.map((option) => option.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining('Москва'),
      expect.stringContaining('Санкт-Петербург'),
    ]))
  })

  it('keeps an existing station visible when the city text changes', () => {
    render(<MetroStationPicker city="Санкт-Петербург" selectedIds={['msk-dinamo']} onChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Убрать станцию Динамо' })).toBeVisible()
    expect(screen.getByRole('list', { name: 'Выбранные станции метро' })).toHaveTextContent('Динамо · Москва')
  })
})
