/**
 * App IPC handlers. URLs from the renderer are validated here.
 */

import { app, ipcMain, shell } from "electron";
import { IPC_CHANNELS } from "../../shared/contracts/IpcChannels.js";
import { HTTPS_URL_SCHEMA, LOG_INPUT_SCHEMA } from "../../shared/models/Schemas.js";
import { appendLog, clearLogs, readLogs, subscribeLogs } from "../services/ConsoleService.js";
import { getMainWindow } from "../windows/MainWindow.js";
import { assertTrusted, runIpc } from "../utils/Ipc.js";

/** Register app-level IPC handlers. */
export function registerAppHandlers(): void
{
    ipcMain.handle(IPC_CHANNELS.consoleRead, (event) =>
    {
        assertTrusted(event);
        return readLogs();
    });
    ipcMain.handle(IPC_CHANNELS.consoleAppend, (event, input: unknown) => runIpc(async () =>
    {
        assertTrusted(event);
        appendLog(LOG_INPUT_SCHEMA.parse(input));
    }));
    ipcMain.handle(IPC_CHANNELS.consoleClear, (event) =>
    {
        assertTrusted(event);
        clearLogs();
    });
    subscribeLogs((change) => getMainWindow()?.webContents.send(IPC_CHANNELS.consoleChanged, change));

    ipcMain.handle(IPC_CHANNELS.appGetVersion, (event) =>
    {
        assertTrusted(event);
        return app.getVersion();
    });

    ipcMain.handle(IPC_CHANNELS.appOpenExternal, (event, url: unknown) => runIpc(async () =>
    {
        assertTrusted(event);
        await shell.openExternal(HTTPS_URL_SCHEMA.parse(url));
    }));
}
