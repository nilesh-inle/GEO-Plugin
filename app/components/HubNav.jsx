/**
 * Tab definitions for the hub screens. Each tab is its own route, nested under
 * the hub's path so the app navigation keeps the hub highlighted.
 */
import { HubTabs } from "./ui";

const ACCESS_TABS = [
  { key: "crawlers", label: "Crawlers & reachability", href: "/app/access" },
  { key: "surfaces", label: "AI surfaces", href: "/app/access/surfaces" },
  { key: "llms", label: "llms.txt & agents.md", href: "/app/access/llms" },
  { key: "schema", label: "Schema markup", href: "/app/access/schema" },
  { key: "indexing", label: "Indexing", href: "/app/access/indexing" },
  { key: "agents", label: "Agent readiness", href: "/app/access/agents" },
  { key: "brand", label: "Brand facts", href: "/app/access/brand" },
];

const SETTINGS_TABS = [
  { key: "tracking", label: "Tracking", href: "/app/settings" },
  { key: "automations", label: "Automations", href: "/app/settings/automations" },
  { key: "tools", label: "AI tools", href: "/app/settings/tools" },
  { key: "data", label: "Permissions & data", href: "/app/settings/data" },
];

export function AccessNav({ current }) {
  return <HubTabs tabs={ACCESS_TABS} current={current} />;
}

export function SettingsNav({ current }) {
  return <HubTabs tabs={SETTINGS_TABS} current={current} />;
}
