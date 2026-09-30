export type TrainerFinancePackageStatus = 'active' | 'upcoming' | 'completed' | 'expired' | 'closed'
export type TrainerFinancePaymentStatus = 'unpaid' | 'partial' | 'paid' | 'overdue'

export interface TrainerFinancePackage {
  id: string
  clientId: string
  trainerId: string
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
  comment: string | null
  packageStatus: TrainerFinancePackageStatus
  paymentStatus: TrainerFinancePaymentStatus
  closedAt: string | null
  version: number
  createdAt: string
  updatedAt: string
}

export interface TrainerFinancePayment {
  id: string
  packageId: string
  amountCents: number
  receivedOn: string
  source: 'manual' | 'opening'
  comment: string | null
  voidedAt: string | null
  voidReason: string | null
  version: number
  createdAt: string
  updatedAt: string
}

export interface TrainerFinanceSession {
  id: string
  packageId: string | null
  workoutId: string
  disposition: 'charged' | 'unassigned' | 'free' | 'trial'
  source: 'automatic' | 'manual'
  comment: string | null
  workoutDate: string
  voidedAt: string | null
  voidReason: string | null
  version: number
  createdAt: string
  updatedAt: string
}

export interface TrainerFinanceClientBundle {
  clientId: string
  packages: TrainerFinancePackage[]
  payments: TrainerFinancePayment[]
  sessions: TrainerFinanceSession[]
}

export interface TrainerFinanceOverviewClient {
  clientId: string
  fullName: string
  archivedAt: string | null
  receivedCents: number
  dueCents: number
  activePackageCount: number
  sessionsRemaining: number | null
  overdue: boolean
  lowSessions: boolean
  unassignedSessions: number
  needsAttention: boolean
}

export interface TrainerFinanceOverview {
  month: string
  receivedCents: number
  dueCents: number
  attentionCount: number
  clients: TrainerFinanceOverviewClient[]
}

export interface TrainerFinancePackageDraft {
  title: string
  sessionsTotal: number
  openingUsedSessions: number
  priceCents: number
  openingPaidCents: number
  startsOn: string
  endsOn: string | null
  paymentDueOn: string | null
  comment: string | null
}

export type TrainerFinancePackageUpdate = Omit<TrainerFinancePackageDraft, 'openingUsedSessions' | 'openingPaidCents'> & {
  expectedVersion: number
}

export interface TrainerFinancePaymentDraft {
  amountCents: number
  receivedOn: string
  comment: string | null
}

export type TrainerFinancePaymentUpdate = TrainerFinancePaymentDraft & { expectedVersion: number }
export type TrainerFinanceSessionUpdate = Pick<TrainerFinanceSession, 'disposition' | 'packageId' | 'comment'> & { expectedVersion: number }

export interface TrainerFinanceRepository {
  listOverview(month: string): Promise<TrainerFinanceOverview>
  listClient(clientId: string): Promise<TrainerFinanceClientBundle>
  createPackage(clientId: string, draft: TrainerFinancePackageDraft): Promise<TrainerFinancePackage>
  updatePackage(packageId: string, draft: TrainerFinancePackageUpdate): Promise<TrainerFinancePackage>
  addPayment(packageId: string, draft: TrainerFinancePaymentDraft): Promise<TrainerFinancePayment>
  updatePayment(paymentId: string, draft: TrainerFinancePaymentUpdate): Promise<TrainerFinancePayment>
  voidPayment(paymentId: string, expectedVersion: number, reason: string): Promise<void>
  updateSession(sessionId: string, draft: TrainerFinanceSessionUpdate): Promise<TrainerFinanceSession>
}

function unavailable(): Promise<never> {
  return Promise.reject(new Error('Финансовый кабинет доступен после входа через Yandex ID.'))
}

export const trainerFinanceRepository: TrainerFinanceRepository = {
  listOverview: unavailable,
  listClient: unavailable,
  createPackage: unavailable,
  updatePackage: unavailable,
  addPayment: unavailable,
  updatePayment: unavailable,
  voidPayment: unavailable,
  updateSession: unavailable,
}
