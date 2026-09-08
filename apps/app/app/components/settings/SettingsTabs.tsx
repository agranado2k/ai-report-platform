import { KeyIcon, Tab, Tabs } from "arp-ui";

// The Settings section tabs (report §04). One live section today — "API keys &
// MCP" — with Members and Billing shown as disabled "Soon" placeholders so the
// shape of the section is legible before those land. Placeholders are real
// disabled tabs (aria-disabled), not links: there is nowhere to route yet.
export function SettingsTabs() {
  return (
    <Tabs aria-label="Settings sections">
      <Tab active>
        <KeyIcon className="h-4 w-4" />
        API keys &amp; MCP
      </Tab>
      <Tab disabled aria-disabled="true">
        Members
        <span className="rounded border border-border px-1.5 text-[10px] font-medium uppercase tracking-wide text-subtle">
          Soon
        </span>
      </Tab>
      <Tab disabled aria-disabled="true">
        Billing
        <span className="rounded border border-border px-1.5 text-[10px] font-medium uppercase tracking-wide text-subtle">
          Soon
        </span>
      </Tab>
    </Tabs>
  );
}
