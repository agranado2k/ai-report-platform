terraform {
  required_version = ">= 1.6.0"

  required_providers {
    cloudflare = { source = "cloudflare/cloudflare", version = "~> 4.40" }
    github     = { source = "integrations/github", version = "~> 6.4" }
    neon       = { source = "kislerdm/neon", version = "~> 0.6" }
  }

  # Backend config (`key`, `endpoints`) is injected by ../../scripts/tf.sh.
  backend "s3" {
    bucket                      = "tf-state"
    region                      = "auto"
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    use_path_style              = true
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

provider "github" {
  token = var.github_token
  owner = "agranado2k"
}

provider "neon" {
  api_key = var.neon_api_key
}
