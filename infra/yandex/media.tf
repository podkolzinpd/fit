resource "yandex_storage_bucket" "media" {
  bucket                = "${local.name_prefix}-media-${substr(var.folder_id, 0, 8)}"
  folder_id             = var.folder_id
  default_storage_class = "STANDARD"
  force_destroy         = false

  anonymous_access_flags {
    read        = false
    list        = false
    config_read = false
  }

  versioning {
    enabled = true
  }

  lifecycle_rule {
    id                                     = "abort-incomplete-uploads"
    enabled                                = true
    prefix                                 = ""
    abort_incomplete_multipart_upload_days = 7
  }
}

resource "yandex_storage_bucket_iam_binding" "media_api_editor" {
  bucket = yandex_storage_bucket.media.bucket
  role   = "storage.editor"
  members = [
    "serviceAccount:${yandex_iam_service_account.api.id}",
  ]
}

resource "yandex_lockbox_secret" "media_s3_credentials" {
  folder_id           = var.folder_id
  name                = "${local.name_prefix}-media-s3"
  description         = "S3 credentials for the private Fit media bucket"
  deletion_protection = true
  labels              = local.labels
}

resource "yandex_iam_service_account_static_access_key" "api_media" {
  service_account_id = yandex_iam_service_account.api.id
  description        = "Private Fit media bucket access"

  output_to_lockbox {
    secret_id            = yandex_lockbox_secret.media_s3_credentials.id
    entry_for_access_key = "YANDEX_MEDIA_ACCESS_KEY_ID"
    entry_for_secret_key = "YANDEX_MEDIA_SECRET_ACCESS_KEY"
  }

  depends_on = [yandex_storage_bucket_iam_binding.media_api_editor]
}

resource "yandex_lockbox_secret_iam_member" "api_media_credentials_reader" {
  secret_id = yandex_lockbox_secret.media_s3_credentials.id
  role      = "lockbox.payloadViewer"
  member    = "serviceAccount:${yandex_iam_service_account.api.id}"
}

resource "yandex_lockbox_secret_iam_member" "migration_media_credentials_reader" {
  secret_id = yandex_lockbox_secret.media_s3_credentials.id
  role      = "lockbox.payloadViewer"
  member    = "serviceAccount:${yandex_iam_service_account.migration.id}"
}

resource "yandex_lockbox_secret_iam_member" "deployer_media_credentials_reader" {
  count = var.deployer_member == null ? 0 : 1

  secret_id = yandex_lockbox_secret.media_s3_credentials.id
  role      = "lockbox.payloadViewer"
  member    = var.deployer_member
}
