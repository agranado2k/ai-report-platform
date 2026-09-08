import { ExternalLinkIcon, SparklesIcon } from "arp-ui";
import { CopyButton } from "../CopyButton";

// The "Connect to Claude" hero (report §04) — the thing people come to this page
// for. Teaches the MCP connection: add Centaur as a connector, paste this
// endpoint, then authenticate with a key created below. The endpoint is derived
// from the app origin by the route loader (see mcpEndpoint) and shown verbatim
// with a one-click copy.
const SETUP_GUIDE_URL = "https://modelcontextprotocol.io/docs/tutorials/use-remote-mcp-server";

export function ConnectPanel({ endpoint }: { endpoint: string }) {
  return (
    <section className="rounded-card border border-border-strong bg-linear-to-br from-brand/10 to-surface p-5">
      <div className="flex flex-wrap items-center gap-2">
        <SparklesIcon className="h-4 w-4 text-brand-hover" />
        <h3 className="text-sm font-semibold text-fg">Connect to Claude</h3>
        <span className="rounded-full border border-border-strong px-2 py-0.5 font-mono text-[11px] text-accent">
          MCP
        </span>
      </div>
      <p className="mt-2 max-w-prose text-sm text-muted">
        Add Centaur as an MCP server and Claude can upload, organise and read comments on your
        reports. Paste this endpoint into Claude&rsquo;s connector settings, then authenticate with
        a key.
      </p>
      <div className="mt-3 flex items-center gap-3 rounded-control border border-border bg-bg px-3 py-2 font-mono text-xs">
        <span className="shrink-0 text-subtle">endpoint</span>
        <span className="truncate text-brand-hover">{endpoint}</span>
        <CopyButton value={endpoint} className="ml-auto shrink-0" />
      </div>
      <a
        href={SETUP_GUIDE_URL}
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-subtle transition-colors hover:text-brand"
      >
        Setup guide
        <ExternalLinkIcon className="h-3.5 w-3.5" />
      </a>
    </section>
  );
}
