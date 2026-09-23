/**
 * Desktop application update status shared by Main and Renderer.
 * The renderer cannot choose a feed URL or installer path.
 */

/** Phases for a user-started Windows installer update. */
export type AppUpdatePhase = "idle" | "checking" | "unavailable" | "current" | "available" | "downloading" | "downloaded" | "error";

/** Immutable snapshot of the in-app update operation. */
export interface AppUpdateStatus
{
    readonly phase: AppUpdatePhase;
    readonly currentVersion: string;
    readonly availableVersion: string | null;
    readonly percent: number | null;
    readonly message: string | null;
}
