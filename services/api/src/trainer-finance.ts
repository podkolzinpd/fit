import type { QueryResultRow } from 'pg'

import type { DatabaseClient, DatabasePool } from './db/types.js'
import { withYandexActorSession, type YandexActorSessionInput } from './yandex-actor-session.js'

export type TrainerFinancePackageStatus = 'active' | 'upcoming' | 'completed' | 'expired' | 'closed'
export type TrainerFinancePaymentStatus = 'unpaid' | 'partial' | 'paid' | 'overdue'
export type TrainerFinancePackageKind = 'session_pack' | 'online_coaching'

export interface TrainerFinancePackage {
  id: string
  clientId: string
  trainerId: string
  kind: TrainerFinancePackageKind
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
  nearestPaymentDueOn: string | null
  unpaidPackageCount: number
  activePackageCount: number
  upcomingPackageCount: number
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

export interface ClientFinancePackage {
  id: string
  kind: TrainerFinancePackageKind
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

export interface TrainerFinancePackageDraft {
  requestId?: string
  openingReceivedOn?: string
  kind: TrainerFinancePackageKind
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

export interface TrainerFinancePackageUpdate {
  expectedVersion: number
  kind: TrainerFinancePackageKind
  title: string
  sessionsTotal: number
  priceCents: number
  startsOn: string
  endsOn: string | null
  paymentDueOn: string | null
  comment: string | null
}

export interface TrainerFinancePaymentDraft {
  requestId?: string
  amountCents: number
  receivedOn: string
  comment: string | null
}

export interface TrainerFinancePaymentUpdate extends TrainerFinancePaymentDraft {
  expectedVersion: number
}

export interface TrainerFinanceSessionUpdate {
  expectedVersion: number
  disposition: TrainerFinanceSession['disposition']
  packageId: string | null
  comment: string | null
  workoutDate: string
}

export type TrainerFinanceManualSessionDraft = Omit<TrainerFinanceSessionUpdate, 'expectedVersion'> & { requestId: string }

type BundleRow = QueryResultRow & { bundle: TrainerFinanceClientBundle }
type PackageRow = QueryResultRow & { package: TrainerFinancePackage }
type PaymentRow = QueryResultRow & { payment: TrainerFinancePayment }
type SessionRow = QueryResultRow & { session: TrainerFinanceSession }
type OverviewRow = QueryResultRow & { overview: TrainerFinanceOverview }
type ClientSummaryRow = QueryResultRow & { finance: ClientFinanceSummary }

export class TrainerFinanceError extends Error {
  constructor(public readonly failure: 'forbidden' | 'not_found' | 'invalid' | 'conflict') {
    super(`Trainer finance command failed: ${failure}`)
    this.name = 'TrainerFinanceError'
  }
}

function trainerFinanceError(error: unknown) {
  if (!(error instanceof Error)) return undefined
  if (error.message === 'trainer_finance_forbidden') return new TrainerFinanceError('forbidden')
  if (error.message === 'trainer_finance_client_not_found'
    || error.message === 'trainer_finance_package_not_found'
    || error.message === 'trainer_finance_payment_not_found') return new TrainerFinanceError('not_found')
  if (error.message === 'trainer_finance_session_not_found') return new TrainerFinanceError('not_found')
  if (error.message === 'trainer_finance_invalid') return new TrainerFinanceError('invalid')
  if (error.message === 'trainer_finance_conflict') return new TrainerFinanceError('conflict')
  return undefined
}

export interface PilotTrainerFinance {
  listClientSelf(session: YandexActorSessionInput): Promise<ClientFinanceSummary>
  listOverview(session: YandexActorSessionInput, monthStart: string): Promise<TrainerFinanceOverview>
  listClient(session: YandexActorSessionInput, clientId: string): Promise<TrainerFinanceClientBundle>
  createPackage(session: YandexActorSessionInput, clientId: string, draft: TrainerFinancePackageDraft): Promise<TrainerFinancePackage>
  updatePackage(session: YandexActorSessionInput, packageId: string, draft: TrainerFinancePackageUpdate): Promise<TrainerFinancePackage>
  addPayment(session: YandexActorSessionInput, packageId: string, draft: TrainerFinancePaymentDraft): Promise<TrainerFinancePayment>
  updatePayment(session: YandexActorSessionInput, paymentId: string, draft: TrainerFinancePaymentUpdate): Promise<TrainerFinancePayment>
  voidPayment(session: YandexActorSessionInput, paymentId: string, expectedVersion: number, reason: string): Promise<void>
  createManualSession(session: YandexActorSessionInput, clientId: string, draft: TrainerFinanceManualSessionDraft): Promise<TrainerFinanceSession>
  updateSession(session: YandexActorSessionInput, sessionId: string, draft: TrainerFinanceSessionUpdate): Promise<TrainerFinanceSession>
}

export class DatabasePilotTrainerFinance implements PilotTrainerFinance {
  constructor(private readonly pool: DatabasePool) {}

  private run<Result>(session: YandexActorSessionInput, work: (client: DatabaseClient) => Promise<Result>) {
    return withYandexActorSession(this.pool, session, async (client) => {
      try {
        return await work(client)
      } catch (error) {
        throw trainerFinanceError(error) ?? error
      }
    })
  }

  listOverview(session: YandexActorSessionInput, monthStart: string) {
    return this.run(session, async (client) => {
      const rows = await client.query<OverviewRow>(
        'select public.list_trainer_finance_overview_v2($1) as overview',
        [monthStart],
      )
      return rows[0]!.overview
    })
  }

  listClientSelf(session: YandexActorSessionInput) {
    return this.run(session, async (client) => {
      const rows = await client.query<ClientSummaryRow>(
        'select public.list_client_finance_self_v2() as finance',
      )
      return rows[0]!.finance
    })
  }

  listClient(session: YandexActorSessionInput, clientId: string) {
    return this.run(session, async (client) => {
      const rows = await client.query<BundleRow>(
        'select public.list_trainer_finance_client_v2($1) as bundle',
        [clientId],
      )
      return rows[0]!.bundle
    })
  }

  createPackage(session: YandexActorSessionInput, clientId: string, draft: TrainerFinancePackageDraft) {
    return this.run(session, async (client) => {
      const rows = await client.query<PackageRow>(
        `select public.create_trainer_finance_service_v2(
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
        ) as package`,
        [clientId, draft.kind, draft.title, draft.sessionsTotal, draft.openingUsedSessions,
          draft.priceCents, draft.openingPaidCents, draft.startsOn, draft.endsOn,
          draft.paymentDueOn, draft.comment, draft.openingReceivedOn ?? draft.startsOn, draft.requestId ?? null],
      )
      return rows[0]!.package
    })
  }

  updatePackage(session: YandexActorSessionInput, packageId: string, draft: TrainerFinancePackageUpdate) {
    return this.run(session, async (client) => {
      const rows = await client.query<PackageRow>(
        `select public.update_trainer_finance_service(
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
        ) as package`,
        [packageId, draft.expectedVersion, draft.kind, draft.title, draft.sessionsTotal,
          draft.priceCents, draft.startsOn, draft.endsOn, draft.paymentDueOn,
          draft.comment],
      )
      return rows[0]!.package
    })
  }

  addPayment(session: YandexActorSessionInput, packageId: string, draft: TrainerFinancePaymentDraft) {
    return this.run(session, async (client) => {
      const rows = await client.query<PaymentRow>(
        'select public.add_trainer_finance_payment_v2($1, $2, $3, $4, $5) as payment',
        [packageId, draft.amountCents, draft.receivedOn, draft.comment, draft.requestId ?? null],
      )
      return rows[0]!.payment
    })
  }

  updatePayment(session: YandexActorSessionInput, paymentId: string, draft: TrainerFinancePaymentUpdate) {
    return this.run(session, async (client) => {
      const rows = await client.query<PaymentRow>(
        'select public.update_trainer_finance_payment($1, $2, $3, $4, $5) as payment',
        [paymentId, draft.expectedVersion, draft.amountCents, draft.receivedOn,
          draft.comment],
      )
      return rows[0]!.payment
    })
  }

  voidPayment(session: YandexActorSessionInput, paymentId: string, expectedVersion: number, reason: string) {
    return this.run(session, async (client) => {
      await client.query(
        'select public.void_trainer_finance_payment($1, $2, $3)',
        [paymentId, expectedVersion, reason],
      )
    })
  }

  createManualSession(session: YandexActorSessionInput, clientId: string, draft: TrainerFinanceManualSessionDraft) {
    return this.run(session, async (client) => {
      const rows = await client.query<SessionRow>(
        'select public.create_trainer_finance_manual_session($1,$2,$3,$4,$5,$6) as session',
        [clientId, draft.requestId, draft.workoutDate, draft.disposition, draft.packageId, draft.comment],
      )
      return rows[0]!.session
    })
  }

  updateSession(session: YandexActorSessionInput, sessionId: string, draft: TrainerFinanceSessionUpdate) {
    return this.run(session, async (client) => {
      const rows = await client.query<SessionRow>(
        'select public.update_trainer_finance_session_details_v2($1, $2, $3, $4, $5, $6) as session',
        [sessionId, draft.expectedVersion, draft.disposition, draft.packageId,
          draft.comment, draft.workoutDate],
      )
      return rows[0]!.session
    })
  }
}
