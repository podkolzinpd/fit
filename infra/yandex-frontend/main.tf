terraform {
  required_version = ">= 1.9.0"
  required_providers {
    yandex = {
      source  = "yandex-cloud/yandex"
      version = "~> 0.215.0"
    }
  }
}

# Independent root: never included in infra/yandex's production state.
variable "enabled" {
  type        = bool
  default     = false
  description = "Create storage only after separate infrastructure approval."
}

variable "folder_id" {
  type    = string
  default = ""
}

variable "bucket_name" {
  type    = string
  default = ""
}

resource "yandex_storage_bucket" "frontend" {
  count         = var.enabled ? 1 : 0
  folder_id     = var.folder_id
  bucket        = var.bucket_name
  force_destroy = false
  max_size      = 10737418240

  anonymous_access_flags {
    read        = false
    list        = false
    config_read = false
  }

  versioning {
    enabled = true
  }

  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = length(var.folder_id) > 0 && can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.bucket_name))
      error_message = "Explicit folder_id and valid bucket_name are required before enabling storage."
    }
  }
}

output "bucket_name" {
  value = one(yandex_storage_bucket.frontend[*].bucket)
}
