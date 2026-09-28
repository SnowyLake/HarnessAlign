/**
 * Pure transitions for a GitHub Release update.
 * Install is allowed only after this session finishes a download.
 */

import { HalignError } from "../../engine/Model.js";
import type { AppUpdatePhase, AppUpdateStatus } from "../../shared/models/AppUpdate.js";

const RELEASE_VERSION = /^(?:0|[1-9]\d{0,6})\.(?:0|[1-9]\d{0,6})\.(?:0|[1-9]\d{0,6})(?:-[0-9A-Za-z.-]{1,40})?(?:\+[0-9A-Za-z.-]{1,40})?$/u;
const CHECKABLE_PHASES: readonly AppUpdatePhase[] = ["idle", "unavailable", "current", "available", "downloaded", "error"];

/** Create the idle snapshot for one application version. */
export function initialAppUpdateStatus(currentVersion: string): AppUpdateStatus
{
    return { phase: "idle", currentVersion, availableVersion: null, percent: null, message: null };
}

/** Report that this process is not an installed build and must not contact the update feed. */
export function unavailableAppUpdateStatus(currentVersion: string): AppUpdateStatus
{
    return {
        phase: "unavailable",
        currentVersion,
        availableVersion: null,
        percent: null,
        message: "Application updates run from the installed Windows app.",
    };
}

/** Accept a release version before showing it or using it in a download decision. */
export function assertReleaseVersion(version: string): string
{
    if (!RELEASE_VERSION.test(version)) throw new HalignError(`application update: version must be SemVer X.Y.Z, got ${JSON.stringify(version)}`);
    return version;
}

/** Electron proxy rule plus credentials that must not be placed in `proxyRules`. */
export interface EnvironmentProxy
{
    readonly proxyRules: string;
    readonly username: string | null;
    readonly password: string | null;
}

/** Split an environment proxy into a host rule and a separate login. */
export function environmentProxy(value: string): EnvironmentProxy
{
    const trimmed = value.trim();
    if (trimmed.length === 0 || /\s/u.test(trimmed)) throw new HalignError("application update: HTTP(S)_PROXY must be one proxy URL without spaces");
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed) ? trimmed : `http://${trimmed}`;
    let parsed: URL;
    try
    {
        parsed = new URL(withScheme);
    }
    catch
    {
        throw new HalignError("application update: HTTP(S)_PROXY must be one proxy URL without spaces");
    }
    if (parsed.hostname.length === 0) throw new HalignError("application update: HTTP(S)_PROXY must include a host");
    const username = parsed.username.length > 0 ? decodeURIComponent(parsed.username) : null;
    const password = parsed.password.length > 0 ? decodeURIComponent(parsed.password) : null;
    parsed.username = "";
    parsed.password = "";
    return { proxyRules: parsed.origin, username, password };
}

/** Convert NO_PROXY into a comma-separated Electron bypass list. */
export function environmentProxyBypass(value: string): string
{
    return value.split(",").map((item) => item.trim()).filter((item) => item.length > 0).join(",");
}

/** Move to a check. A check cannot interrupt an active check or download. */
export function beginAppUpdateCheck(status: AppUpdateStatus): AppUpdateStatus
{
    assertPhase(status, CHECKABLE_PHASES, "check");
    return { ...status, phase: "checking", percent: null, message: null };
}

/** Record a newer stable release discovered by the check that is in progress. */
export function markAppUpdateAvailable(status: AppUpdateStatus, availableVersion: string): AppUpdateStatus
{
    assertPhase(status, ["checking"], "record an available update");
    return { phase: "available", currentVersion: status.currentVersion, availableVersion: assertReleaseVersion(availableVersion), percent: null, message: null };
}

/** Record that the check found no newer stable release. */
export function markAppUpdateCurrent(status: AppUpdateStatus): AppUpdateStatus
{
    assertPhase(status, ["checking"], "record the current release");
    return { phase: "current", currentVersion: status.currentVersion, availableVersion: null, percent: null, message: null };
}

/** Start a download only for a release this session has already offered. */
export function beginAppUpdateDownload(status: AppUpdateStatus): AppUpdateStatus
{
    assertPhase(status, ["available"], "download");
    if (status.availableVersion === null) throw new HalignError("application update: available version is missing");
    return { ...status, phase: "downloading", percent: 0, message: null };
}

/** Clamp a download percentage while a download is active. */
export function updateAppUpdateProgress(status: AppUpdateStatus, percent: number): AppUpdateStatus
{
    assertPhase(status, ["downloading"], "report progress");
    if (!Number.isFinite(percent)) throw new HalignError(`application update: percent must be a finite number, got ${String(percent)}`);
    return { ...status, percent: Math.min(100, Math.max(0, Math.round(percent))) };
}

/** Mark the offered installer downloaded so installation can start. */
export function markAppUpdateDownloaded(status: AppUpdateStatus): AppUpdateStatus
{
    assertPhase(status, ["downloading"], "finish the download");
    return { ...status, phase: "downloaded", percent: 100, message: null };
}

/** Keep a failed download retryable. Other failures need a new check. */
export function failAppUpdate(status: AppUpdateStatus, message: string): AppUpdateStatus
{
    const details = message.trim();
    if (details.length === 0) throw new HalignError("application update: error message is empty");
    if (status.phase === "downloading" && status.availableVersion !== null)
    {
        return { ...status, phase: "available", percent: null, message: details };
    }
    if (status.phase === "checking" || status.phase === "downloaded")
    {
        return {
            phase: "error",
            currentVersion: status.currentVersion,
            availableVersion: status.phase === "downloaded" ? status.availableVersion : null,
            percent: null,
            message: details,
        };
    }
    throw new HalignError(`application update: cannot fail while ${status.phase}`);
}

/** Allow installation only after the offered installer has been downloaded. */
export function assertAppUpdateInstallable(status: AppUpdateStatus): void
{
    if (status.phase !== "downloaded" || status.availableVersion === null) throw new HalignError(`application update: cannot install while ${status.phase}`);
}

/** Reject an action that the current phase does not allow. */
function assertPhase(status: AppUpdateStatus, allowed: readonly AppUpdatePhase[], action: string): void
{
    if (!allowed.includes(status.phase)) throw new HalignError(`application update: cannot ${action} while ${status.phase}`);
}
