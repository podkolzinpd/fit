resource "yandex_container_registry" "fit" {
  folder_id = var.folder_id
  name      = "${local.name_prefix}-registry"
  labels    = local.labels
}

resource "yandex_container_repository" "api" {
  name = "${yandex_container_registry.fit.id}/api"
}

resource "yandex_container_registry_iam_binding" "api_image_puller" {
  registry_id = yandex_container_registry.fit.id
  role        = "container-registry.images.puller"
  members = [
    "serviceAccount:${yandex_iam_service_account.api.id}",
    "serviceAccount:${yandex_iam_service_account.migration.id}",
  ]
}

resource "yandex_container_repository_lifecycle_policy" "api" {
  name          = "${local.name_prefix}-api-retention"
  repository_id = yandex_container_repository.api.id
  status        = "active"

  rule {
    description   = "Keep the latest ten immutable API content images"
    tag_regexp    = "^[0-9a-f]{40}$"
    retained_top  = 10
    expire_period = "168h"
  }

  rule {
    description   = "Remove stale untagged layers"
    untagged      = true
    retained_top  = 3
    expire_period = "168h"
  }
}
