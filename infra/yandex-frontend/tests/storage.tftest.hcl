mock_provider "yandex" {}

run "disabled_by_default" {
  command = plan
  assert {
    condition     = length(yandex_storage_bucket.frontend) == 0
    error_message = "Preparation must not create infrastructure by default."
  }
}

run "private_storage_only" {
  command = plan
  variables {
    enabled     = true
    folder_id   = "test-folder"
    bucket_name = "fit-frontend-test"
  }
  assert {
    condition     = !one(yandex_storage_bucket.frontend[0].anonymous_access_flags).read && !one(yandex_storage_bucket.frontend[0].anonymous_access_flags).list && !one(yandex_storage_bucket.frontend[0].anonymous_access_flags).config_read
    error_message = "Preparation must not grant anonymous access."
  }
  assert {
    condition     = yandex_storage_bucket.frontend[0].versioning[0].enabled && !yandex_storage_bucket.frontend[0].force_destroy
    error_message = "Release storage must retain recoverability."
  }
}

run "reject_missing_configuration" {
  command = plan
  variables {
    enabled = true
  }
  expect_failures = [yandex_storage_bucket.frontend]
}
