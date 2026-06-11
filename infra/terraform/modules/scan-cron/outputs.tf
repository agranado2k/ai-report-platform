output "worker_name" {
  value       = cloudflare_workers_script.scan_drain.name
  description = "The deployed Cron Trigger Worker's script name."
}
