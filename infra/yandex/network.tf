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

# Serverless Containers distributes invocations across the regular cloud
# availability zones. A network attached to a container must therefore have a
# subnet in every such zone. Keep the existing database subnet address stable
# and add dedicated, empty subnets for the remaining zones.
locals {
  serverless_availability_zone_cidrs = {
    "ru-central1-a" = "10.42.1.0/24"
    "ru-central1-b" = "10.42.2.0/24"
    "ru-central1-e" = "10.42.3.0/24"
  }
}

resource "yandex_vpc_subnet" "serverless" {
  for_each = local.serverless_availability_zone_cidrs

  folder_id      = var.folder_id
  name           = "${local.name_prefix}-serverless-${each.key}"
  description    = "Availability subnet required by Serverless Containers"
  zone           = each.key
  network_id     = yandex_vpc_network.fit.id
  v4_cidr_blocks = [each.value]
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
