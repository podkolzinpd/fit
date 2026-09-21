resource "yandex_function_trigger" "api_warmup_timer" {
  folder_id   = var.folder_id
  name        = "${local.name_prefix}-api-warmup"
  description = "Keep the provisioned Fit API runtime responsive with a side-effect-free request"
  labels      = local.labels

  timer {
    cron_expression = "* * * * ? *"
    payload         = "fit-api-warmup"
  }

  container {
    id                 = yandex_serverless_container.api.id
    path               = "/internal/warmup"
    service_account_id = yandex_iam_service_account.api_warmer.id
    retry_attempts     = 2
    retry_interval     = 10
  }

  depends_on = [
    yandex_iam_service_account_iam_member.api_warmer_deployer,
    yandex_serverless_container_iam_binding.api_invocation,
  ]
}
