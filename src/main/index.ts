/**
 * Electron main-process entry: single-instance lock, IPC, sandboxed window, quit on last close.
 */

import { app, BrowserWindow } from "electron";
import { registerIpcHandlers } from "./ipc/RegisterIpcHandlers.js";
import { createMainWindow, getMainWindow } from "./windows/MainWindow.js";

/** Focus an existing main window, or create one when the previous instance has none. */
function focusMainWindow(): void
{
    const window = getMainWindow();
    if (!window)
    {
        void createMainWindow();
        return;
    }
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
}

if (!app.requestSingleInstanceLock())
{
    app.quit();
}
else
{
    app.on("second-instance", () =>
    {
        focusMainWindow();
    });

    app.whenReady().then(() =>
    {
        registerIpcHandlers();
        void createMainWindow();
        app.on("activate", () =>
        {
            if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
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
}
