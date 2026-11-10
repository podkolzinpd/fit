export type TrainerFinancePackageStatus = 'active' | 'upcoming' | 'completed' | 'expired' | 'closed'

export type TrainerFinancePaymentStatus = 'unpaid' | 'partial' | 'paid' | 'overdue'

export type TrainerFinancePackageKind = 'session_pack' | 'online_coaching'

export interface TrainerFinancePackage {
  id: string
  clientId: string
  trainerId: string
  kind: TrainerFinancePackageKind
  singleSession?: boolean
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

export interface TrainerFinanceReceipt extends TrainerFinancePayment {
  clientId: string
  clientName: string
  archivedAt: string | null
  serviceTitle: string
}

export interface TrainerFinancePaymentHistory {
  month: string
  clientId: string | null
  offset: number
  limit: number
  totalCount: number
  totalCents: number
  clients: Array<{ id: string; name: string }>
  payments: TrainerFinanceReceipt[]
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
  clientName?: string
  canCreate?: boolean
  attendedWorkouts?: Array<{ workoutId: string; workoutDate: string; title: string | null }>
  packages: TrainerFinancePackage[]
  payments: TrainerFinancePayment[]
  sessions: TrainerFinanceSession[]
}

export interface TrainerFinanceOverviewClient {
  clientId: string
  activeClient?: boolean
  fullName: string
  archivedAt: string | null
  receivedCents: number
  completedSessions?: number
  dueCents: number
  nearestPaymentDueOn: string | null
  unpaidPackageCount: number
  activePackageCount: number
  upcomingPackageCount: number
  sessionsRemaining: number | null
  overdueCents?: number
  overdue: boolean
  lowSessions: boolean
  unassignedSessions: number
  needsAttention: boolean
}

export interface TrainerFinanceOverview {
  month: string
  receivedCents: number
  completedSessions?: number
  dueCents: number
  attentionCount: number
  clients: TrainerFinanceOverviewClient[]
}

export interface TrainerFinancePackageDraft {
  requestId?: string
  openingReceivedOn?: string
  kind: TrainerFinancePackageKind
  singleSession?: boolean
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

export type TrainerFinancePackageUpdate = Omit<TrainerFinancePackageDraft, 'openingUsedSessions' | 'openingPaidCents' | 'openingReceivedOn' | 'requestId'> & {
  expectedVersion: number
}

export interface TrainerFinancePaymentDraft {
  requestId?: string
  amountCents: number
  receivedOn: string
  comment: string | null
}

export type TrainerFinancePaymentUpdate = TrainerFinancePaymentDraft & { expectedVersion: number }

export type TrainerFinanceSessionUpdate = Pick<TrainerFinanceSession, 'disposition' | 'packageId' | 'comment' | 'workoutDate'> & { expectedVersion: number }

export type TrainerFinanceManualSessionDraft = Omit<TrainerFinanceSessionUpdate, 'expectedVersion'> & { requestId: string }

export interface TrainerFinanceRepository {
  listPayments(month: string, clientId?: string, offset?: number): Promise<TrainerFinancePaymentHistory>
  listOverview(month: string): Promise<TrainerFinanceOverview>
  listClient(clientId: string): Promise<TrainerFinanceClientBundle>
  createPackage(clientId: string, draft: TrainerFinancePackageDraft): Promise<TrainerFinancePackage>
  updatePackage(packageId: string, draft: TrainerFinancePackageUpdate): Promise<TrainerFinancePackage>
  addPayment(packageId: string, draft: TrainerFinancePaymentDraft): Promise<TrainerFinancePayment>
  updatePayment(paymentId: string, draft: TrainerFinancePaymentUpdate): Promise<TrainerFinancePayment>
  voidPayment(paymentId: string, expectedVersion: number, reason: string): Promise<void>
  createManualSession(clientId: string, draft: TrainerFinanceManualSessionDraft): Promise<TrainerFinanceSession>
  updateSession(sessionId: string, draft: TrainerFinanceSessionUpdate): Promise<TrainerFinanceSession>
}
