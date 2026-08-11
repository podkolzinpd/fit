resource "yandex_mdb_postgresql_cluster_v2" "fit" {
  folder_id           = var.folder_id
  name                = "${local.name_prefix}-postgres"
  description         = "Fit application database in the Russian region"
  environment         = var.environment == "prod" ? "PRODUCTION" : "PRESTABLE"
  network_id          = yandex_vpc_network.fit.id
  security_group_ids  = [yandex_vpc_security_group.postgres.id]
  deletion_protection = var.postgres_deletion_protection
  labels              = local.labels

  config {
    version = var.postgres_version

    resources {
      resource_preset_id = var.postgres_resource_preset_id
      disk_type_id       = "network-ssd"
      disk_size          = var.postgres_disk_size_gb
    }

    access = {
      data_lens     = false
      data_transfer = false
      serverless    = true
      web_sql       = false
    }

    pooler_config = {
      pooling_mode = "SESSION"
      pool_discard = false
    }
  }

  hosts = {
    primary = {
      zone             = var.zone
      subnet_id        = yandex_vpc_subnet.fit.id
      assign_public_ip = false
    }
  }

  maintenance_window = {
    type = "WEEKLY"
    day  = "SUN"
    hour = 2
  }
}

resource "yandex_lockbox_secret" "database_url" {
  folder_id   = var.folder_id
  name        = "${local.name_prefix}-database-url"
  description = "DATABASE_URL for the Fit API; payload is managed outside Terraform"
  labels      = local.labels
}

resource "yandex_lockbox_secret_iam_member" "api_lockbox_reader" {
  secret_id = yandex_lockbox_secret.database_url.id
  role      = "lockbox.payloadViewer"
  member    = "serviceAccount:${yandex_iam_service_account.api.id}"
}
