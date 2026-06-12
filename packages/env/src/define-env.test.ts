import { describe, expect, it, vi } from "vitest";
import { defineEnv } from "./define-env";

const valid: Record<string, string | undefined> = {
  DATABASE_URL: "postgres://user:pass@db.neon.tech/main",
  SCAN_DRAIN_SECRET: "drain-secret",
  R2_ACCOUNT_ID: "acct",
  R2_ACCESS_KEY_ID: "akid",
  R2_SECRET_ACCESS_KEY: "r2secret",
  R2_BUCKET: "arp-reports-ci",
  CLERK_SECRET_KEY: "sk_test_123",
  PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_123",
};

// createEnv logs to console.error before throwing on invalid input; silence it
// for the negative cases so the test output stays clean.
const silently = (fn: () => unknown) => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
};

describe("defineEnv", () => {
  it("parses a valid environment and applies the NODE_ENV default", () => {
    const env = defineEnv(valid);
    expect(env.DATABASE_URL).toBe("postgres://user:pass@db.neon.tech/main");
    expect(env.NODE_ENV).toBe("development"); // default
    expect(env.PUBLIC_CLERK_PUBLISHABLE_KEY).toBe("pk_test_123");
    expect(env.CLERK_SECRET_KEY).toBe("sk_test_123");
  });

  it("fails fast when a required server var is missing", () => {
    silently(() => {
      expect(() => defineEnv({ ...valid, DATABASE_URL: undefined })).toThrow();
    });
  });

  it("rejects a malformed DATABASE_URL", () => {
    silently(() => {
      expect(() => defineEnv({ ...valid, DATABASE_URL: "not-a-url" })).toThrow();
    });
  });

  it("treats an empty string as undefined (so defaults/required apply)", () => {
    // NODE_ENV="" → undefined → falls back to the default
    const env = defineEnv({ ...valid, NODE_ENV: "" });
    expect(env.NODE_ENV).toBe("development");
    // A required var set to "" → undefined → still fails fast
    silently(() => {
      expect(() => defineEnv({ ...valid, R2_BUCKET: "" })).toThrow();
    });
  });

  it("accepts an optional VIEW_ORIGIN URL (canonical viewer origin)", () => {
    const env = defineEnv({ ...valid, VIEW_ORIGIN: "https://view.example" });
    expect(env.VIEW_ORIGIN).toBe("https://view.example");
  });

  it("treats VIEW_ORIGIN as optional (undefined when unset, e.g. on previews)", () => {
    const env = defineEnv(valid);
    expect(env.VIEW_ORIGIN).toBeUndefined();
  });

  it("rejects a malformed VIEW_ORIGIN", () => {
    silently(() => {
      expect(() => defineEnv({ ...valid, VIEW_ORIGIN: "not-a-url" })).toThrow();
    });
  });
});
