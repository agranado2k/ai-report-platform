// arp-http request-parse helpers (driving side). parseJsonBody turns a Fetch
// Request into a JSON object, or a typed AppError the route renders via
// errorToHttp: non-JSON content-type → 415, malformed / non-object → 422.
import { type AppError, err, ok, type Result } from "arp-domain";

export async function parseJsonBody(
  request: Request,
): Promise<Result<Record<string, unknown>, AppError>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return err({ kind: "UnsupportedMediaType", message: "expected application/json" });
  }
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return err({ kind: "ValidationError", message: "body must be a JSON object" });
    }
    return ok(body as Record<string, unknown>);
  } catch {
    return err({ kind: "ValidationError", message: "malformed JSON body" });
  }
}
