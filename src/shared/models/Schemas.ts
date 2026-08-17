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
    lastWorkspaceRoot: z.string().min(1).optional(),
});

/** Zod schema for a partial settings update from the renderer. */
export const SETTINGS_PATCH_SCHEMA = z.object({
    theme: THEME_MODE_SCHEMA.optional(),
    lastWorkspaceRoot: z.string().min(1).optional(),
});

/** Zod schema that accepts a Windows or POSIX absolute path. */
export const ABSOLUTE_PATH_SCHEMA = z.string().min(1).refine((value) => /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith("/"), {
    message: "path must be absolute",
});

/** Zod schema that accepts only https URLs. */
export const HTTPS_URL_SCHEMA = z.string().url().refine((value) => value.startsWith("https:"), {
    message: "only https URLs are allowed",
});
