/**
 * Settings stored in Electron userData, never in the tool repository.
 */

/** Persisted appearance mode. */
export type ThemeMode = "system" | "light" | "dark";

/** Settings stored in Electron userData, not in the tool repository. */
export interface AppSettings
{
    theme: ThemeMode;
    lastWorkspaceRoot?: string;
}

/** Default settings used when userData has no settings file. */
export const DEFAULT_APP_SETTINGS: AppSettings = {
    theme: "system",
};
