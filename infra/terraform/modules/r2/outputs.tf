output "buckets" {
  value       = { for k, v in cloudflare_r2_bucket.this : k => v.name }
  description = "Map of input name → actual bucket name (same value; kept as a map for symmetry)."
}

output "endpoint" {
  value       = "https://${var.account_id}.r2.cloudflarestorage.com"
  description = "S3-compatible endpoint URL. Same for all buckets in this account."
}
