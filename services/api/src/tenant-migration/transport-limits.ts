// Yandex Serverless Containers accepts at most 3.5 MB for the complete HTTP
// request. Keep explicit room for headers while allowing the current complete
// cohort snapshot to stay atomic in a single request.
export const STAGE_TENANT_ARTIFACT_LIMIT_BYTES = 3_400_000
