locals {
  name_prefix = "fit-${var.environment}"
  labels = {
    app         = "fit"
    environment = var.environment
    managed_by  = "terraform"
  }
}
