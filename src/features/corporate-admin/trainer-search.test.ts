import { describe, expect, it } from 'vitest'
import { matchesAdminTrainer } from './trainer-search'
const trainer = { id: 'account', name: 'Анна Иванова', publishedName: 'Тренер Аня',
  publicId: '10000000-0000-4000-8000-000000000001', isYandex: false, officeIds: [], version: 0 }
describe('administrator trainer search', () => {
  it('searches account and published names without requiring a contact or publication', () => {
    expect(matchesAdminTrainer(trainer, ' ИВАНОВА ')).toBe(true)
    expect(matchesAdminTrainer(trainer, 'аня')).toBe(true)
    expect(matchesAdminTrainer({ ...trainer, publicId: null, publishedName: null }, 'Анна')).toBe(true)
    expect(matchesAdminTrainer(trainer, '')).toBe(true)
  })
  it('finds the exact published profile from a copied link, including query and trailing slash', () => {
    for (const prefix of ['https://fit-training.ru', '']) {
      expect(matchesAdminTrainer(trainer, `${prefix}/trainers/${trainer.publicId}/?source=copy`)).toBe(true)
    }
    expect(matchesAdminTrainer({ ...trainer, publicId: null }, `/trainers/${trainer.publicId}`)).toBe(false)
    expect(matchesAdminTrainer(trainer, 'https://fit-training.ru/trainers/20000000-0000-4000-8000-000000000001')).toBe(false)
  })
  it('does not interpret broken links or a different path as a match', () => {
    for (const query of ['https://[broken', '/admin', 'Другой тренер', `/trainers/${trainer.publicId}/edit`]) {
      expect(matchesAdminTrainer(trainer, query)).toBe(false)
    }
  })
})
