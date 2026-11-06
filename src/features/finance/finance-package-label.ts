import type { TrainerFinancePackage } from '../../data/contracts/trainer-finance'
import { formatLocalDateShort, localDate } from '../../shared/local-date'

export function financePackagePeriod(pack: Pick<TrainerFinancePackage, 'startsOn' | 'endsOn'>): string {
  const start = formatLocalDateShort(localDate(pack.startsOn))
  return `${start} — ${pack.endsOn ? formatLocalDateShort(localDate(pack.endsOn)) : 'без срока'}`
}
