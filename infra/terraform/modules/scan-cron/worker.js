// arp-scan-drain — a Cloudflare Cron Trigger Worker (ADR-0045). On its schedule
// it POSTs the app's /internal/scan-drain route with the shared bearer secret,
// which drains the pg-boss scan queue. The Worker holds NO logic beyond the
// trigger — all scanning/promotion lives in the Vercel app's domain code, so
// the trigger mechanism is swappable without touching the pipeline.
export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      fetch(env.DRAIN_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${env.DRAIN_SECRET}` },
      }),
    );
  },
};
