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
