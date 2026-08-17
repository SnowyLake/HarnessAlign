/**
 * App IPC handlers. Paths and URLs from the renderer are validated here.
 */

import { app, ipcMain, type IpcMainInvokeEvent, shell } from "electron";
import { IPC_CHANNELS } from "../../shared/contracts/IpcChannels.js";
import { HTTPS_URL_SCHEMA } from "../../shared/models/Schemas.js";
import { fail, runIpc } from "../utils/Ipc.js";
import { isTrustedSender } from "../windows/MainWindow.js";

/** Reject IPC from any WebContents other than the main window. */
function assertTrusted(event: IpcMainInvokeEvent): void
{
    if (!isTrustedSender(event.sender)) fail(new Error("Invalid IPC sender"));
}

/** Register app-level IPC handlers. */
export function registerAppHandlers(): void
{
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
