# modules/resend-domain — Documentation-only module.
#
# Resend has no official Terraform provider as of 2026-05. Domain verification
# is a click-ops action in the Resend dashboard that produces DNS records the
# domain owner must add (one MX, one TXT for SPF, three CNAMEs for DKIM, and
# a TXT for DMARC).
#
# Workflow:
#   1. Operator adds the apex domain in Resend dashboard → gets the verification
#      records.
#   2. Operator pastes the records as TF_VAR_resend_dns_records into .tfvars.local.
#   3. This module passes them through as outputs to the cloudflare-zone module,
#      which actually creates the records.
#   4. Operator clicks "Verify" in Resend dashboard.
#
# When Resend ships a Terraform provider (or we move to AWS SES + their TF
# provider), replace this module with real resources.

terraform {
  required_providers {}
}

# Sanity assertions on the records the operator pasted in.
check "records_well_formed" {
  assert {
    condition = alltrue([
      for r in var.dns_records :
      contains(["CNAME", "TXT", "MX"], r.type)
    ])
    error_message = "Resend DNS records must be CNAME, TXT, or MX."
  }
  assert {
    # Minimum for a verifiable send-only setup is SPF + DKIM + DMARC = 3.
    # An MX record is only required if you want bounces routed through Resend
    # (rare for transactional email). Don't gate on it.
    condition     = length(var.dns_records) >= 3
    error_message = "Expected at least 3 DNS records from Resend (SPF + DKIM + DMARC). Got ${length(var.dns_records)}. Re-check the Resend dashboard."
  }
}
