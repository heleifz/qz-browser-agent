import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateCapabilityCatalogs } from "./capability-catalog.mjs";
import { generateModelsDevIndex } from "./models-dev-assets.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const START = "<!-- qz-drive-tools:start -->";
const END = "<!-- qz-drive-tools:end -->";
// Group capability owners, not tool names: registrations remain the source of truth.
const GROUPS = [
  [["tabs"], "Tabs", "Open, navigate, list, close, and manage page ownership."],
  [["accessibility", "page"], "Page content and elements", "Read text, HTML, and accessibility trees; find, inspect, and act on elements; scroll pages."],
  [["wait"], "Waiting", "Wait for page loads, navigation, popups, URLs, predicates, elements, or a specified time."],
  [["media"], "Images and screen actions", "Capture screenshots, discover and collect images, read image assets, and act at screen coordinates."],
  [["diagnostics"], "Network and console", "Watch requests, read captured bodies and console messages, and wait for responses or network idle."],
  [["script"], "Scripts and discovery", "Run workflows through qz script, evaluate page functions, and discover tool schemas."],
  [["data", "documents"], "Data and files", "Store structured data, save files, start downloads, and inspect downloaded files."],
  [["skills"], "Skills", "Find and load Skills and their packaged resources."],
  [["bookmarks", "sessions", "settings"], "Browser utilities", "Search browsing history, request location, and notify the user."],
];

export async function renderDriveToolIndex() {
  generateCapabilityCatalogs(ROOT);
  generateModelsDevIndex(ROOT);
  const { default: contributions } = await import("#capabilities/tools");
  const { isDriveToolForbidden } = await import("../src/background/mcp/external-drive.ts");
  const owners = new Map();
  const browser = globalThis.chrome;
  // Register declarations without browser services or executing any tool.
  globalThis.chrome = {};
  try {
    for (const { id, setup } of contributions) {
      const names = [];
      setup({ models: {}, skills: {}, registerTool({ name, hidden }) {
        if (!hidden && !isDriveToolForbidden(name)) names.push(name);
      } });
      if (names.length) owners.set(id, names);
    }
  } finally {
    if (browser === undefined) delete globalThis.chrome;
    else globalThis.chrome = browser;
  }
  const lines = GROUPS.map(([ids, title, description]) => {
    const names = ids.flatMap(id => {
      const names = owners.get(id) || [];
      owners.delete(id);
      return names;
    }).sort();
    return names.length ? `- **${title}**: ${names.map(name => `\`${name}\``).join(", ")}. ${description}` : "";
  }).filter(Boolean);
  if (owners.size) throw new Error(`Add guide groups for capabilities: ${[...owners.keys()].join(", ")}`);
  return lines.join("\n");
}

export async function syncDriveGuide() {
  const sourcePath = resolve(ROOT, "skills/qz-browser-agent/SKILL.md");
  const source = readFileSync(sourcePath, "utf8");
  const start = source.indexOf(START);
  const end = source.indexOf(END, start + START.length);
  if (start < 0 || end < 0) throw new Error("Drive tool index markers are missing.");
  const guide = `${source.slice(0, start + START.length)}\n${await renderDriveToolIndex()}\n${source.slice(end)}`;
  writeFileSync(sourcePath, guide);
  writeFileSync(resolve(ROOT, "services/mcp-bridge/src/qz-drive-SKILL.md"), guide);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await syncDriveGuide();
