import { S3ServiceException } from '@aws-sdk/client-s3'

const storageCodes = new Set([
  'AccessDenied', 'InvalidAccessKeyId', 'SignatureDoesNotMatch', 'NoSuchBucket',
  'NoSuchBucketPolicy', 'NotFound', 'InvalidRequest', 'InvalidBucketName',
  'InvalidLocationConstraint', 'IllegalLocationConstraintException',
  'NotImplemented', 'RequestTimeout', 'ServiceUnavailable',
])
const localCodes = new Set([
  'backup_target_rejected', 'backup_configuration_rejected', 'backup_attempt_rejected',
  'backup_bucket_not_private', 'backup_mode_rejected', 'backup_encryption_key_rejected',
  'backup_database_missing', 'backup_size_limit_exceeded', 'backup_readback_failed',
  'backup_checksum_failed', 'backup_decryption_failed',
  'cloudru_media_public_acl_rejected', 'cloudru_bucket_policy_requires_review',
  'media_configuration_rejected', 'media_versioning_not_enabled', 'media_object_rejected',
  'media_read_failed', 'media_size_mismatch', 'media_inventory_incomplete',
])

// Never serialize the SDK error: messages, resource names and request metadata
// can contain credentials or private object paths. Only reviewed codes escape.
export function cloudruStorageFailure(error: unknown): { reason: string; httpStatus?: number } {
  const reason = error instanceof Error && storageCodes.has(error.name) ? error.name
    : error instanceof Error && localCodes.has(error.message) ? error.message : 'storage_operation_failed'
  const status = error instanceof S3ServiceException ? error.$metadata.httpStatusCode : undefined
  return { reason, ...(status !== undefined && Number.isInteger(status) && status >= 400 && status <= 599
    ? { httpStatus: status } : {}) }
}
