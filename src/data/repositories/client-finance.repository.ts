import type { TrainerFinancePackageStatus, TrainerFinancePaymentStatus } from './trainer-finance.repository'

export interface ClientFinancePackage {
  id: string
  title: string
  sessionsTotal: number
  sessionsUsed: number
  sessionsRemaining: number
  priceCents: number
  paidCents: number
  dueCents: number
  startsOn: string
  endsOn: string | null
  paymentDueOn: string | null
  packageStatus: TrainerFinancePackageStatus
  paymentStatus: TrainerFinancePaymentStatus
}

export interface ClientFinancePayment {
  id: string
  packageId: string
  amountCents: number
  receivedOn: string
}

export interface ClientFinanceTrainer {
  trainerId: string
  trainerName: string
  packages: ClientFinancePackage[]
  payments: ClientFinancePayment[]
}

export interface ClientFinanceSummary {
  trainers: ClientFinanceTrainer[]
}

export interface ClientFinanceRepository {
  getMine(): Promise<ClientFinanceSummary>
}

export const clientFinanceRepository: ClientFinanceRepository = {
  getMine: () => Promise.reject(new Error('Информация об оплате доступна после входа через Yandex ID.')),
}
