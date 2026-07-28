// Runs the shared AuditLogger contract against InMemoryAuditLogger.
// The same suite also runs against DrizzleAuditLogger on pglite from
// packages/adapters/src/audit-logger.contract.test.ts (ADR-0046, ADR-0070).
// The fake's `.recorded()` returns entries as the writer passed them; the
// harness applies the contract's meta-normalization (`meta ?? {}`) so both
// implementations read back in the same vocabulary.
import { orgId, userId } from "arp-domain";
import { InMemoryAuditLogger } from "../in-memory";
import { describeAuditLoggerContract } from "./audit-logger.contract";

describeAuditLoggerContract("in-memory", async () => {
  const audit = new InMemoryAuditLogger();
  return {
    audit,
    orgId: orgId("00000000-0000-4000-8000-000000000001"),
    actorUserId: userId("00000000-0000-4000-8000-000000000002"),
    recorded: async () => audit.recorded().map((e) => ({ ...e, meta: e.meta ?? {} })),
    async teardown() {},
  };
});
