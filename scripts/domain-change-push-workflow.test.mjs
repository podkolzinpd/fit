import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const workflowUrl = new URL(
  '../.github/workflows/manage-domain-change-push.yml',
  import.meta.url,
)

test('domain-change push workflow is manual, main-only, and confirmation-gated', async () => {
  const workflow = await readFile(workflowUrl, 'utf8')

  assert.match(workflow, /^on:\n  workflow_dispatch:$/m)
  assert.match(workflow, /test "\$GITHUB_REF" = 'refs\/heads\/main'/)
  assert.match(workflow, /QUEUE_DOMAIN_CHANGE_ANNOUNCEMENT/)
  assert.match(workflow, /options:\n          - inspect\n          - enqueue/)
  assert.match(workflow, /\/stage\/push\/domain-change-announcement/)
  assert.match(workflow, /\.inserted == 0/)
  assert.doesNotMatch(workflow, /schedule:/)
})

test('Cloud.ru recovery sends only reviewed copy from main on the trusted runner', async () => {
  const workflow = await readFile(new URL('../.github/workflows/manage-cloudru-recovery-push.yml', import.meta.url), 'utf8')
  assert.match(workflow, /workflow_dispatch:/)
  assert.doesNotMatch(workflow, /schedule:|^  push:|pull_request:/m)
  assert.match(workflow, /runs-on: \[self-hosted, cloudru-stage\]/)
  assert.match(workflow, /test "\$GITHUB_REF" = refs\/heads\/main/)
  assert.match(workflow, /SEND_FIT_RECOVERY_2026_10_14/)
  assert.match(workflow, /group: cloudru-stage-vm/)
  assert.match(workflow, /--read-only --network=host --cap-drop=ALL/)
  assert.match(workflow, /MIGRATION_DATABASE_SSL_MODE=require/)
  assert.match(workflow, /VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY VAPID_SUBJECT/)
  assert.match(workflow, /test "\$value" = "\$EXPECTED_VAPID_PUBLIC_KEY"/)
  assert.ok(workflow.indexOf('test "$value" = "$EXPECTED_VAPID_PUBLIC_KEY"') < workflow.indexOf('run_campaign enqueue'))
  assert.match(workflow, /::add-mask::\$value/)
  assert.match(workflow, /trap 'rm -f "\$runtime_file"' EXIT/)
  assert.doesNotMatch(workflow, /serverless function|PUSH_DISPATCH_SECRET|generateVAPIDKeys/)
  assert.doesNotMatch(workflow, /lockbox secret (?:create|add-version|add-access-binding)|allow-unauthenticated|terraform apply/)
  assert.match(workflow, /Title: ФИТ снова работает 💪/)
  assert.match(workflow, /Body: Всё починили\. Возвращайтесь к тренировкам!/)
})

test('recovery frees only dangling image cache before checkout on a low-disk send', async () => {
  const workflow = await readFile(new URL('../.github/workflows/manage-cloudru-recovery-push.yml', import.meta.url), 'utf8')
  assert.match(workflow, /test "\$ACTION" = send && test "\$available_kib" -lt 524288/)
  assert.match(workflow, /sudo podman image prune --force\n/)
  assert.ok(workflow.indexOf('test "$(hostname)" = fit-stage-app') < workflow.indexOf('sudo podman image prune'))
  assert.ok(workflow.indexOf('sudo podman image prune') < workflow.indexOf('uses: actions/checkout'))
  assert.match(workflow, /test "\$available_kib" -ge 524288/)
  assert.doesNotMatch(workflow, /prune[^\n]*(?:--all|--volumes)|podman (?:system|volume) prune|rm -r[f ]/)
})

test('email audit uses GET and a read-only transaction and skips all delivery steps', async () => {
  const workflow = await readFile(new URL('../.github/workflows/manage-cloudru-recovery-push.yml', import.meta.url), 'utf8')
  const audit = await readFile(new URL('../services/api/src/email-audience-audit.ts', import.meta.url), 'utf8')
  assert.match(workflow, /options: \[inspect, send, email-audit\]/)
  assert.match(workflow, /inspect\|email-audit\) test -z/)
  assert.match(workflow, /if: inputs.action == 'email-audit'/)
  assert.match(workflow, /if: inputs.action != 'email-audit'/)
  assert.match(audit, /method: 'GET', redirect: 'error'/)
  assert.match(audit, /repeatable read read only/)
  assert.match(audit, /sentEmails: 0/)
  assert.doesNotMatch(audit, /console\.(?:log|error)\((?:users|keys|token|key|auth)\)|sendNotification|sendMail|writeFile/)
  assert.match(audit, /private source details suppressed/)
})
