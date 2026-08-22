/**
 * Zod schemas for untrusted renderer IPC payloads.
 * Main must parse through these before calling the engine or touching the filesystem.
 */

import { z } from "zod";

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
