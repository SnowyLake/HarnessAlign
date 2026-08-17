/**
 * Electron main-process entry: register IPC, open the sandboxed window, and quit when the last window closes.
 */

import { app, BrowserWindow } from "electron";
import { registerIpcHandlers } from "./ipc/RegisterIpcHandlers.js";
import { createMainWindow } from "./windows/MainWindow.js";

app.whenReady().then(() =>
{
    registerIpcHandlers();
    createMainWindow();
    app.on("activate", () =>
    {
        if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
}).catch((error: unknown) =>
{
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    app.exit(1);
});

app.on("window-all-closed", () =>
{
    if (process.platform !== "darwin") app.quit();
});
