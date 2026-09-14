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
  labels = {
    app         = "fit"
    environment = var.environment
    managed_by  = "terraform"
  }
}
