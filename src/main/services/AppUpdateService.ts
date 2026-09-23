/**
 * User-started updates for the packaged NSIS app.
 * The feed is the packaged app-update.yml. Renderer input cannot select a URL or installer.
 */

import { errorText, HalignError } from "../../engine/Model.js";
import type { AppUpdateStatus } from "../../shared/models/AppUpdate.js";
import { logMainError } from "./ConsoleService.js";
import {
    beginAppUpdateCheck,
    beginAppUpdateDownload,
    environmentProxy,
    environmentProxyBypass,
    failAppUpdate,
    initialAppUpdateStatus,
    markAppUpdateAvailable,
    markAppUpdateCurrent,
    markAppUpdateDownloaded,
    unavailableAppUpdateStatus,
    updateAppUpdateProgress,
} from "./AppUpdateState.js";

/** Session partition used by electron-updater for its own network requests. */
const UPDATER_SESSION_PARTITION = "electron-updater";

const listeners = new Set<(status: AppUpdateStatus) => void>();
let status: AppUpdateStatus = initialAppUpdateStatus("");
let operation: Promise<AppUpdateStatus> | null = null;
let isConfigured = false;
let isInstallPending = false;
let proxyCredentials: { readonly username: string; readonly password: string } | null = null;

/** Report whether quit must proceed because the update installer has already been started. */
export function isAppUpdateInstallPending(): boolean
{
    return isInstallPending;
}

/** Return the current update snapshot, recording the running application version once. */
export async function getAppUpdateStatus(): Promise<AppUpdateStatus>
{
    const { app } = await import("electron");
    if (status.currentVersion.length === 0) status = initialAppUpdateStatus(app.getVersion());
    return status;
}

/** Check the stable GitHub release embedded in the packaged app. */
export function checkForAppUpdate(): Promise<AppUpdateStatus>
{
    return exclusive(async () =>
    {
        const { app } = await import("electron");
        const version = app.getVersion();
        if (status.currentVersion.length === 0) status = initialAppUpdateStatus(version);
        if (!app.isPackaged)
        {
            publish(unavailableAppUpdateStatus(version));
            return;
        }
        publish(beginAppUpdateCheck(status));
        try
        {
            await applyEnvironmentProxy();
            const updater = await loadUpdater();
            const result = await updater.checkForUpdates();
            if (result === null) publish(unavailableAppUpdateStatus(status.currentVersion));
            else if (!result.isUpdateAvailable) publish(markAppUpdateCurrent(status));
            else publish(markAppUpdateAvailable(status, result.updateInfo.version));
        }
        catch (error)
        {
            rethrowUpdateError(error);
        }
    });
}

/** Download the offered installer and start the silent NSIS install. */
export function downloadAndInstallAppUpdate(): Promise<AppUpdateStatus>
{
    return exclusive(async () =>
    {
        const { app } = await import("electron");
        if (!app.isPackaged) throw new HalignError("application update: downloads require the installed Windows app");
        publish(beginAppUpdateDownload(status));
        try
        {
            await applyEnvironmentProxy();
            const updater = await loadUpdater();
            await updater.downloadUpdate();
            isInstallPending = true;
            updater.quitAndInstall(true, true);
            if (status.phase === "error" || !isInstallArmed(updater))
            {
                isInstallPending = false;
                if (status.phase === "downloading") publish(failAppUpdate(status, "The installer did not start."));
                throw new HalignError(`application update: ${status.message ?? "The installer did not start."}`);
            }
            publish(markAppUpdateDownloaded(status));
        }
        catch (error)
        {
            rethrowUpdateError(error);
        }
    });
}

/** Observe snapshots produced by check, download, and progress events. */
export function subscribeAppUpdate(listener: (status: AppUpdateStatus) => void): () => void
{
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Run one check or download at a time. */
function exclusive(work: () => Promise<void>): Promise<AppUpdateStatus>
{
    if (operation !== null) return Promise.reject(new HalignError("application update: another update operation is already running"));
    const run = (async () =>
    {
        try
        {
            await work();
            return status;
        }
        finally
        {
            operation = null;
        }
    })();
    operation = run;
    return run;
}

/** Publish a new snapshot to the renderer. */
function publish(next: AppUpdateStatus): void
{
    status = next;
    for (const listener of listeners) listener(status);
}

/** Configure the packaged updater once. Signature policy comes from app-update.yml. */
async function loadUpdater(): Promise<import("electron-updater").AppUpdater>
{
    const { autoUpdater } = await import("electron-updater");
    if (!isConfigured)
    {
        autoUpdater.autoDownload = false;
        autoUpdater.autoInstallOnAppQuit = false;
        autoUpdater.allowPrerelease = false;
        autoUpdater.disableWebInstaller = true;
        autoUpdater.on("error", onUpdaterError);
        autoUpdater.on("login", (info, callback) =>
        {
            if (!info.isProxy || proxyCredentials === null) callback("", "");
            else callback(proxyCredentials.username, proxyCredentials.password);
        });
        autoUpdater.on("download-progress", (progress) =>
        {
            if (status.phase !== "downloading" || !Number.isFinite(progress.percent)) return;
            publish(updateAppUpdateProgress(status, progress.percent));
        });
        isConfigured = true;
    }
    return autoUpdater;
}

/** Keep a library failure in the same phase rules as a local failure. */
function onUpdaterError(error: Error): void
{
    if (status.phase !== "checking" && status.phase !== "downloading" && status.phase !== "downloaded") return;
    isInstallPending = false;
    logMainError("Application update failed", error);
    publish(failAppUpdate(status, updateErrorText(error)));
}

/** Record a failure that the updater event did not already publish. */
function rethrowUpdateError(error: unknown): never
{
    const message = updateErrorText(error);
    if (status.phase === "checking" || status.phase === "downloading" || status.phase === "downloaded")
    {
        logMainError("Application update failed", error);
        publish(failAppUpdate(status, message));
    }
    if (error instanceof HalignError) throw error;
    throw new HalignError(`application update: ${message}`);
}

/** Collapse updater diagnostics into the status message limit. */
function updateErrorText(error: unknown): string
{
    const single = errorText(error).replace(/\s+/gu, " ").trim();
    const text = single.length > 0 ? single : "Unknown update error";
    return text.length > 500 ? `${text.slice(0, 497)}...` : text;
}

/** Prefer an explicit environment proxy, matching the other GitHub requests. */
async function applyEnvironmentProxy(): Promise<void>
{
    const proxy = process.env.https_proxy || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.HTTP_PROXY;
    if (proxy === undefined || proxy.trim().length === 0)
    {
        proxyCredentials = null;
        return;
    }
    const parsed = environmentProxy(proxy);
    proxyCredentials = parsed.username === null && parsed.password === null ? null : { username: parsed.username ?? "", password: parsed.password ?? "" };
    const bypass = process.env.no_proxy || process.env.NO_PROXY;
    const { session } = await import("electron");
    const updaterSession = session.fromPartition(UPDATER_SESSION_PARTITION, { cache: false });
    if (bypass === undefined || bypass.trim().length === 0) await updaterSession.setProxy({ proxyRules: parsed.proxyRules });
    else await updaterSession.setProxy({ proxyRules: parsed.proxyRules, proxyBypassRules: environmentProxyBypass(bypass) });
}

/** Read the protected flag electron-updater sets only when the installer process is launched. */
function isInstallArmed(updater: object): boolean
{
    if (!("quitAndInstallCalled" in updater)) return false;
    return updater.quitAndInstallCalled === true;
}
