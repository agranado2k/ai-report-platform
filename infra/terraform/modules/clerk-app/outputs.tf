output "publishable_key" {
  value       = var.publishable_key
  description = "Clerk publishable key (pass-through from variable)."
}

output "secret_key" {
  value       = var.secret_key
  description = "Clerk secret key (pass-through from variable)."
  sensitive   = true
}

# Validation that the key prefix matches the env. Catches the easy "pasted
# the test key into prod" mistake at plan time.
locals {
  expected_prefix_pub = var.env == "prod" ? "pk_live_" : "pk_test_"
  expected_prefix_sec = var.env == "prod" ? "sk_live_" : "sk_test_"
}

check "key_prefix_matches_env" {
  assert {
    condition     = startswith(var.publishable_key, local.expected_prefix_pub)
    error_message = "Publishable key for env=${var.env} should start with '${local.expected_prefix_pub}'. Did you paste the wrong env's key into .tfvars.local?"
  }
  assert {
    condition     = startswith(var.secret_key, local.expected_prefix_sec)
    error_message = "Secret key for env=${var.env} should start with '${local.expected_prefix_sec}'."
  }
}
