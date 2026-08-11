resource "yandex_serverless_container" "api" {
  folder_id          = var.folder_id
  name               = "${local.name_prefix}-api"
  description        = "Fit Node.js API"
  memory             = var.api_memory_mb
  cores              = 1
  core_fraction      = 100
  concurrency        = var.api_concurrency
  execution_timeout  = "30s"
  service_account_id = yandex_iam_service_account.api.id
  labels             = local.labels

  runtime {
    type = "http"
  }

  connectivity {
    network_id = yandex_vpc_network.fit.id
  }

  image {
    url = "cr.yandex/${yandex_container_repository.api.name}:${var.api_image_tag}"
    environment = {
      APP_ENV   = var.environment
      LOG_LEVEL = "info"
    }
  }

  dynamic "secrets" {
    for_each = var.database_url_secret_version_id == null ? [] : [var.database_url_secret_version_id]

    content {
      id                   = yandex_lockbox_secret.database_url.id
      version_id           = secrets.value
      key                  = "DATABASE_URL"
      environment_variable = "DATABASE_URL"
    }
  }

  log_options {
    folder_id = var.folder_id
    min_level = "INFO"
  }

  depends_on = [
    yandex_container_registry_iam_binding.api_image_puller,
    yandex_lockbox_secret_iam_member.api_lockbox_reader,
  ]
}

resource "yandex_serverless_container_iam_binding" "public_invocation" {
  count = var.allow_unauthenticated_api ? 1 : 0

  container_id = yandex_serverless_container.api.id
  role         = "serverless.containers.invoker"
  members      = ["system:allUsers"]
}
