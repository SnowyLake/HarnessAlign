/**
 * Zod schemas for untrusted renderer IPC payloads.
 * Main must parse through these before calling the engine or touching the filesystem.
 */

import { z } from "zod";

/** Validate renderer log records without accepting arbitrary objects or executable content. */
export const LOG_INPUT_SCHEMA = z.object({
    level: z.enum(["info", "success", "error"]),
    title: z.string().trim().min(1),
    details: z.string(),
}).strict();

/** Validate the one-time private repository credential supplied by the renderer. */
export const SYNC_CONNECTION_SCHEMA = z.strictObject({
    owner: z.string().min(1).max(100),
    repository: z.string().min(1).max(100),
    branch: z.string().min(1).max(200),
    token: z.string().min(1).max(1024).regex(/^\S+$/u, "Token must not contain whitespace"),
});

/** Accept decisions about an existing preview, never arbitrary source bytes or paths. */
export const SYNC_APPLY_SCHEMA = z.strictObject({
    previewId: z.uuid(),
    mode: z.enum(["merge", "local", "remote"]),
    choices: z.record(z.string().min(1).max(241), z.enum(["local", "remote"])).refine((choices) => Object.keys(choices).length <= 5000, "Too many conflict decisions"),
});

/** Restore only a server-owned preview entry, never renderer-supplied file contents. */
export const SYNC_DISCARD_SCHEMA = z.strictObject({
    previewId: z.uuid(),
    key: z.string().min(1).max(241),
});

/** Zod schema for persisted theme mode values. */
export const THEME_MODE_SCHEMA = z.enum(["system", "light", "dark"]);

/** Zod schema for settings stored in Electron userData. */
export const APP_SETTINGS_SCHEMA = z.object({
    theme: THEME_MODE_SCHEMA,
});

/** Zod schema for a partial settings update from the renderer. */
export const SETTINGS_PATCH_SCHEMA = z.object({
    theme: THEME_MODE_SCHEMA.optional(),
});

/** Zod schema that accepts only https URLs. */
export const HTTPS_URL_SCHEMA = z.string().url().refine((value) => value.startsWith("https:"), {
    message: "only https URLs are allowed",
});

/** Shape of a harness declaration; the engine validates names and reserved deployment paths. */
export const HARNESS_SCHEMA = z.strictObject({
    name: z.string(),
    configPath: z.string(),
    agentFormat: z.enum(["toml", "yaml"]),
    agentExtension: z.string(),
    instructionsField: z.string().optional(),
}).transform(({ instructionsField, ...harness }) => instructionsField === undefined ? harness : { ...harness, instructionsField });

/** Complete editor config payload, validated before workspace initialization. */
export const CONFIG_SCHEMA = z.strictObject({
    version: z.literal(1),
    name: z.string(),
    layers: z.array(z.strictObject({ name: z.string(), selected: z.string() })),
    harnesses: z.array(HARNESS_SCHEMA).min(1),
    skillSources: z.array(z.strictObject({ owner: z.string(), name: z.string(), branch: z.string() })),
});

/** Root rule write shape with an explicit harness allowlist. */
export const RULE_INPUT_SCHEMA = z.strictObject({
    path: z.string(), priority: z.number().int().nonnegative(), targets: z.array(z.string()), body: z.string(),
});

/** Layer option write shape that permits an empty Markdown body. */
export const LAYER_OPTION_INPUT_SCHEMA = z.strictObject({ path: z.string(), targets: z.array(z.string()), body: z.string() });

/** Agent write shape retaining arbitrary per-harness metadata keys. */
export const AGENT_SCHEMA = z.strictObject({
    path: z.string(), name: z.string(), description: z.string(), body: z.string(),
    harnesses: z.record(z.string(), z.record(z.string(), z.unknown())),
});

/** Ordered layer choices for Generate and Setup. */
export const LAYER_SELECTION_SCHEMA = z.array(z.strictObject({ name: z.string(), option: z.string() })).optional();

/** Skill source registration payload without implicit string coercion. */
export const SKILL_SOURCE_INPUT_SCHEMA = z.strictObject({ url: z.string(), branch: z.string().optional() })
    .transform(({ url, branch }) => branch === undefined ? { url } : { url, branch });

/** Nonempty selection of unique skill identifiers. */
export const SKILL_IDS_SCHEMA = z.array(z.string().min(1)).min(1)
    .refine((ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length, "skill ids must be unique without case sensitivity");
