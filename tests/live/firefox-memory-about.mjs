/**
 * Parse Firefox about:memory text for attribution diffs.
 */

const METRIC_PATTERNS = [
  { key: "explicit", re: /^\s*explicit\s*\/\s*([\d,]+)\s*KiB/m },
  { key: "jsMainRuntime", re: /^\s*js-main-runtime\s*\/\s*([\d,]+)\s*KiB/m },
  { key: "images", re: /^\s*images\s*\/\s*([\d,]+)\s*KiB/m },
  { key: "heapUnclassified", re: /^\s*heap-unclassified\s*\/\s*([\d,]+)\s*KiB/m },
];

function parseKiB(match) {
  if (!match) return null;
  return Number(String(match[1]).replace(/,/g, ""));
}

export function parseAboutMemoryMetrics(text = "") {
  const body = String(text);
  const metrics = {};
  for (const { key, re } of METRIC_PATTERNS) {
    metrics[key] = parseKiB(body.match(re));
  }
  const extensionCompartments = [];
  const compartmentRe = /moz-extension:\/\/[^\s]+\s+\(pid\s+(\d+)\)\s+[\d.]+\s+MiB/g;
  for (const match of body.matchAll(compartmentRe)) {
    extensionCompartments.push({ pid: Number(match[1]), line: match[0] });
  }
  const extBlock = body.match(/Extensions\s*\n([\s\S]*?)(?:\n\n|\nWeb Content)/);
  if (extBlock) {
    const addOnRe = /(moz-extension:\/\/[^\n]+)\n\s*([\d,]+)\s*KiB/g;
    for (const match of extBlock[1].matchAll(addOnRe)) {
      extensionCompartments.push({ id: match[1].trim(), explicitKiB: parseKiB(match) });
    }
  }
  return { metrics, extensionCompartments };
}

export function diffAboutMemoryMetrics(before, after) {
  const keys = new Set([...Object.keys(before?.metrics || {}), ...Object.keys(after?.metrics || {})]);
  const delta = {};
  for (const key of keys) {
    const a = before?.metrics?.[key];
    const b = after?.metrics?.[key];
    if (typeof a === "number" && typeof b === "number") delta[key] = b - a;
  }
  return delta;
}

export function classifyFirefoxProcess(args = "", comm = "") {
  const text = `${String(comm)} ${String(args)}`;
  if (/WebExtensions/i.test(text)) return "webextensions";
  if (text.includes("-isForBrowser")) return "content";
  if (text.includes("-contentproc") && text.includes("parentBuildID")) {
    if (text.includes("Socket")) return "socket";
    if (text.includes("RDD")) return "rdd";
    if (text.includes("Utility")) return "utility";
    return "contentproc-other";
  }
  if (text.includes("firefox-bin") && text.includes("--headless")) return "parent";
  if (text.includes("firefox-bin")) return "parent";
  return "other";
}

export function bucketRssSample(sample) {
  const buckets = { parent: 0, webextensions: 0, content: 0, utility: 0, other: 0 };
  for (const row of sample.rows || []) {
    const kind = classifyFirefoxProcess(row.args);
    if (kind === "parent") buckets.parent += row.rssKiB;
    else if (kind === "webextensions") buckets.webextensions += row.rssKiB;
    else if (kind === "content") buckets.content += row.rssKiB;
    else if (kind === "utility" || kind === "socket" || kind === "rdd") buckets.utility += row.rssKiB;
    else buckets.other += row.rssKiB;
  }
  return buckets;
}

export function rssSlopeKiBPerMin(samples, bucketKey) {
  if (!Array.isArray(samples) || samples.length < 2) return null;
  const points = samples
    .map(s => ({
      t: Date.parse(s.at),
      v: bucketRssSample(s)[bucketKey] || 0,
    }))
    .filter(p => Number.isFinite(p.t));
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const minutes = (last.t - first.t) / 60_000;
  if (minutes <= 0) return null;
  return (last.v - first.v) / minutes;
}
