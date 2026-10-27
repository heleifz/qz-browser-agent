import type { ToolBatchTabPolicy } from "../../shared/contracts/tool.js";
import { getLanguage, withLanguage } from "../../shared/i18n/index.js";
import { ToolExecutionError } from "./arguments.js";
import { t } from "./messages.js";

type Fields = Record<string, unknown>;
const record = (value: unknown): Fields => value && typeof value === "object" && !Array.isArray(value) ? value as Fields : {};
const validAlias = (value: unknown): value is string => typeof value === "string" && /^[\p{L}\p{N}_-]{1,64}$/u.test(value);

/** Call-local, typed tab edges. Only trusted tab creators can publish a binding. */
export function planTabBatch<T>(items: readonly T[], describe: (item: T) => {
  args: unknown; policy?: ToolBatchTabPolicy | null;
}, language = getLanguage()) {
  const error = (reason: string, reference?: unknown) => new ToolExecutionError(
    reason === "dependency_failed" ? "BATCH_TAB_DEPENDENCY_FAILED" : "BATCH_TAB_REFERENCE_ERROR",
    withLanguage(language, () => t(reason === "dependency_failed" ? "batchTabDependencyFailed" : "batchTabReferenceError")),
    { reason, ...(reference == null ? {} : { tabRef: reference }) },
  );
  const entries = items.map(item => {
    const { args, policy } = describe(item);
    return { item, originalArgs: args, args: record(args), policy, error: null as ToolExecutionError | null };
  });
  type Entry = typeof entries[number];
  const byItem = new Map(entries.map(entry => [entry.item, entry]));
  const creators = new Map<string, Entry>();
  const duplicateAliases = new Set<string>();
  const created = new Map<Entry, number>();
  const creatorCount = entries.filter(entry => entry.policy?.kind === "create").length;

  for (const entry of entries) {
    const alias = entry.args.tabAlias;
    if (alias == null) continue;
    if (entry.policy?.kind !== "create" || !validAlias(alias)) { entry.error = error("invalid_alias", alias); continue; }
    const previous = creators.get(alias);
    if (previous) {
      duplicateAliases.add(alias);
      previous.error = entry.error = error("duplicate_alias", alias);
    } else creators.set(alias, entry);
  }
  for (const entry of entries) {
    const ref = entry.args.tabRef;
    if (ref != null) {
      if (entry.policy?.kind !== "target" || !entry.policy.implicit || !validAlias(ref)) entry.error = error("invalid_reference", ref);
      else if (duplicateAliases.has(ref)) entry.error = error("duplicate_alias", ref);
      else if (!creators.has(ref)) entry.error = error("unknown_reference", ref);
    } else if (creatorCount > 1 && entry.policy?.kind === "target" && entry.policy.implicit) {
      entry.error = error("ambiguous_target");
    }
  }

  // Preload new pages within explicit observation regions. Mutations, implicit targets and
  // undeclared operations retain their order and form boundaries that references cannot cross forward.
  const ordered: Entry[] = [];
  let region: Entry[] = [];
  const flush = () => {
    ordered.push(...region.filter(entry => entry.policy?.kind === "create"), ...region.filter(entry => entry.policy?.kind !== "create"));
    region = [];
  };
  for (const entry of entries) {
    const movable = !entry.error && (entry.policy?.kind === "create" ? validAlias(entry.args.tabAlias)
      : entry.policy?.kind === "target" && entry.policy.observation && (entry.args.tabRef != null || !entry.policy.implicit));
    if (movable) region.push(entry);
    else { flush(); ordered.push(entry); }
  }
  flush();
  const positions = new Map(ordered.map((entry, index) => [entry, index]));
  for (const entry of ordered) {
    if (entry.error || entry.args.tabRef == null) continue;
    const producer = creators.get(String(entry.args.tabRef))!;
    if (positions.get(producer)! >= positions.get(entry)!) entry.error = error("forward_reference_across_barrier", entry.args.tabRef);
  }
  return {
    ordered: ordered.map(entry => entry.item),
    args(item: T): unknown {
      const entry = byItem.get(item)!;
      if (entry.error) throw entry.error;
      if (entry.args.tabRef == null) return entry.originalArgs;
      const tabId = created.get(creators.get(String(entry.args.tabRef))!);
      if (!tabId) throw error("dependency_failed", entry.args.tabRef);
      const { tabRef: _ref, ...args } = entry.args;
      return { ...args, tabId };
    },
    settle(item: T, result: unknown, isError: boolean) {
      const entry = byItem.get(item)!, value = record(result);
      const id = value.tabId ?? value.id;
      if (entry.policy?.kind === "create" && !entry.error && !isError && !value.error && !value.incomplete
        && value.ok !== false && typeof id === "number" && Number.isInteger(id) && id > 0) created.set(entry, id);
    },
  };
}
