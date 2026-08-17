/**
 * Persist theme and last workspace root in Electron userData, never in the tool repository.
 */

import { app } from "electron";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { DEFAULT_APP_SETTINGS, type AppSettings } from "../../shared/models/AppSettings.js";
import { APP_SETTINGS_SCHEMA, SETTINGS_PATCH_SCHEMA } from "../../shared/models/Schemas.js";

/** Return the settings.json path under Electron userData. */
function settingsPath(): string
{
    return join(app.getPath("userData"), "settings.json");
}

/** Drop an empty `lastWorkspaceRoot` so exactOptionalPropertyTypes stays satisfied. */
function toSettings(value: { theme: AppSettings["theme"]; lastWorkspaceRoot?: string | undefined }): AppSettings
{
    return value.lastWorkspaceRoot
        ? { theme: value.theme, lastWorkspaceRoot: value.lastWorkspaceRoot }
        : { theme: value.theme };
}

/** Persist theme and last workspace root in Electron userData. */
export class SettingsService
{
    /** Read settings, or return defaults when the file is missing or invalid. */
    async get(): Promise<AppSettings>
    {
        try
        {
            const parsed: unknown = JSON.parse(await fs.readFile(settingsPath(), "utf8"));
            return toSettings(APP_SETTINGS_SCHEMA.parse(parsed));
        }
        catch
        {
            return { ...DEFAULT_APP_SETTINGS };
        }
    }

    /** Merge a validated patch into settings.json. */
    async update(patch: unknown): Promise<AppSettings>
    {
        const current = await this.get();
        const parsedPatch = SETTINGS_PATCH_SCHEMA.parse(patch);
        const next = toSettings({
            theme: parsedPatch.theme ?? current.theme,
            ...(parsedPatch.lastWorkspaceRoot ? { lastWorkspaceRoot: parsedPatch.lastWorkspaceRoot } : current.lastWorkspaceRoot ? { lastWorkspaceRoot: current.lastWorkspaceRoot } : {}),
        });
        await fs.mkdir(app.getPath("userData"), { recursive: true });
        await fs.writeFile(settingsPath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
        return next;
    }
}

/** Shared settings service used by IPC handlers. */
export const settingsService = new SettingsService();
