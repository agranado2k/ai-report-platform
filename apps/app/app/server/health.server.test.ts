// Unit tests for the /health JSON body builder (issue #149 — smoke reliability).
// The route loader stays a thin wrapper (real DB ping via the app's DbContext,
// real defineEnv()); this pure function is what the CI readiness gate depends
// on, so it gets full unit coverage with an injected `pingDb` FAKE — no real
// Neon connection needed, and the loader itself is exercised e2e only (per the
// root vitest.config.ts's routes-stay-e2e-only carve-out).
import { describe, expect, it } from "vitest";
import { buildHealthBody } from "./health.server";

const okPing = async () => {};
const failingPing = async () => {
  throw new Error("connection refused");
};

const baseDeps = {
  commit: "abc1234",
  version: "0.1.0",
};

describe("buildHealthBody", () => {
  it("reports isolated:false and neonBranch:null when neither marker is set", async () => {
    const body = await buildHealthBody({ ...baseDeps, pingDb: okPing, env: {} });
    expect(body.isolated).toBe(false);
    expect(body.neonBranch).toBeNull();
  });

  it("reports isolated:true and echoes neonBranch when NEON_BRANCH is set", async () => {
    const body = await buildHealthBody({
      ...baseDeps,
      pingDb: okPing,
      env: { neonBranch: "preview-pr-42" },
    });
    expect(body.isolated).toBe(true);
    expect(body.neonBranch).toBe("preview-pr-42");
  });

  it("reports isolated:true when only R2_KEY_PREFIX is set (neonBranch still null)", async () => {
    const body = await buildHealthBody({
      ...baseDeps,
      pingDb: okPing,
      env: { r2KeyPrefix: "pr-42/" },
    });
    expect(body.isolated).toBe(true);
    expect(body.neonBranch).toBeNull();
  });

  it("sets checks.neon:'ok' when the DB ping succeeds", async () => {
    const body = await buildHealthBody({ ...baseDeps, pingDb: okPing, env: {} });
    expect(body.checks.neon).toBe("ok");
  });

  it("sets checks.neon:'error' when the DB ping throws — and never lets it propagate", async () => {
    const body = await buildHealthBody({ ...baseDeps, pingDb: failingPing, env: {} });
    expect(body.checks.neon).toBe("error");
  });

  it("preserves the existing top-level fields (status/service/phase/version/commit)", async () => {
    const body = await buildHealthBody({ ...baseDeps, pingDb: okPing, env: {} });
    expect(body.status).toBe("ok");
    expect(body.service).toBe("app");
    expect(body.phase).toBe("0c");
    expect(body.version).toBe("0.1.0");
    expect(body.commit).toBe("abc1234");
    expect(typeof body.timestamp).toBe("string");
  });
});
