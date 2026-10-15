import { readFileSync } from 'node:fs'
import process from 'node:process'
import { isDeepStrictEqual } from 'node:util'

const containerAddress = 'yandex_serverless_container.migration[0]'
const bindingAddress = 'yandex_serverless_container_iam_binding.migration_invocation[0]'

function argument(name) {
  const index = process.argv.indexOf(name)
  const value = index === -1 ? undefined : process.argv[index + 1]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing ${name}`)
  }
  return value
}

function resources(module) {
  return [
    ...(module?.resources ?? []),
    ...(module?.child_modules ?? []).flatMap(resources),
  ]
}

function durationSeconds(value) {
  if (typeof value !== 'string') return NaN
  const match = /^(?:(\d{1,4})h)?(?:(\d{1,4})m)?(?:(\d{1,4})s)?$/.exec(value)
  if (!match || !match.slice(1).some(Boolean)) return NaN
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0)
}

const plan = JSON.parse(readFileSync(argument('--plan'), 'utf8'))
const imageTag = argument('--image-tag')
const imageRepository = argument('--image-repository')
const changed = (plan.resource_changes ?? []).filter(
  (resource) => resource.change.actions.join(',') !== 'no-op',
)
const permitted = new Set([containerAddress, bindingAddress])

// Terraform marks a -target plan incomplete because unrelated resources are omitted.
// This recovery workflow deliberately targets only the private runner and binding.
if (typeof plan.complete !== 'boolean' || plan.errored === true || plan.applyable !== true) {
  throw new Error('Migration-only Terraform plan must be valid and applyable')
}
if (changed.some((resource) => !permitted.has(resource.address))) {
  throw new Error(`Migration-only plan includes unexpected resources: ${changed.map((resource) => resource.address).join(', ')}`)
}
if (changed.some((resource) => resource.change.actions.includes('delete') || resource.change.actions.includes('replace'))) {
  throw new Error('Migration-only plan must not delete or replace resources')
}
if (changed.some((resource) => resource.address === bindingAddress)) {
  throw new Error('Migration invocation binding drift requires normal Terraform reconciliation')
}
if (changed.some((resource) => resource.address === containerAddress && resource.change.actions.join(',') !== 'update')) {
  throw new Error('Migration container may only receive an in-place revision update')
}
const containerChange = changed.find((resource) => resource.address === containerAddress)?.change
if (containerChange) {
  const withoutRevisionImage = (value) => ({
    ...value,
    revision_id: undefined,
    image: value?.image?.map((entry) => ({ ...entry, url: undefined })),
  })
  if (!isDeepStrictEqual(
    withoutRevisionImage(containerChange.before),
    withoutRevisionImage(containerChange.after),
  )) {
    throw new Error('Migration-only plan changes runner configuration beyond the image revision')
  }
}

const planned = resources(plan.planned_values?.root_module)
const container = planned.find((resource) => resource.address === containerAddress)?.values
const binding = planned.find((resource) => resource.address === bindingAddress)?.values
const image = Array.isArray(container?.image) ? container.image[0] : undefined
const contract = {
  'container.concurrency': container?.concurrency === 1,
  'container.execution_timeout': durationSeconds(container?.execution_timeout) === 300,
  'container.memory': container?.memory === 512,
  'container.cores': container?.cores === 1,
  'container.core_fraction': container?.core_fraction === 100,
  'image.url': image?.url === `${imageRepository}:${imageTag}`,
  'image.command': JSON.stringify(image?.command) === JSON.stringify(['node', 'dist/migration-server.js']),
  'image.environment.APP_ENV': image?.environment?.APP_ENV === 'stage',
  'binding.role': binding?.role === 'serverless.containers.invoker',
  'binding.members': Array.isArray(binding?.members)
    && binding.members.length === 1
    && !binding.members.includes('system:allUsers'),
}
const failed = Object.entries(contract).filter(([, valid]) => !valid).map(([name]) => name)
if (failed.length > 0) {
  throw new Error(`Migration-only plan does not preserve the reviewed private runner contract: ${failed.join(', ')}`)
}

const summary = [
  '## Guarded migration-container-only plan',
  '',
  `Image tag: \`${imageTag}\``,
  `Changed resources: ${changed.length}`,
  '',
  ...changed.map((resource) => `- \`${resource.address}\`: ${resource.change.actions.join(', ')}`),
  '',
  'The workflow does not apply Terraform state, update triggers, deploy the public API, or switch traffic.',
].join('\n')
process.stdout.write(`${summary}\n`)
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs')
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`)
}
