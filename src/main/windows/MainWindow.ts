/**
 * Sandboxed BrowserWindow factory.
 * Renderer has no Node integration; privileged work goes through `window.appApi`.
 */

import { BrowserWindow } from "electron";
import { join } from "node:path";

let mainWindow: BrowserWindow | undefined;

/** Return the current BrowserWindow, if it still exists. */
export function getMainWindow(): BrowserWindow | undefined
{
    return mainWindow;
}

/** Return whether an IPC sender belongs to the main window. */
export function isTrustedSender(sender: Electron.WebContents): boolean
{
    return mainWindow !== undefined && sender.id === mainWindow.webContents.id;
}

/** Return whether renderer navigation is allowed for the current runtime. */
function isAllowedRendererNavigation(url: string): boolean
{
    let parsed: URL;
    try
    {
        parsed = new URL(url);
    }
    catch
    {
        return false;
    }
    if (import.meta.env.DEV) return parsed.protocol === "http:" && parsed.hostname === "localhost";
    return parsed.protocol === "file:";
}

/** Create the sandboxed main window and load the renderer. */
export function createMainWindow(): BrowserWindow
{
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 840,
        minWidth: 960,
        minHeight: 640,
        title: "Harness Align",
        backgroundColor: "#0c0d10",
        autoHideMenuBar: true,
        webPreferences: {
            preload: join(__dirname, "../preload/index.js"),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
        },
    });

    mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    mainWindow.webContents.on("will-navigate", (event, url) =>
    {
        if (!isAllowedRendererNavigation(url)) event.preventDefault();
    });

    if (import.meta.env.DEV && process.env.ELECTRON_RENDERER_URL)
    {
        void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL).catch((error: unknown) =>
        {
            process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        });
    }
    else
    {
        void mainWindow.loadFile(join(__dirname, "../renderer/index.html")).catch((error: unknown) =>
        {
            process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        });
    }

    mainWindow.on("closed", () =>
    {
        mainWindow = undefined;
    });

    return mainWindow;
}
