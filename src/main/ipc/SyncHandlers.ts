/**
 * Trusted sync IPC and OS credential encryption. All operations share the workspace queue.
 * Stored tokens are decrypted only in Main and never returned to the renderer.
 */

import { app, ipcMain, safeStorage } from "electron";
import { z } from "zod";
import { HalignError } from "../../engine/Model.js";
import { IPC_CHANNELS } from "../../shared/contracts/IpcChannels.js";
import { SYNC_APPLY_SCHEMA, SYNC_CONNECTION_SCHEMA } from "../../shared/models/Schemas.js";
import { applySync, connectSync, disconnectSync, getSyncEncryptedToken, getSyncStatus, inspectSync, previewSync } from "../services/GitHubSyncService.js";
import { withWorkspace } from "../services/WorkspaceService.js";
import { runIpc } from "../utils/Ipc.js";

/** Read an OS-protected token inside the serialized operation that uses its connection. */
async function syncToken(directory: string): Promise<string>
{
    if (!safeStorage.isEncryptionAvailable()) throw new HalignError("Secure credential storage is unavailable on this device");
    const encrypted = await getSyncEncryptedToken(directory);
    try
    {
        return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
    }
    catch
    {
        throw new HalignError("The saved GitHub token cannot be decrypted on this device; reconnect with a new token");
    }
}

/** Register fixed sync capabilities after validating each sender and renderer payload. */
export function registerSyncHandlers(): void
{
    ipcMain.handle(IPC_CHANNELS.syncStatus, (event) => runIpc(event, async () =>
    {
        return withWorkspace(() => getSyncStatus(app.getPath("userData")));
    }));
    ipcMain.handle(IPC_CHANNELS.syncConnect, (event, input: unknown) => runIpc(event, async () =>
    {
        const connection = SYNC_CONNECTION_SCHEMA.parse(input);
        return withWorkspace(async () =>
        {
            if (!safeStorage.isEncryptionAvailable()) throw new HalignError("Secure credential storage is unavailable on this device");
            return connectSync(app.getPath("userData"), connection, safeStorage.encryptString(connection.token).toString("base64"));
        });
    }));
    ipcMain.handle(IPC_CHANNELS.syncDisconnect, (event) => runIpc(event, async () =>
    {
        return withWorkspace(() => disconnectSync(app.getPath("userData")));
    }));
    ipcMain.handle(IPC_CHANNELS.syncPreview, (event) => runIpc(event, async () =>
    {
        return withWorkspace(async (root) =>
        {
            const directory = app.getPath("userData");
            return previewSync(root, directory, await syncToken(directory));
        });
    }));
    ipcMain.handle(IPC_CHANNELS.syncInspect, (event, previewId: unknown, key: unknown) => runIpc(event, async () =>
    {
        const id = z.uuid().parse(previewId);
        const change = z.string().min(1).max(241).parse(key);
        return withWorkspace(async () => inspectSync(id, change));
    }));
    ipcMain.handle(IPC_CHANNELS.syncApply, (event, input: unknown) => runIpc(event, async () =>
    {
        const decisions = SYNC_APPLY_SCHEMA.parse(input);
        return withWorkspace(async (root) =>
        {
            const directory = app.getPath("userData");
            return applySync(root, directory, await syncToken(directory), decisions);
        });
    }));
}
