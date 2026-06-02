variable "publishable_key" {
  type        = string
  description = "Clerk publishable key (pk_live_… or pk_test_…). Safe to expose to the browser."
}

variable "secret_key" {
  type        = string
  description = "Clerk secret key (sk_live_… or sk_test_…). Backend only — never expose to the browser."
  sensitive   = true
}

variable "env" {
  type        = string
  description = "Environment label (prod/staging) — used for output naming and validation."

  validation {
    condition     = contains(["prod", "staging"], var.env)
    error_message = "env must be 'prod' or 'staging'."
  }
}
