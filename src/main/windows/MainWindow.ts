/**
 * Sandboxed BrowserWindow factory.
 * Renderer has no Node integration; privileged work goes through `window.appApi`.
 */

import { BrowserWindow, dialog, type IpcMainInvokeEvent } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import appIcon from "../../../build/icon.ico?asset";
import { loadWindowState, MIN_WINDOW_SIZE, trackWindowState } from "./WindowState.js";
import { isAppUpdateInstallPending } from "../services/AppUpdateService.js";
import { logMainError } from "../services/ConsoleService.js";

let mainWindow: BrowserWindow | undefined;
let opening: Promise<BrowserWindow> | undefined;

/** Return the current BrowserWindow, if it still exists. */
export function getMainWindow(): BrowserWindow | undefined
{
    return mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
}

/** Return whether an IPC sender belongs to the main window. */
export function isTrustedSender(event: IpcMainInvokeEvent): boolean
{
    const window = getMainWindow();
    return window !== undefined && event.sender === window.webContents && event.senderFrame === event.sender.mainFrame
        && isAllowedRendererNavigation(event.senderFrame.url);
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
    const expected = new URL(import.meta.env.DEV && process.env.ELECTRON_RENDERER_URL
        ? process.env.ELECTRON_RENDERER_URL : pathToFileURL(join(__dirname, "../renderer/index.html")).href);
    parsed.hash = "";
    expected.hash = "";
    return parsed.href === expected.href;
}

/** Create the sandboxed main window and load the renderer. */
export async function createMainWindow(): Promise<BrowserWindow>
{
    const existing = getMainWindow();
    if (existing) return existing;
    if (opening) return opening;
    opening = openMainWindow();
    try
    {
        return await opening;
    }
    finally
    {
        opening = undefined;
    }
}

/** Build the BrowserWindow, restore saved bounds, and load the renderer. */
async function openMainWindow(): Promise<BrowserWindow>
{
    const restored = await loadWindowState();
    mainWindow = new BrowserWindow({
        width: restored.width,
        height: restored.height,
        ...(restored.x !== undefined && restored.y !== undefined ? { x: restored.x, y: restored.y } : {}),
        minWidth: MIN_WINDOW_SIZE.width,
        minHeight: MIN_WINDOW_SIZE.height,
        title: "Harness Align",
        icon: appIcon,
        backgroundColor: "#0c0d10",
        autoHideMenuBar: true,
        show: false,
        webPreferences: {
            preload: join(__dirname, "../preload/index.js"),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
        },
    });
    trackWindowState(mainWindow, mainWindow.getBounds());
    if (restored.isMaximized) mainWindow.maximize();
    mainWindow.once("ready-to-show", () =>
    {
        mainWindow?.show();
    });

    mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    mainWindow.webContents.on("will-prevent-unload", (event) =>
    {
        // The NSIS installer is already running. Cancelling quit cannot stop it.
        if (isAppUpdateInstallPending())
        {
            event.preventDefault();
            return;
        }
        const window = getMainWindow();
        if (!window) return;
        const choice = dialog.showMessageBoxSync(window, {
            type: "warning", message: "Discard unsaved changes?", buttons: ["Keep editing", "Discard changes"], defaultId: 0, cancelId: 0,
        });
        if (choice === 1) event.preventDefault();
    });
    mainWindow.webContents.on("will-navigate", (event, url) =>
    {
        if (!isAllowedRendererNavigation(url)) event.preventDefault();
    });
    mainWindow.webContents.on("will-redirect", (event, url) =>
    {
        if (!isAllowedRendererNavigation(url)) event.preventDefault();
    });

    const loading = import.meta.env.DEV && process.env.ELECTRON_RENDERER_URL
        ? mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
        : mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
    void loading.catch((error: unknown) =>
    {
        logMainError("Window load failed", error);
        mainWindow?.show();
    });

    mainWindow.on("closed", () =>
    {
        mainWindow = undefined;
    });

    return mainWindow;
}
