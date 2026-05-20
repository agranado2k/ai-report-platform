# Terraform state backend: Cloudflare R2 via the S3-compatible API.
#
# Per-env values (`key`, `endpoints`) are NOT set here. They're injected at
# `terraform init` time by `scripts/tf.sh`, which generates a backend config
# file under `/tmp` so the same backend.tf works for prod / staging / shared.
#
# Locking: R2 has no DynamoDB-equivalent, so the standard `dynamodb_table`
# lock isn't available. `scripts/tf.sh` acquires a Postgres advisory lock on
# Neon (`pg_advisory_lock(hashtext('tf-' || $env))`) before invoking
# `terraform plan|apply|destroy` and releases on exit. ADR-018.
#
# Bootstrap: the `tf-state` R2 bucket must exist BEFORE the first
# `terraform init`. Create it manually in the Cloudflare dashboard
# (versioning ENABLED, public access DISABLED). See docs/infra.md.

terraform {
  required_version = ">= 1.6.0"

  backend "s3" {
    # Bucket is the same across envs; `key` differentiates state files.
    bucket = "tf-state"
    region = "auto"

    # R2 emulates the S3 API but doesn't implement everything the AWS SDK
    # validates by default. These flags disable the AWS-specific checks.
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    use_path_style              = true

    # `key`       — injected by tf.sh, one of: prod.tfstate | staging.tfstate | shared.tfstate
    # `endpoints` — injected by tf.sh:  { s3 = "https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com" }
  }
}
