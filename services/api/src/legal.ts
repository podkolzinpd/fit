import type { QueryResultRow } from 'pg'

import type { DatabaseClient } from './db/types.js'

export interface LegalAcceptanceState {
  accepted: boolean
  acceptedAt: string | null
}

export interface AccountDeletionRequestState {
  id: string
  status: 'requested' | 'cancelled' | 'completed'
  requestedAt: string
}

interface AcceptanceRow extends QueryResultRow {
  accepted_at: Date | string
}

interface DeletionRow extends QueryResultRow {
  id: string
  status: 'requested' | 'cancelled' | 'completed'
  requested_at: Date | string
}

interface RequestIdRow extends QueryResultRow {
  request_id: string
}

function isoTimestamp(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error('invalid_legal_timestamp')
  return date.toISOString()
}

export async function readLegalAcceptance(
  client: DatabaseClient,
  termsVersion: string,
  privacyVersion: string,
): Promise<LegalAcceptanceState> {
  const rows = await client.query<AcceptanceRow>(
    `select accepted_at
     from public.user_legal_acceptances
     where user_id = (select auth.uid())
       and terms_version = $1
       and privacy_version = $2
     limit 1`,
    [termsVersion, privacyVersion],
  )
  const acceptedAt = rows[0]?.accepted_at
  return acceptedAt === undefined
    ? { accepted: false, acceptedAt: null }
    : { accepted: true, acceptedAt: isoTimestamp(acceptedAt) }
}

export async function acceptLegalDocuments(
  client: DatabaseClient,
  termsVersion: string,
  privacyVersion: string,
  source: 'registration' | 'existing_user',
): Promise<string> {
  const inserted = await client.query<AcceptanceRow>(
    `insert into public.user_legal_acceptances (
       user_id, terms_version, privacy_version, source
     ) values (
       (select auth.uid()), $1, $2, $3
     )
     on conflict (user_id, terms_version, privacy_version) do nothing
     returning accepted_at`,
    [termsVersion, privacyVersion, source],
  )
  if (inserted[0] !== undefined) return isoTimestamp(inserted[0].accepted_at)
  const existing = await readLegalAcceptance(client, termsVersion, privacyVersion)
  if (!existing.accepted || existing.acceptedAt === null) {
    throw new Error('legal_acceptance_not_persisted')
  }
  return existing.acceptedAt
}

export async function readAccountDeletionRequest(
  client: DatabaseClient,
): Promise<AccountDeletionRequestState | null> {
  const rows = await client.query<DeletionRow>(
    `select id, status, requested_at
     from public.account_deletion_requests
     where user_id = (select auth.uid())
       and status = 'requested'
     order by requested_at desc
     limit 1`,
  )
  const row = rows[0]
  return row === undefined ? null : {
    id: row.id,
    status: row.status,
    requestedAt: isoTimestamp(row.requested_at),
  }
}

export async function requestAccountDeletion(client: DatabaseClient): Promise<string> {
  const rows = await client.query<RequestIdRow>(
    'select public.request_account_deletion() as request_id',
  )
  const requestId = rows[0]?.request_id
  if (requestId === undefined) throw new Error('account_deletion_request_not_persisted')
  return requestId
}

export async function cancelAccountDeletionRequest(client: DatabaseClient): Promise<void> {
  await client.query('select public.cancel_account_deletion_request()')
}
