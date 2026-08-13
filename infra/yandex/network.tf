resource "yandex_vpc_network" "fit" {
  folder_id   = var.folder_id
  name        = "${local.name_prefix}-network"
  description = "Private network for Fit API and PostgreSQL"
  labels      = local.labels
}

resource "yandex_vpc_subnet" "fit" {
  folder_id      = var.folder_id
  name           = "${local.name_prefix}-subnet"
  description    = "Private subnet for Fit managed services"
  zone           = var.zone
  network_id     = yandex_vpc_network.fit.id
  v4_cidr_blocks = [var.subnet_cidr]
  labels         = local.labels
}

resource "yandex_vpc_security_group" "postgres" {
  folder_id   = var.folder_id
  name        = "${local.name_prefix}-postgres"
  description = "Allow PostgreSQL only from the Fit private subnet"
  network_id  = yandex_vpc_network.fit.id
  labels      = local.labels

  ingress {
    protocol       = "TCP"
    description    = "Odyssey PostgreSQL pooler from private subnet"
    v4_cidr_blocks = [var.subnet_cidr]
    port           = 6432
  }

  ingress {
    protocol       = "TCP"
    description    = "Odyssey PostgreSQL pooler from Serverless Containers service network"
    v4_cidr_blocks = [var.serverless_service_cidr]
    port           = 6432
  }

  egress {
    protocol       = "ANY"
    description    = "Response and managed service traffic"
    v4_cidr_blocks = ["0.0.0.0/0"]
  }
}
