import { readFileSync } from 'node:fs'
import process from 'node:process'

const planPath = process.argv[2]
const allowDestroy = process.argv.includes('--allow-destroy')

if (planPath === undefined) {
  throw new Error('Usage: check-yandex-terraform-plan.mjs <plan.json> [--allow-destroy]')
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
const publicApi = changes.find(
  (resource) =>
    resource.address === 'yandex_serverless_container_iam_binding.api_invocation'
    && resource.change.after?.members?.includes('system:allUsers'),
)

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
if (publicApi !== undefined) {
  throw new Error('Public API invocation is outside the stage deployment workflow')
}
if (destructive.length > 0 && !allowDestroy) {
  throw new Error(
    'Terraform plan contains delete or replacement actions; use the reviewed manual override',
  )
}
