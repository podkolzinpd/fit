import { readFileSync } from 'node:fs'
import process from 'node:process'
import { isDeepStrictEqual } from 'node:util'

const planPath = process.argv[2]
const allowDestroy = process.argv.includes('--allow-destroy')
const allowPublicApi = process.argv.includes('--allow-public-api')
const automaticStageUpdate = process.argv.includes('--automatic-stage-update')
const allowPushPipelineBootstrap = process.argv.includes('--allow-push-pipeline-bootstrap')
const allowMediaStorageBootstrap = process.argv.includes('--allow-media-storage-bootstrap')

if (planPath === undefined) {
  throw new Error(
    'Usage: check-yandex-terraform-plan.mjs <plan.json> [--allow-destroy] [--allow-public-api] [--automatic-stage-update] [--allow-push-pipeline-bootstrap] [--allow-media-storage-bootstrap]',
  )
}

const plan = JSON.parse(readFileSync(planPath, 'utf8'))
const changes = (plan.resource_changes ?? []).filter(
  (resource) => resource.change.actions.join(',') !== 'no-op',
)
const collectPlannedResources = (module) => [
  ...(module?.resources ?? []),
  ...(module?.child_modules ?? []).flatMap(collectPlannedResources),
]
const plannedResources = collectPlannedResources(plan.planned_values?.root_module)
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
const appFeedbackSecretAccessAddress =
  'yandex_lockbox_secret_iam_member.push_dispatcher_app_feedback_integrations_reader[0]'
const legacySupabaseBridgeSecretAccessAddress =
  'yandex_lockbox_secret_iam_member.legacy_supabase_bridge_reader[0]'
const postgresSecurityGroupAddress = 'yandex_vpc_security_group.postgres'
const serverlessAvailabilitySubnets = new Map([
  ['yandex_vpc_subnet.serverless["ru-central1-a"]', {
    zone: 'ru-central1-a', cidr: '10.42.1.0/24',
  }],
  ['yandex_vpc_subnet.serverless["ru-central1-b"]', {
    zone: 'ru-central1-b', cidr: '10.42.2.0/24',
  }],
  ['yandex_vpc_subnet.serverless["ru-central1-e"]', {
    zone: 'ru-central1-e', cidr: '10.42.3.0/24',
  }],
])
const legacyDataLensPublicCidrs = [
  '130.193.60.0/28',
  '178.154.242.128/28',
  '178.154.242.144/28',
  '178.154.242.160/28',
  '178.154.242.176/28',
  '178.154.242.192/28',
  '178.154.242.208/28',
]
const pushDispatcherAddress = 'yandex_serverless_container.push_dispatcher'
const pushDispatcherTriggerAddress = 'yandex_function_trigger.push_dispatcher_timer'
const apiImagePullerAddress = 'yandex_container_registry_iam_binding.api_image_puller'
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
const mediaStorageBootstrapAddresses = new Set([
  'yandex_storage_bucket.media',
  'yandex_storage_bucket_iam_binding.media_api_editor',
  'yandex_lockbox_secret.media_s3_credentials',
  'yandex_iam_service_account_static_access_key.api_media',
  'yandex_lockbox_secret_iam_member.api_media_credentials_reader',
  'yandex_lockbox_secret_iam_member.migration_media_credentials_reader',
  'yandex_lockbox_secret_iam_member.deployer_media_credentials_reader[0]',
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

const provisionedInstances = (value) => {
  if (!Array.isArray(value) || value.length === 0) return 0
  if (value.length !== 1) return Number.NaN
  return Number(value[0]?.min_instances)
}

const isExactApiAvailabilityHardening = (resource) =>
  resource.address === 'yandex_serverless_container.api'
  && resource.change.actions.join(',') === 'update'
  && provisionedInstances(resource.change.before?.provision_policy) === 0
  && provisionedInstances(resource.change.after?.provision_policy) === 1

const isExactServerlessAvailabilitySubnetCreate = (resource) => {
  const expected = serverlessAvailabilitySubnets.get(resource.address)
  if (expected === undefined || resource.change.actions.join(',') !== 'create') {
    return false
  }

  const after = resource.change.after ?? {}
  const labels = after.labels ?? {}
  const networkIsBound = (
    typeof after.network_id === 'string' && after.network_id.length > 0
  ) || resource.change.after_unknown?.network_id === true
  const folderIsBound = (
    typeof after.folder_id === 'string' && after.folder_id.length > 0
  ) || resource.change.after_unknown?.folder_id === true
  const emptyOrMissing = (value) => value == null
    || (Array.isArray(value) && value.length === 0)

  return after.name === `fit-stage-serverless-${expected.zone}`
    && after.description === 'Availability subnet required by Serverless Containers'
    && after.zone === expected.zone
    && isDeepStrictEqual(after.v4_cidr_blocks, [expected.cidr])
    && networkIsBound
    && folderIsBound
    && emptyOrMissing(after.v6_cidr_blocks)
    && emptyOrMissing(after.dhcp_options)
    && after.route_table_id == null
    && labels.app === 'fit'
    && labels.environment === 'stage'
    && labels.managed_by === 'terraform'
}

const pushDispatcherServiceAccountId = changes.find(
  (resource) => resource.address === pushDispatcherAddress,
)?.change.after?.service_account_id
  ?? plannedResources.find(
    (resource) => resource.address === pushDispatcherAddress,
  )?.values?.service_account_id

const isExactPushDispatcherImagePullerUpdate = (resource) => {
  if (
    resource.address !== apiImagePullerAddress
    || resource.change.actions.join(',') !== 'update'
    || !isServiceAccountMember(`serviceAccount:${pushDispatcherServiceAccountId ?? ''}`)
  ) return false

  const before = resource.change.before ?? {}
  const after = resource.change.after ?? {}
  const beforeMembers = before.members
  const afterMembers = after.members
  if (
    before.role !== 'container-registry.images.puller'
    || after.role !== before.role
    || !Array.isArray(beforeMembers)
    || !Array.isArray(afterMembers)
    || afterMembers.length !== beforeMembers.length + 1
    || !beforeMembers.every(isServiceAccountMember)
    || !afterMembers.every(isServiceAccountMember)
    || !beforeMembers.every((member) => afterMembers.includes(member))
  ) return false

  const addedMembers = afterMembers.filter((member) => !beforeMembers.includes(member))
  return addedMembers.length === 1
    && addedMembers[0] === `serviceAccount:${pushDispatcherServiceAccountId}`
    && hasOnlyTopLevelChanges(resource, new Set(['id', 'members']))
}

const isExactPushDispatcherTriggerDescriptionUpdate = (resource) =>
  resource.address === pushDispatcherTriggerAddress
  && resource.change.actions.join(',') === 'update'
  && resource.change.before?.description
    === 'Run the private Fit push producer and dispatcher every minute'
  && resource.change.after?.description
    === 'Run private Fit push and app-feedback delivery every minute'
  && hasOnlyTopLevelChanges(resource, new Set(['description']))

const isExactDatabasePublicAccessRemoval = (resource) => {
  if (
    resource.address !== 'yandex_mdb_postgresql_cluster_v2.fit'
    || resource.change.actions.join(',') !== 'update'
    || !hasOnlyTopLevelChanges(resource, new Set(['hosts']))
  ) return false

  const beforeHosts = resource.change.before?.hosts
  const afterHosts = resource.change.after?.hosts
  const beforePrimary = beforeHosts?.primary
  const afterPrimary = afterHosts?.primary
  if (
    beforePrimary?.assign_public_ip !== true
    || afterPrimary?.assign_public_ip !== false
  ) return false

  return isDeepStrictEqual(
    {
      ...beforeHosts,
      primary: { ...beforePrimary, assign_public_ip: false },
    },
    afterHosts,
  )
}

const normalizeSingleNestedBlock = (value) => {
  if (!Array.isArray(value)) return value
  return value.length === 1 ? value[0] : undefined
}

const databaseBackupConfigFields = new Set([
  'backup_retain_period_days',
  'backup_window_start',
])

const isExactDatabaseBackupHardening = (resource) => {
  if (
    resource.address !== 'yandex_mdb_postgresql_cluster_v2.fit'
    || resource.change.actions.join(',') !== 'update'
    || !hasOnlyTopLevelChanges(resource, new Set(['config']))
  ) return false

  const beforeConfig = normalizeSingleNestedBlock(resource.change.before?.config)
  const afterConfig = normalizeSingleNestedBlock(resource.change.after?.config)
  if (
    beforeConfig === null
    || afterConfig === null
    || typeof beforeConfig !== 'object'
    || typeof afterConfig !== 'object'
  ) return false

  const withoutBackupSettings = (config) => Object.fromEntries(
    Object.entries(config).filter(
      ([key]) => !databaseBackupConfigFields.has(key),
    ),
  )
  if (!isDeepStrictEqual(
    withoutBackupSettings(beforeConfig),
    withoutBackupSettings(afterConfig),
  )) return false

  const backupWindow = normalizeSingleNestedBlock(afterConfig.backup_window_start)
  return Number(afterConfig.backup_retain_period_days) === 14
    && Number(backupWindow?.hours) === 0
    && Number(backupWindow?.minutes) === 30
}

const isExactLegacyDataLensIngressRemoval = (resource) => {
  if (
    resource.address !== postgresSecurityGroupAddress
    || resource.change.actions.join(',') !== 'update'
    || !hasOnlyTopLevelChanges(resource, new Set(['ingress']))
  ) return false

  const beforeIngress = resource.change.before?.ingress
  const afterIngress = resource.change.after?.ingress
  if (
    !Array.isArray(beforeIngress)
    || !Array.isArray(afterIngress)
    || afterIngress.length !== beforeIngress.length - 1
    || !afterIngress.every((rule) =>
      beforeIngress.some((candidate) => isDeepStrictEqual(candidate, rule)))
  ) return false

  const removed = beforeIngress.filter((rule) =>
    !afterIngress.some((candidate) => isDeepStrictEqual(candidate, rule)))
  if (removed.length !== 1) return false

  const rule = removed[0]
  return rule.description === 'Yandex DataLens public PostgreSQL connector'
    && rule.protocol === 'TCP'
    && Number(rule.port) === 6432
    && Number(rule.from_port) === -1
    && Number(rule.to_port) === -1
    && isDeepStrictEqual(
      [...(rule.v4_cidr_blocks ?? [])].sort(),
      legacyDataLensPublicCidrs,
    )
    && Array.isArray(rule.v6_cidr_blocks)
    && rule.v6_cidr_blocks.length === 0
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

const isReviewedMediaStorageBootstrap = (resource) => {
  if (
    !allowMediaStorageBootstrap
    || !mediaStorageBootstrapAddresses.has(resource.address)
    || resource.change.actions.join(',') !== 'create'
  ) return false
  const after = resource.change.after ?? {}
  if (resource.address === 'yandex_storage_bucket.media') {
    const anonymous = after.anonymous_access_flags?.[0]
    const versioning = after.versioning?.[0]
    const lifecycle = after.lifecycle_rule?.[0]
    return /^fit-(stage|prod)-media-[a-z0-9]{8}$/u.test(after.bucket ?? '')
      && after.default_storage_class === 'STANDARD'
      && after.force_destroy === false
      && anonymous?.read === false
      && anonymous?.list === false
      && anonymous?.config_read === false
      && versioning?.enabled === true
      && lifecycle?.enabled === true
      && Number(lifecycle?.abort_incomplete_multipart_upload_days) === 7
  }
  if (resource.address === 'yandex_storage_bucket_iam_binding.media_api_editor') {
    return after.role === 'storage.editor'
      && Array.isArray(after.members)
      && after.members.length === 1
      && (
        isServiceAccountMember(after.members[0])
        || resource.change.after_unknown?.members === true
        || resource.change.after_unknown?.members?.[0] === true
      )
  }
  if (resource.address === 'yandex_lockbox_secret.media_s3_credentials') {
    return /^fit-(stage|prod)-media-s3$/u.test(after.name ?? '')
      && after.deletion_protection === true
  }
  if (resource.address === 'yandex_iam_service_account_static_access_key.api_media') {
    const output = after.output_to_lockbox?.[0]
    return typeof after.service_account_id === 'string'
      && after.service_account_id.length > 0
      && output?.entry_for_access_key === 'YANDEX_MEDIA_ACCESS_KEY_ID'
      && output?.entry_for_secret_key === 'YANDEX_MEDIA_SECRET_ACCESS_KEY'
  }
  return after.role === 'lockbox.payloadViewer'
    && isKnownOrComputedServiceAccountMember(resource)
}

const changesContainerCostOrIdentity = (resource) =>
  costSensitiveContainerFields.some(
    (field) =>
      !(field === 'execution_timeout' && hasBoundedApiExecutionTimeout(resource))
      && !(field === 'provision_policy' && isExactApiAvailabilityHardening(resource))
      &&
      JSON.stringify(resource.change.before?.[field])
      !== JSON.stringify(resource.change.after?.[field]),
  )

const isAutomaticStageChange = (resource) => {
  const actions = resource.change.actions.join(',')
  if (isReviewedPushPipelineBootstrap(resource)) return true
  if (isReviewedMediaStorageBootstrap(resource)) return true
  if (actions === 'create') {
    return isExactServerlessAvailabilitySubnetCreate(resource)
      || isExactPublicApiBinding(resource)
      || (
        resource.address === runtimePreflightSecretAccessAddress
        && resource.change.after?.role === 'lockbox.payloadViewer'
        && /^serviceAccount:[a-z0-9]+$/u.test(resource.change.after?.member ?? '')
      )
      || (
        resource.address === appFeedbackSecretAccessAddress
        && resource.change.after?.role === 'lockbox.payloadViewer'
        && isKnownOrComputedServiceAccountMember(resource)
      )
      || (
        resource.address === legacySupabaseBridgeSecretAccessAddress
        && resource.change.after?.role === 'lockbox.payloadViewer'
        && isKnownOrComputedServiceAccountMember(resource)
      )
  }
  if (actions !== 'update') {
    return false
  }
  if (isExactPublicApiBinding(resource)) {
    return true
  }
  if (
    isExactPushDispatcherImagePullerUpdate(resource)
    || isExactPushDispatcherTriggerDescriptionUpdate(resource)
    || isExactDatabasePublicAccessRemoval(resource)
    || isExactDatabaseBackupHardening(resource)
    || isExactLegacyDataLensIngressRemoval(resource)
  ) {
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
const includesMediaStorageBootstrap = changes.some(
  (resource) => mediaStorageBootstrapAddresses.has(resource.address)
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
const mediaStorageCostSummary = includesMediaStorageBootstrap
  ? [
      '### Private media storage bootstrap cost estimate',
      '',
      '- One protected Lockbox version: about 19.73 RUB/month plus payload reads.',
      '- Standard Object Storage: first 1 GB, 10,000 writes/list calls and 100,000 reads per month are free.',
      '- Usage above the free tier and outgoing traffic are billed at current Yandex Cloud rates.',
      '- Apply remains blocked until `approve_media_storage=true` is supplied manually.',
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
  ...mediaStorageCostSummary,
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
