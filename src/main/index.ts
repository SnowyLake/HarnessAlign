/**
 * Electron main-process entry: single-instance lock, IPC, sandboxed window, quit on last close.
 */

import { app, BrowserWindow } from "electron";
import * as http from "node:http";
import { registerIpcHandlers } from "./ipc/RegisterIpcHandlers.js";
import { createMainWindow, getMainWindow } from "./windows/MainWindow.js";
import { logMainError } from "./services/ConsoleService.js";

// Enable environment proxies before the first Node fetch; older Node 24 runtimes lack this API.
if ("setGlobalProxyFromEnv" in http && typeof http.setGlobalProxyFromEnv === "function") http.setGlobalProxyFromEnv();

/** Focus an existing main window, or create one when the previous instance has none. */
function focusMainWindow(): void
{
    const window = getMainWindow();
    if (!window)
    {
        void createMainWindow().catch((error: unknown) => logMainError("Window creation failed", error));
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
        void createMainWindow().catch((error: unknown) => logMainError("Window creation failed", error));
        app.on("activate", () =>
        {
            if (BrowserWindow.getAllWindows().length === 0) void createMainWindow().catch((error: unknown) => logMainError("Window creation failed", error));
        });
    }).catch((error: unknown) =>
    {
        logMainError("Application startup failed", error);
        app.exit(1);
    });

    app.on("window-all-closed", () =>
    {
        if (process.platform !== "darwin") app.quit();
    });
}
