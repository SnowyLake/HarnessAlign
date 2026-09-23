/**
 * App IPC handlers. URLs from the renderer are validated here.
 * Update checks and downloads take no renderer payload.
 */

import { app, ipcMain, shell } from "electron";
import { IPC_CHANNELS } from "../../shared/contracts/IpcChannels.js";
import { HTTPS_URL_SCHEMA, LOG_INPUT_SCHEMA } from "../../shared/models/Schemas.js";
import { checkForAppUpdate, downloadAndInstallAppUpdate, getAppUpdateStatus, subscribeAppUpdate } from "../services/AppUpdateService.js";
import { appendLog, clearLogs, readLogs, subscribeLogs } from "../services/ConsoleService.js";
import { getMainWindow } from "../windows/MainWindow.js";
import { runIpc } from "../utils/Ipc.js";

/** Register app-level IPC handlers. */
export function registerAppHandlers(): void
{
    ipcMain.handle(IPC_CHANNELS.consoleRead, (event) => runIpc(event, readLogs));
    ipcMain.handle(IPC_CHANNELS.consoleAppend, (event, input: unknown) => runIpc(event, async () =>
    {
        appendLog(LOG_INPUT_SCHEMA.parse(input));
    }));
    ipcMain.handle(IPC_CHANNELS.consoleClear, (event) => runIpc(event, clearLogs));
    subscribeLogs((change) => getMainWindow()?.webContents.send(IPC_CHANNELS.consoleChanged, change));

    ipcMain.handle(IPC_CHANNELS.appGetVersion, (event) => runIpc(event, () => app.getVersion()));
    ipcMain.handle(IPC_CHANNELS.appUpdateStatus, (event) => runIpc(event, () => getAppUpdateStatus()));
    ipcMain.handle(IPC_CHANNELS.appUpdateCheck, (event) => runIpc(event, () => checkForAppUpdate()));
    ipcMain.handle(IPC_CHANNELS.appUpdateDownload, (event) => runIpc(event, () => downloadAndInstallAppUpdate()));
    subscribeAppUpdate((snapshot) =>
    {
        getMainWindow()?.webContents.send(IPC_CHANNELS.appUpdateChanged, snapshot);
    });

    ipcMain.handle(IPC_CHANNELS.appOpenExternal, (event, url: unknown) => runIpc(event, async () =>
    {
        await shell.openExternal(HTTPS_URL_SCHEMA.parse(url));
    }));
}
