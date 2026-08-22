/**
 * App IPC handlers. Paths and URLs from the renderer are validated here.
 */

import { app, ipcMain, shell } from "electron";
import { join } from "node:path";
import { ensureUserWorkspace } from "../../engine/Edit.js";
import { HalignError } from "../../engine/Model.js";
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

    ipcMain.handle(IPC_CHANNELS.appOpenConfigDirectory, (event) => runIpc(async () =>
    {
        assertTrusted(event);
        const directory = join(await ensureUserWorkspace(), ".halign");
        const error = await shell.openPath(directory);
        if (error) throw new HalignError(`failed to open ${directory}: ${error}`);
        return directory;
    }));
}
