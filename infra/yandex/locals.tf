locals {
  name_prefix           = "fit-${var.environment}"
  database_name         = "fit"
  database_owner_user   = "fit_owner"
  database_runtime_user = "fit_api"
  media_bucket_name = (
    var.media_bucket_override == null || trimspace(var.media_bucket_override) == ""
    ? yandex_storage_bucket.media.bucket
    : trimspace(var.media_bucket_override)
  )
  media_s3_secret_id = (
    var.media_s3_credentials_override == null
    ? yandex_lockbox_secret.media_s3_credentials.id
    : var.media_s3_credentials_override.secret_id
  )
  media_s3_secret_version_id = (
    var.media_s3_credentials_override == null
    ? yandex_iam_service_account_static_access_key.api_media.output_to_lockbox_version_id
    : var.media_s3_credentials_override.version_id
  )
  labels = {
    app         = "fit"
    environment = var.environment
    managed_by  = "terraform"
  }
}
