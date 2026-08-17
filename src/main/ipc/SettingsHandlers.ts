/**
 * Settings IPC handlers. Persist through SettingsService and push changes to the renderer.
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { IPC_CHANNELS } from "../../shared/contracts/IpcChannels.js";
import type { AppSettings } from "../../shared/models/AppSettings.js";
import { settingsService } from "../services/SettingsService.js";
import { fail, runIpc } from "../utils/Ipc.js";
import { getMainWindow, isTrustedSender } from "../windows/MainWindow.js";

/** Reject IPC from any WebContents other than the main window. */
function assertTrusted(event: IpcMainInvokeEvent): void
{
    if (!isTrustedSender(event.sender)) fail(new Error("Invalid IPC sender"));
}

/** Notify the renderer after settings.json changes. */
function emitChanged(settings: AppSettings): void
{
    const window = getMainWindow();
    if (window && !window.isDestroyed()) window.webContents.send(IPC_CHANNELS.settingsChanged, settings);
}

/** Register settings IPC handlers. */
export function registerSettingsHandlers(): void
{
    ipcMain.handle(IPC_CHANNELS.settingsGet, (event) =>
    {
        assertTrusted(event);
        return runIpc(() => settingsService.get());
    });

    ipcMain.handle(IPC_CHANNELS.settingsUpdate, (event, patch: unknown) => runIpc(async () =>
    {
        assertTrusted(event);
        const settings = await settingsService.update(patch);
        emitChanged(settings);
        return settings;
    }));
}
