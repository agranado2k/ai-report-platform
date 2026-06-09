// AllowAllPlanLimiter — Phase-1 plan limiter (ADR-0006). Real per-org quota
// enforcement (read orgs.plan_limits_json, count reports/storage) lands later;
// pre-launch we admit everything.
import type { PlanLimiter } from "arp-application";
import { type AppError, type OrgId, ok, type Result } from "arp-domain";

export class AllowAllPlanLimiter implements PlanLimiter {
  async assertWithinPlan(_orgId: OrgId): Promise<Result<void, AppError>> {
    return ok(undefined);
  }
}
