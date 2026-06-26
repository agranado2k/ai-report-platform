import { describe, expect, it, vi } from "vitest";
import { ResendEmailSender } from "./email-sender";

const okResponse = () => new Response(JSON.stringify({ id: "re_123" }), { status: 200 });

describe("ResendEmailSender (ADR-0057)", () => {
  it("POSTs to the Resend API with Bearer auth + the message, and returns ok on 2xx", async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    const sender = new ResendEmailSender({
      apiKey: "re_test_key",
      from: "noreply@mail.example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const r = await sender.send({ to: "a@b.com", subject: "Your link", html: "<p>hi</p>" });
    expect(r.ok).toBe(true);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer re_test_key");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      from: "noreply@mail.example.com",
      to: "a@b.com",
      subject: "Your link",
      html: "<p>hi</p>",
    });
  });

  it("maps a non-2xx response to an error (status surfaced, no throw)", async () => {
    const fetchImpl = vi.fn(async () => new Response("forbidden", { status: 403 }));
    const sender = new ResendEmailSender({
      apiKey: "k",
      from: "f@x.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const r = await sender.send({ to: "a@b.com", subject: "s", html: "h" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("403");
  });

  it("maps a network throw to an error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const sender = new ResendEmailSender({
      apiKey: "k",
      from: "f@x.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const r = await sender.send({ to: "a@b.com", subject: "s", html: "h" });
    expect(r.ok).toBe(false);
  });
});
