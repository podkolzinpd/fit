resource "yandex_serverless_container_iam_binding" "push_dispatcher_invocation" {
  container_id = yandex_serverless_container.push_dispatcher.id
  role         = "serverless.containers.invoker"
  members = compact([
    var.deployer_member,
    var.push_scheduler_invoker_service_account_id == null
    ? null
    : "serviceAccount:${var.push_scheduler_invoker_service_account_id}",
  ])
}

resource "yandex_function_trigger" "push_dispatcher_timer" {
  folder_id   = var.folder_id
  name        = "${local.name_prefix}-push-dispatcher"
  description = "Run the private Fit push producer and dispatcher every minute"
  labels      = local.labels

  timer {
    cron_expression = "* * * * ? *"
    payload         = "sync-push-notifications"
  }

  container {
    id                 = yandex_serverless_container.push_dispatcher.id
    path               = "/internal/push/dispatch"
    service_account_id = yandex_iam_service_account.push_scheduler.id
    retry_attempts     = 1
    retry_interval     = 10
  }

  depends_on = [
    yandex_iam_service_account_iam_member.push_scheduler_deployer,
    yandex_serverless_container_iam_binding.push_dispatcher_invocation,
  ]
}
