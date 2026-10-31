import type { CorporateTrainer } from '../../shared/corporate-admin'

export function matchesAdminTrainer(trainer: CorporateTrainer, search: string): boolean {
  const term = search.trim().toLocaleLowerCase('ru')
  if (!term) return true
  if (`${trainer.name} ${trainer.publishedName ?? ''}`.toLocaleLowerCase('ru').includes(term)) return true
  // Parse copied profile links without navigating to or fetching their origin.
  try {
    const path = new URL(search.trim(), 'https://fit-training.ru').pathname
    const publicId = /^\/trainers\/([0-9a-f-]{36})\/?$/i.exec(path)?.[1]
    return publicId !== undefined && publicId.toLowerCase() === trainer.publicId?.toLowerCase()
  } catch { return false }
}
