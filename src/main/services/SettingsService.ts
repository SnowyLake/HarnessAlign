/**
 * Persist theme in Electron userData, never in the tool repository.
 */

import { app } from "electron";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { atomicWrite } from "../../engine/FsSafe.js";
import { DEFAULT_APP_SETTINGS, type AppSettings } from "../../shared/models/AppSettings.js";
import { APP_SETTINGS_SCHEMA, SETTINGS_PATCH_SCHEMA } from "../../shared/models/Schemas.js";

/** Return the settings.json path under Electron userData. */
function settingsPath(): string
{
    return join(app.getPath("userData"), "settings.json");
}

/** Read settings, or return defaults when the file is missing or invalid. */
export async function getSettings(): Promise<AppSettings>
{
    try
    {
        const parsed: unknown = JSON.parse(await fs.readFile(settingsPath(), "utf8"));
        return APP_SETTINGS_SCHEMA.parse(parsed);
    }
    catch
    {
        return { ...DEFAULT_APP_SETTINGS };
    }
}

/** Merge a validated patch into settings.json. */
export async function updateSettings(patch: unknown): Promise<AppSettings>
{
    const current = await getSettings();
    const parsedPatch = SETTINGS_PATCH_SCHEMA.parse(patch);
    const next: AppSettings = { theme: parsedPatch.theme ?? current.theme };
    await fs.mkdir(app.getPath("userData"), { recursive: true });
    await atomicWrite(settingsPath(), Buffer.from(`${JSON.stringify(next, null, 2)}\n`, "utf8"));
    return next;
}
