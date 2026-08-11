terraform {
  required_version = ">= 1.8.0"

  required_providers {
    yandex = {
      source  = "yandex-cloud/yandex"
      version = "~> 0.215.0"
    }
  }
}
