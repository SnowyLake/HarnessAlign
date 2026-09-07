/**
 * App IPC handlers. URLs from the renderer are validated here.
 */

import { app, ipcMain, shell } from "electron";
import { IPC_CHANNELS } from "../../shared/contracts/IpcChannels.js";
import { HTTPS_URL_SCHEMA } from "../../shared/models/Schemas.js";
import { assertTrusted, runIpc } from "../utils/Ipc.js";

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
