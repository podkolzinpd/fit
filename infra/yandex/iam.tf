resource "yandex_iam_service_account" "api" {
  folder_id   = var.folder_id
  name        = "${local.name_prefix}-api"
  description = "Runtime identity for the Fit Serverless Container"
}
