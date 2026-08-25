# Yandex assistant function bootstrap

The production deploy workflow only creates an immutable function version and
verifies it. It deliberately does not mutate folder IAM, Lockbox access, or
the public invoker binding on every release.

Run the one-time bootstrap with an approved deployment identity, after
verifying the target folder, function and runtime service account. The exact
commands are intentionally executed by an operator with the project’s normal
Yandex Cloud approval flow; no credentials or secret values belong in this
repository.

Required bindings:

- deploy service account: `serverless.functions.admin` on the target folder;
- runtime service account: `ai.languageModels.user` on the target folder;
- runtime service account: `lockbox.payloadViewer` on the assistant Lockbox;
- function: `serverless.functions.invoker` for the intended public endpoint.

After bootstrap, verify that an unauthenticated `POST {}` returns `401`, then
run the normal deploy workflow. Every version must mount an explicit immutable
Lockbox `version-id`; rotating a shared Lockbox requires a coordinated release
of all consumers and a new candidate verification.
