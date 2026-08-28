import { readFileSync } from 'node:fs'
import process from 'node:process'
import { isDeepStrictEqual } from 'node:util'

const planPath = process.argv[2]
const allowDestroy = process.argv.includes('--allow-destroy')
const allowPublicApi = process.argv.includes('--allow-public-api')
const automaticStageUpdate = process.argv.includes('--automatic-stage-update')

if (planPath === undefined) {
  throw new Error(
    'Usage: check-yandex-terraform-plan.mjs <plan.json> [--allow-destroy] [--allow-public-api] [--automatic-stage-update]',
  )
}

const plan = JSON.parse(readFileSync(planPath, 'utf8'))
const changes = (plan.resource_changes ?? []).filter(
  (resource) => resource.change.actions.join(',') !== 'no-op',
)
const destructive = changes.filter((resource) =>
  resource.change.actions.includes('delete'),
)
const protectedDestruction = destructive.filter((resource) =>
  resource.address === 'yandex_mdb_postgresql_cluster_v2.fit'
  || resource.address === 'yandex_mdb_postgresql_database.fit',
)
const publicResources = changes.filter(
  (resource) =>
    resource.change.after?.member === 'system:allUsers'
    || resource.change.after?.members?.includes('system:allUsers'),
)
const allowedPublicApiAddress =
  'yandex_serverless_container_iam_binding.api_invocation[0]'
const automaticContainerAddresses = new Set([
  'yandex_serverless_container.api',
  'yandex_serverless_container.migration[0]',
])
const automaticLockboxAddresses = new Set([
  'yandex_lockbox_secret.database_owner_url',
  'yandex_lockbox_secret.database_url',
])
const runtimePreflightSecretAccessAddress =
  'yandex_lockbox_secret_iam_member.migration_api_connection_secret_reader[0]'
const apiAiRoleAddress =
  'yandex_resourcemanager_folder_iam_member.api_ai_user'
const costSensitiveContainerFields = [
  'memory',
  'cores',
  'core_fraction',
  'concurrency',
  'execution_timeout',
  'provisioned_instances_count',
  'service_account_id',
  'connectivity',
  'log_options',
]
const unexpectedPublicResources = publicResources.filter(
  (resource) =>
    !allowPublicApi
    || resource.address !== allowedPublicApiAddress
    || resource.change.after?.role !== 'serverless.containers.invoker',
)
const isExactPublicApiBinding = (resource) =>
  resource.address === allowedPublicApiAddress
  && allowPublicApi
  && resource.change.after?.role === 'serverless.containers.invoker'
  && Array.isArray(resource.change.after?.members)
  && resource.change.after.members.includes('system:allUsers')
  && resource.change.after.members.length <= 2
  && resource.change.after.members.every(
    (member) =>
      member === 'system:allUsers' || member.startsWith('serviceAccount:'),
  )

const hasOnlyTopLevelChanges = (resource, allowedFields) => {
  const withoutAllowedFields = (value) => Object.fromEntries(
    Object.entries(value ?? {}).filter(([key]) => !allowedFields.has(key)),
  )
  return isDeepStrictEqual(
    withoutAllowedFields(resource.change.before),
    withoutAllowedFields(resource.change.after),
  )
}

const changedTopLevelFields = (resource) => {
  const before = resource.change.before ?? {}
  const after = resource.change.after ?? {}
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((field) => !isDeepStrictEqual(before[field], after[field]))
    .sort()
}

const describeUnexpectedAutomaticChange = (resource) => {
  const fields = changedTopLevelFields(resource)
  return fields.length === 0
    ? resource.address
    : `${resource.address} [${fields.join(', ')}]`
}

const hasBoundedImageRetention = (resource) => {
  const rules = resource.change.after?.rule
  return Array.isArray(rules)
    && rules.length > 0
    && rules.every((rule) => {
      const duration = /^(\d+)h(?:0m0s)?$/.exec(rule.expire_period ?? '')
      return duration !== null
        && Number(duration[1]) <= 168
        && Number(rule.retained_top) <= 10
    })
}

const hasBoundedApiExecutionTimeout = (resource) => {
  if (resource.address !== 'yandex_serverless_container.api') return false
  const before = /^(\d+)s$/.exec(resource.change.before?.execution_timeout ?? '')
  const after = /^(\d+)s$/.exec(resource.change.after?.execution_timeout ?? '')
  return before !== null && after !== null
    && Number(after[1]) >= Number(before[1])
    && Number(after[1]) <= 120
}

const changesContainerCostOrIdentity = (resource) =>
  costSensitiveContainerFields.some(
    (field) =>
      !(field === 'execution_timeout' && hasBoundedApiExecutionTimeout(resource))
      &&
      JSON.stringify(resource.change.before?.[field])
      !== JSON.stringify(resource.change.after?.[field]),
  )

const isAutomaticStageChange = (resource) => {
  const actions = resource.change.actions.join(',')
  if (actions === 'create') {
    return isExactPublicApiBinding(resource)
      || (
        resource.address === apiAiRoleAddress
        && resource.change.after?.role === 'ai.languageModels.user'
        && /^serviceAccount:[a-z0-9]+$/u.test(resource.change.after?.member ?? '')
      )
      || (
        resource.address === runtimePreflightSecretAccessAddress
        && resource.change.after?.role === 'lockbox.payloadViewer'
        && /^serviceAccount:[a-z0-9]+$/u.test(resource.change.after?.member ?? '')
      )
  }
  if (actions !== 'update') {
    return false
  }
  if (isExactPublicApiBinding(resource)) {
    return true
  }
  if (automaticContainerAddresses.has(resource.address)) {
    return !changesContainerCostOrIdentity(resource)
  }
  if (automaticLockboxAddresses.has(resource.address)) {
    return hasOnlyTopLevelChanges(resource, new Set(['description']))
  }
  if (resource.address === 'yandex_container_repository_lifecycle_policy.api') {
    return hasBoundedImageRetention(resource)
  }
  return false
}
const unexpectedAutomaticChanges = automaticStageUpdate
  ? changes.filter((resource) => !isAutomaticStageChange(resource))
  : []

const summary = [
  '## Yandex stage Terraform plan',
  '',
  `Applyable: ${String(plan.applyable)}`,
  `Complete: ${String(plan.complete)}`,
  `Changed resources: ${String(changes.length)}`,
  '',
  '| Resource | Actions |',
  '| --- | --- |',
  ...changes.map(
    (resource) => `| \`${resource.address}\` | ${resource.change.actions.join(', ')} |`,
  ),
  '',
].join('\n')

process.stdout.write(`${summary}\n`)
if (process.env.GITHUB_STEP_SUMMARY !== undefined) {
  const { appendFileSync } = await import('node:fs')
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`)
}

if (
  plan.complete !== true
  || plan.errored === true
  || (changes.length > 0 && plan.applyable !== true)
) {
  throw new Error('Terraform did not produce a complete applyable plan')
}
if (protectedDestruction.length > 0) {
  throw new Error('Managed PostgreSQL cluster or database destruction is always blocked')
}
if (unexpectedPublicResources.length > 0) {
  throw new Error(
    'Public invocation is allowed only for the reviewed stage API binding',
  )
}
if (unexpectedAutomaticChanges.length > 0) {
  throw new Error(
    `Automatic stage deploy contains new or cost-sensitive infrastructure changes: ${unexpectedAutomaticChanges.map(describeUnexpectedAutomaticChange).join(', ')}`,
  )
}
if (destructive.length > 0 && !allowDestroy) {
  throw new Error(
    'Terraform plan contains delete or replacement actions; use the reviewed manual override',
  )
}
