// Serialize a pure arp-http HttpResponse into a Remix/Fetch Response. Shared by
// every JSON API route (upload, list, …) so the transport translation lives in
// one place; all policy/shape decisions stay in the pure arp-http mappers.
import type { HttpResponse } from "arp-http";

export function toResponse(http: HttpResponse): Response {
  return new Response(JSON.stringify(http.body), {
    status: http.status,
    headers: { "Content-Type": http.contentType, ...(http.headers ?? {}) },
  });
}
