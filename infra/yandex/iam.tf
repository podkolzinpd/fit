resource "yandex_iam_service_account" "api" {
  folder_id   = var.folder_id
  name        = "${local.name_prefix}-api"
  description = "Runtime identity for the Fit Serverless Container"
}

resource "yandex_iam_service_account" "migration" {
  folder_id   = var.folder_id
  name        = "${local.name_prefix}-migration"
  description = "Temporary runtime identity for reviewed PostgreSQL migrations"
}

resource "yandex_iam_service_account_iam_member" "deployer_self_use" {
  count = var.deployer_member == null ? 0 : 1

  service_account_id = split(":", var.deployer_member)[1]
  role               = "iam.serviceAccounts.user"
  member             = var.deployer_member
}

resource "yandex_iam_service_account_iam_member" "api_deployer" {
  count = var.deployer_member == null ? 0 : 1

  service_account_id = yandex_iam_service_account.api.id
  role               = "iam.serviceAccounts.user"
  member             = var.deployer_member
}

resource "yandex_iam_service_account_iam_member" "migration_deployer" {
  count = var.deployer_member == null ? 0 : 1

  service_account_id = yandex_iam_service_account.migration.id
  role               = "iam.serviceAccounts.user"
  member             = var.deployer_member
}
