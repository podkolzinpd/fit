const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const requireBound = (rows, maximum) => {
  if (!Array.isArray(rows) || rows.length > maximum) throw new Error('history_audit_scope_exceeded')
  return rows
}

export function readHistoryEvidenceSecret(raw) {
  if (!raw) return null
  let evidence
  try { evidence = JSON.parse(raw) } catch { throw new Error('history_audit_evidence_invalid') }
  if (!evidence || Object.keys(evidence).sort().join(',') !== 'idSha256,messageSha256'
    || ![evidence.idSha256, evidence.messageSha256].every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value))) {
    throw new Error('history_audit_evidence_invalid')
  }
  return evidence
}

// Callers enforce the owner transaction gate. Only hashes are passed to this query.
export async function resolveHistoryEvidence(client, evidence) {
  if (!evidence) return null
  const rows = requireBound((await client.query(`select 'feedback' kind, f.user_id profile_id, p.account_role,
    encode(sha256(convert_to(btrim(f.message), 'UTF8')), 'hex') = $2 marker_matches
    from public.app_feedback f join public.profiles p on p.id = f.user_id
    where encode(sha256(convert_to(f.id::text, 'UTF8')), 'hex') = $1
    union all select 'profile', p.id, p.account_role, true from public.profiles p
    where encode(sha256(convert_to(p.id::text, 'UTF8')), 'hex') = $1
    union all select 'card', c.auth_user_id, p.account_role, true from public.clients c
    left join public.profiles p on p.id = c.auth_user_id
    where encode(sha256(convert_to(c.id::text, 'UTF8')), 'hex') = $1 limit 4`,
  [evidence.idSha256, evidence.messageSha256])).rows, 3)
  if (!rows.length) throw new Error('history_audit_evidence_not_found')
  if (rows.some(row => !row.marker_matches)) throw new Error('history_audit_evidence_feedback_mismatch')
  if (rows.some(row => row.account_role !== 'client' || !uuid.test(row.profile_id ?? ''))) throw new Error('history_audit_evidence_role_mismatch')
  if (new Set(rows.map(row => row.profile_id)).size !== 1) throw new Error('history_audit_evidence_ambiguous')
  return { profileId: rows[0].profile_id, kinds: rows.map(row => row.kind) }
}
