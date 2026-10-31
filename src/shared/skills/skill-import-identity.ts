import { isBuiltinSkillName } from "./builtin-skills.js";
import { normalizeSkillLookup, preserveStoredSkillId, type SkillRecord } from "./skill-utils.js";

export type ImportedSkillIdentity =
  | { ok: true; skills: SkillRecord[] }
  | { ok: false; reason: "duplicate" | "builtin"; name: string; skills: SkillRecord[] };

/**
 * Preserve stored agent ids, then reject a duplicate lookup or a built-in name.
 * An exact agent id stays. A display name reuses an id only when exactly one
 * stored skill has that display name. A shared 64-character prefix is not a match.
 */
export function preserveThenValidateImportedSkills(
  skills: readonly unknown[],
  existingSkills: readonly unknown[] = [],
): ImportedSkillIdentity {
  const preserved = skills.map(skill => preserveStoredSkillId(skill, existingSkills));
  const seen = new Set<string>();
  for (const skill of preserved) {
    const lookup = normalizeSkillLookup(skill.name);
    if (!lookup) continue;
    if (seen.has(lookup)) return { ok: false, reason: "duplicate", name: skill.name, skills: preserved };
    seen.add(lookup);
  }
  const builtin = preserved.find(skill => isBuiltinSkillName(skill.name));
  if (builtin) return { ok: false, reason: "builtin", name: builtin.name, skills: preserved };
  return { ok: true, skills: preserved };
}
