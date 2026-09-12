/**
 * Settings IPC handlers. Persist through the settings service and push changes to the renderer.
 */

import { ipcMain } from "electron";
import { IPC_CHANNELS } from "../../shared/contracts/IpcChannels.js";
import type { AppSettings } from "../../shared/models/AppSettings.js";
import { getSettings, updateSettings } from "../services/SettingsService.js";
import { runIpc } from "../utils/Ipc.js";
import { getMainWindow } from "../windows/MainWindow.js";

/** Notify the renderer after settings.json changes. */
function emitChanged(settings: AppSettings): void
{
    const window = getMainWindow();
    if (window && !window.isDestroyed()) window.webContents.send(IPC_CHANNELS.settingsChanged, settings);
}

/** Register settings IPC handlers. */
export function registerSettingsHandlers(): void
{
    ipcMain.handle(IPC_CHANNELS.settingsGet, (event) => runIpc(event, getSettings));

    ipcMain.handle(IPC_CHANNELS.settingsUpdate, (event, patch: unknown) => runIpc(event, async () =>
    {
        const settings = await updateSettings(patch);
        emitChanged(settings);
        return settings;
    }));
}
