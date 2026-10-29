import assert from "node:assert/strict";
import {
  getSkillDisplayName,
  isValidAgentSkillName,
  normalizeModernSkill,
  preserveStoredSkillId,
  toAgentSkillName,
} from "../../src/shared/skills/skill-utils.js";

const prefix = "qzb-shared-".padEnd(64, "a");
const alpha = `${prefix}-alpha`;
const beta = `${prefix}-beta`;
const legacyId = "legacy-prefix-".padEnd(64, "b");
const legacyLong = `${legacyId}-same-skill`;

function legacyHash(value) {
  let hash = 2166136261;
  for (const char of String(value || "")) {
    hash ^= char.codePointAt(0) || 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).slice(0, 8);
}

function legacyBasicSlug(value) {
  return String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64)
    .replace(/^-|-$/g, "");
}

function legacyTrim(value) {
  let text = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (text.length > 64) text = text.slice(0, 64).replace(/-+$/g, "");
  if (!isValidAgentSkillName(text)) text = `skill-${legacyHash(text || "skill")}`;
  return text;
}

function legacyAgentSkillName(value, fallback = "skill") {
  const raw = String(value || "").trim();
  const fallbackSlug = legacyBasicSlug(fallback) || "skill";
  const slug = legacyBasicSlug(raw);
  const hasNonAscii = /[^\x00-\x7F]/.test(raw);
  if (slug && isValidAgentSkillName(slug) && !hasNonAscii) return slug;
  const hash = legacyHash(raw || fallbackSlug);
  return legacyTrim(`${slug || fallbackSlug}-${hash}`);
}

assert.equal(prefix.length, 64);
assert.equal(isValidAgentSkillName(prefix), true);
assert.equal(legacyAgentSkillName(alpha), prefix);
assert.equal(legacyAgentSkillName(beta), prefix, "the old 64-character cut mapped distinct names onto one prefix");
assert.notEqual(toAgentSkillName(alpha), toAgentSkillName(beta));
assert.notEqual(toAgentSkillName(alpha), prefix);
assert.notEqual(toAgentSkillName(beta), prefix);
assert.equal(toAgentSkillName(alpha), toAgentSkillName(alpha));
assert.equal(isValidAgentSkillName(toAgentSkillName(alpha)), true);
assert.equal(isValidAgentSkillName(toAgentSkillName(beta)), true);
assert.ok(toAgentSkillName(alpha).length <= 64);
assert.ok(toAgentSkillName(alpha).endsWith(`-${legacyHash(alpha)}`));
assert.ok(toAgentSkillName(beta).endsWith(`-${legacyHash(beta)}`));
assert.equal(toAgentSkillName(prefix), prefix);
assert.equal(toAgentSkillName("travel-booking"), "travel-booking");
assert.equal(toAgentSkillName("travel-booking"), legacyAgentSkillName("travel-booking"));
assert.equal(toAgentSkillName("B站视频搜索"), legacyAgentSkillName("B站视频搜索"));
assert.equal(toAgentSkillName("Host 插件技能"), legacyAgentSkillName("Host 插件技能"));

const mixedAlpha = `${prefix}视频甲`;
const mixedBeta = `${prefix}视频乙`;
assert.notEqual(toAgentSkillName(mixedAlpha), toAgentSkillName(mixedBeta));
assert.ok(toAgentSkillName(mixedAlpha).endsWith(`-${legacyHash(mixedAlpha)}`));
assert.ok(toAgentSkillName(mixedBeta).endsWith(`-${legacyHash(mixedBeta)}`));

const normalizedAlpha = normalizeModernSkill({ name: alpha, description: "alpha", content: "alpha body" });
assert.equal(normalizedAlpha.name, toAgentSkillName(alpha));
assert.equal(getSkillDisplayName(normalizedAlpha), alpha);
assert.notEqual(toAgentSkillName(legacyLong), legacyId);

const legacyAlpha = normalizeModernSkill({
  name: prefix,
  displayName: alpha,
  description: "legacy alpha",
  content: "legacy-alpha",
});
const incomingAlpha = normalizeModernSkill({ name: alpha, description: "alpha", content: "alpha body" });
assert.equal(preserveStoredSkillId(incomingAlpha, [legacyAlpha]).name, prefix);
assert.equal(getSkillDisplayName(preserveStoredSkillId(incomingAlpha, [legacyAlpha])), alpha);
assert.equal(
  preserveStoredSkillId(incomingAlpha, [normalizeModernSkill({ name: prefix, content: "real prefix" })]).name,
  toAgentSkillName(alpha),
);
assert.equal(
  preserveStoredSkillId(incomingAlpha, [legacyAlpha, normalizeModernSkill({ name: toAgentSkillName(alpha), displayName: alpha, content: "already hashed" })]).name,
  toAgentSkillName(alpha),
);
assert.equal(
  preserveStoredSkillId(incomingAlpha, [
    legacyAlpha,
    normalizeModernSkill({ name: "other-alpha", displayName: alpha, content: "other" }),
  ]).name,
  toAgentSkillName(alpha),
);
const prettyIncoming = normalizeModernSkill({ name: "Travel Booking", content: "pretty" });
assert.equal(prettyIncoming.name, "travel-booking");
assert.equal(
  preserveStoredSkillId(prettyIncoming, [normalizeModernSkill({ name: "other-skill", displayName: "Travel Booking", content: "other" })]).name,
  "travel-booking",
);

const storage = {
  _skills: {
    [prefix]: normalizeModernSkill({
      name: prefix,
      description: "existing prefix",
      content: "prefix-original",
      createdAt: "2026-01-01 00:00:00",
      updatedAt: "2026-01-01 00:00:00",
    }),
  },
};

globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        if (Array.isArray(key)) return Object.fromEntries(key.map(item => [item, storage[item]]));
        if (typeof key === "string") return { [key]: storage[key] };
        return { ...storage };
      },
      async set(value) {
        Object.assign(storage, value);
      },
    },
  },
};

const skills = await import("../../src/background/skills/runtime.js");
const tools = await import("../../src/background/tools/runtime.js");
const toolRuntime = tools.createToolRuntime({
  skills: {
    async refreshRegistry() {
      return { version: 1 };
    },
  },
});
const host = { source: "plugin_host" };

const before = await skills.listSkills();
const seeded = before.find(skill => skill.name === prefix);
assert.equal(seeded.content, "prefix-original");
const seededUpdatedAt = seeded.updatedAt;

const createdAlpha = await toolRuntime.execute("manage_skill", {
  action: "create",
  name: alpha,
  description: "alpha skill",
  content: "alpha body",
}, undefined, host);
const createdBeta = await toolRuntime.execute("manage_skill", {
  action: "create",
  name: beta,
  description: "beta skill",
  content: "beta body",
}, undefined, host);
assert.equal(createdAlpha.saved, true);
assert.equal(createdBeta.saved, true);
assert.equal(createdAlpha.name, toAgentSkillName(alpha));
assert.equal(createdBeta.name, toAgentSkillName(beta));
assert.equal(createdAlpha.displayName, alpha);
assert.equal(createdBeta.displayName, beta);
assert.notEqual(createdAlpha.name, createdBeta.name);
assert.equal(storage._skills[prefix].content, "prefix-original");
assert.equal(storage._skills[prefix].updatedAt, seededUpdatedAt);
assert.equal(storage._skills[createdAlpha.name].content, "alpha body");
assert.equal(storage._skills[createdBeta.name].content, "beta body");

const duplicateAlpha = await toolRuntime.execute("manage_skill", {
  action: "create",
  name: alpha,
  description: "should not replace",
  content: "replaced",
}, undefined, host);
assert.equal(duplicateAlpha.code, "SKILL_ALREADY_EXISTS");
assert.equal(duplicateAlpha.details.name, createdAlpha.name);
assert.equal(duplicateAlpha.details.displayName, alpha);
assert.equal(storage._skills[createdAlpha.name].content, "alpha body");

const listed = await toolRuntime.execute("manage_skill", {
  action: "list_skills",
  scope: "all",
}, undefined, host);
assert.equal(listed.action, "list_skills");
assert.equal(listed.names.includes(prefix), true);
assert.equal(listed.names.includes(createdAlpha.name), true);
assert.equal(listed.names.includes(createdBeta.name), true);
assert.equal(listed.names.includes(alpha), false);
assert.equal(listed.names.includes(beta), false);
assert.equal(listed.items.every(item => typeof item.name === "string" && typeof item.displayName === "string" && item.displayName), true);
assert.equal(listed.items.find(item => item.name === createdAlpha.name).displayName, alpha);
assert.equal(listed.items.find(item => item.name === createdBeta.name).displayName, beta);
assert.equal(listed.items.find(item => item.name === prefix).displayName, prefix);
const listedAfter = await skills.listSkills();
assert.equal(listedAfter.find(skill => skill.name === prefix).content, "prefix-original");
assert.equal(listedAfter.find(skill => skill.name === prefix).updatedAt, seededUpdatedAt);

storage._skills[legacyId] = normalizeModernSkill({
  name: legacyId,
  displayName: legacyLong,
  description: "legacy",
  content: "legacy-body",
  createdAt: "2026-01-01 00:00:00",
  updatedAt: "2026-01-01 00:00:00",
});
const savedLegacy = await skills.saveSkill(legacyLong, "legacy", "legacy-updated");
assert.equal(savedLegacy.name, legacyId);
assert.equal(getSkillDisplayName(savedLegacy), legacyLong);
assert.equal(storage._skills[legacyId].content, "legacy-updated");
assert.equal(storage._skills[toAgentSkillName(legacyLong)], undefined);
const legacyCreate = await toolRuntime.execute("manage_skill", {
  action: "create",
  name: legacyLong,
  description: "legacy",
  content: "should not fork",
}, undefined, host);
assert.equal(legacyCreate.code, "SKILL_ALREADY_EXISTS");
assert.equal(legacyCreate.details.name, legacyId);
assert.equal(legacyCreate.details.displayName, legacyLong);

const createdPlain = await toolRuntime.execute("manage_skill", {
  action: "create",
  name: "my-skill",
  description: "plain",
  content: "plain body",
}, undefined, host);
assert.equal(createdPlain.saved, true);
assert.equal(createdPlain.name, "my-skill");
const caseRename = await toolRuntime.execute("manage_skill", {
  action: "update",
  name: "my-skill",
  renameTo: "MY SKILL",
}, undefined, host);
assert.equal(caseRename.updated, false);
assert.equal(caseRename.name, "my-skill");
assert.equal(caseRename.changes.some(change => change.field === "name"), false);

const longName = `${prefix}-rename-target`;
const renamed = await toolRuntime.execute("manage_skill", {
  action: "update",
  name: "my-skill",
  renameTo: longName,
}, undefined, host);
assert.equal(renamed.updated, true);
assert.equal(renamed.name, toAgentSkillName(longName));
assert.equal(renamed.changes.find(change => change.field === "name").to, renamed.name);
assert.notEqual(renamed.name, longName);
assert.notEqual(renamed.changes.find(change => change.field === "name").to, longName);
const listedRenamed = await toolRuntime.execute("manage_skill", {
  action: "list_skills",
  scope: "all",
}, undefined, host);
assert.equal(listedRenamed.names.includes(renamed.name), true);
assert.equal(listedRenamed.names.includes(longName), false);
assert.equal(listedRenamed.names.includes("my-skill"), false);
assert.equal(listedRenamed.items.find(item => item.name === renamed.name).displayName, renamed.displayName);
assert.equal(listedRenamed.items.find(item => item.name === renamed.name).name, renamed.name);
assert.equal(listedRenamed.items.find(item => item.name === legacyId).displayName, legacyLong);
assert.equal(storage._skills[prefix].content, "prefix-original");
assert.equal(storage._skills[prefix].updatedAt, seededUpdatedAt);
