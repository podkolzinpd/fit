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
