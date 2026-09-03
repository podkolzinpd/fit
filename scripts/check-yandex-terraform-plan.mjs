import { readFileSync } from 'node:fs'
import process from 'node:process'
import { isDeepStrictEqual } from 'node:util'

const planPath = process.argv[2]
const allowDestroy = process.argv.includes('--allow-destroy')
const allowPublicApi = process.argv.includes('--allow-public-api')
const automaticStageUpdate = process.argv.includes('--automatic-stage-update')
const allowPushPipelineBootstrap = process.argv.includes('--allow-push-pipeline-bootstrap')

if (planPath === undefined) {
  throw new Error(
    'Usage: check-yandex-terraform-plan.mjs <plan.json> [--allow-destroy] [--allow-public-api] [--automatic-stage-update] [--allow-push-pipeline-bootstrap]',
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
  'yandex_serverless_container.push_dispatcher',
])
const automaticLockboxAddresses = new Set([
  'yandex_lockbox_secret.database_owner_url',
  'yandex_lockbox_secret.database_url',
])
const runtimePreflightSecretAccessAddress =
  'yandex_lockbox_secret_iam_member.migration_api_connection_secret_reader[0]'
const pushPipelineBootstrapAddresses = new Set([
  'yandex_iam_service_account.push_dispatcher',
  'yandex_iam_service_account.push_scheduler',
  'yandex_iam_service_account_iam_member.push_dispatcher_deployer[0]',
  'yandex_iam_service_account_iam_member.push_scheduler_deployer[0]',
  'yandex_lockbox_secret_iam_member.push_dispatcher_connection_secret_reader',
  'yandex_lockbox_secret_iam_member.push_dispatcher_transport_secret_reader',
  'yandex_container_registry_iam_binding.api_image_puller',
  'yandex_serverless_container.push_dispatcher',
  'yandex_serverless_container_iam_binding.push_dispatcher_invocation',
  'yandex_function_trigger.push_dispatcher_timer',
])
const costSensitiveContainerFields = [
  'memory',
  'cores',
  'core_fraction',
  'concurrency',
  'execution_timeout',
  'provision_policy',
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

const isServiceAccountMember = (value) =>
  /^serviceAccount:[a-z0-9]+$/u.test(value ?? '')

const isKnownOrComputedServiceAccountMember = (resource) =>
  isServiceAccountMember(resource.change.after?.member)
  || (
    resource.change.after?.member == null
    && resource.change.after_unknown?.member === true
  )

const isReviewedPushPipelineBootstrap = (resource) => {
  if (!allowPushPipelineBootstrap || !pushPipelineBootstrapAddresses.has(resource.address)) {
    return false
  }
  const actions = resource.change.actions.join(',')
  if (actions !== 'create' && actions !== 'update') return false
  const after = resource.change.after ?? {}

  if (resource.address === 'yandex_serverless_container.push_dispatcher') {
    return Number(after.memory) === 512
      && Number(after.cores) === 1
      && Number(after.core_fraction) === 100
      && Number(after.concurrency) === 1
      && after.execution_timeout === '60s'
      && (!Array.isArray(after.provision_policy) || after.provision_policy.length === 0)
  }
  if (resource.address === 'yandex_function_trigger.push_dispatcher_timer') {
    const retryInterval = after.container?.[0]?.retry_interval
    return after.timer?.[0]?.cron_expression === '* * * * ? *'
      && after.timer?.[0]?.payload === 'sync-push-notifications'
      && after.container?.[0]?.path === '/internal/push/dispatch'
      && Number(after.container?.[0]?.retry_attempts) === 1
      && (Number(retryInterval) === 10 || retryInterval === '10s')
  }
  if (resource.address === 'yandex_container_registry_iam_binding.api_image_puller') {
    return after.role === 'container-registry.images.puller'
      && Array.isArray(after.members)
      && after.members.length === 3
      && after.members.every(isServiceAccountMember)
  }
  if (resource.address === 'yandex_serverless_container_iam_binding.push_dispatcher_invocation') {
    return after.role === 'serverless.containers.invoker'
      && Array.isArray(after.members)
      && after.members.length >= 1
      && after.members.length <= 2
      && after.members.every(isServiceAccountMember)
  }
  if (resource.address.includes('lockbox_secret_iam_member')) {
    return after.role === 'lockbox.payloadViewer'
      && isKnownOrComputedServiceAccountMember(resource)
  }
  if (resource.address.includes('iam_service_account_iam_member')) {
    return after.role === 'iam.serviceAccounts.user'
      && isServiceAccountMember(after.member)
  }
  if (resource.address.startsWith('yandex_iam_service_account.')) {
    return typeof after.name === 'string'
      && /^fit-(stage|prod)-push-(dispatcher|scheduler)$/u.test(after.name)
  }
  return false
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
  if (isReviewedPushPipelineBootstrap(resource)) return true
  if (actions === 'create') {
    return isExactPublicApiBinding(resource)
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
const includesPushPipelineBootstrap = changes.some(
  (resource) => pushPipelineBootstrapAddresses.has(resource.address)
    && resource.change.actions.includes('create'),
)
const pushPipelineCostSummary = includesPushPipelineBootstrap
  ? [
      '### Push pipeline bootstrap cost estimate',
      '',
      '- Schedule: 43,200 private dispatcher calls per 30-day month.',
      '- Configuration: 0.5 GB RAM, 1 vCPU, zero provisioned instances.',
      '- Estimated dispatcher cost: about 0–389 RUB/month when an average call takes 0.1–5 seconds.',
      '- Existing shared free tier, sender-function calls and internet egress can change the invoice.',
      '- Apply remains blocked until `approve_push_pipeline=true` is supplied manually.',
      '',
    ]
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
  ...pushPipelineCostSummary,
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
