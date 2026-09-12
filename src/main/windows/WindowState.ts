/**
 * Persist main-window bounds in Electron userData.
 * Renderer never sees this file; Main restores and clamps against the current display work area.
 */

import { app, screen, type BrowserWindow, type Rectangle } from "electron";
import { logMainError } from "../services/ConsoleService.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import { join } from "node:path";

/** Saved window placement used the next time the main window opens. */
interface WindowState
{
    x: number;
    y: number;
    width: number;
    height: number;
    isMaximized: boolean;
}

/** Default restored size matching the BrowserWindow factory. */
const DEFAULT_BOUNDS = { width: 1280, height: 840 };
/** Minimum overlap in pixels required before a saved rect counts as on-screen. */
const MIN_VISIBLE_PX = 80;

/** Return the window-state.json path under Electron userData. */
function windowStatePath(): string
{
    return join(app.getPath("userData"), "window-state.json");
}

/** Return whether `bounds` intersects a display work area enough to restore. */
function isVisibleOnScreen(bounds: Rectangle): boolean
{
    const workArea = screen.getDisplayMatching(bounds).workArea;
    const overlapWidth = Math.min(bounds.x + bounds.width, workArea.x + workArea.width) - Math.max(bounds.x, workArea.x);
    const overlapHeight = Math.min(bounds.y + bounds.height, workArea.y + workArea.height) - Math.max(bounds.y, workArea.y);
    return overlapWidth >= MIN_VISIBLE_PX && overlapHeight >= MIN_VISIBLE_PX;
}

/** Saved size plus optional position. Omit `x`/`y` so Electron centers a new window. */
export interface RestoredWindowState
{
    width: number;
    height: number;
    x?: number;
    y?: number;
    isMaximized: boolean;
}

/** Read saved bounds, or defaults when the file is missing, invalid, or off-screen. */
export async function loadWindowState(): Promise<RestoredWindowState>
{
    try
    {
        const parsed: unknown = JSON.parse(await fs.readFile(windowStatePath(), "utf8"));
        if (
            typeof parsed !== "object"
            || parsed === null
            || !("x" in parsed && "y" in parsed && "width" in parsed && "height" in parsed && "isMaximized" in parsed)
            || typeof parsed.x !== "number"
            || typeof parsed.y !== "number"
            || typeof parsed.width !== "number"
            || typeof parsed.height !== "number"
            || typeof parsed.isMaximized !== "boolean"
            || !Number.isFinite(parsed.x)
            || !Number.isFinite(parsed.y)
            || !Number.isFinite(parsed.width)
            || !Number.isFinite(parsed.height)
            || parsed.width < 960
            || parsed.height < 640
        )
        {
            return { ...DEFAULT_BOUNDS, isMaximized: false };
        }
        const bounds = { x: parsed.x, y: parsed.y, width: parsed.width, height: parsed.height };
        if (!isVisibleOnScreen(bounds)) return { ...DEFAULT_BOUNDS, isMaximized: parsed.isMaximized };
        return { ...bounds, isMaximized: parsed.isMaximized };
    }
    catch (error)
    {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) logMainError("Window state reset to defaults", error);
        return { ...DEFAULT_BOUNDS, isMaximized: false };
    }
}

/** Persist window placement before the process can quit. */
function writeWindowState(window: BrowserWindow, normalBounds: Rectangle): void
{
    const state: WindowState = {
        ...normalBounds,
        isMaximized: window.isMaximized(),
    };
    mkdirSync(app.getPath("userData"), { recursive: true });
    writeFileSync(windowStatePath(), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

/** Keep `normalBounds` in sync and persist on close. */
export function trackWindowState(window: BrowserWindow, initial: Rectangle): void
{
    let normalBounds = { ...initial };
    let saveTimer: ReturnType<typeof setTimeout> | undefined;

    /** Capture unmaximized bounds so a maximized session can restore the previous size. */
    const captureNormalBounds = (): void =>
    {
        if (!window.isMaximized() && !window.isMinimized() && !window.isFullScreen())
        {
            normalBounds = window.getBounds();
        }
    };

    /** Debounce disk writes while the user is still dragging or resizing. */
    const scheduleSave = (): void =>
    {
        captureNormalBounds();
        if (saveTimer !== undefined) clearTimeout(saveTimer);
        saveTimer = setTimeout(() =>
        {
            try
            {
                writeWindowState(window, normalBounds);
            }
            catch (error: unknown)
            {
                logMainError("Window state save failed", error);
            }
        }, 200);
    };

    window.on("move", scheduleSave);
    window.on("resize", scheduleSave);
    window.on("close", () =>
    {
        if (saveTimer !== undefined) clearTimeout(saveTimer);
        captureNormalBounds();
        try
        {
            writeWindowState(window, normalBounds);
        }
        catch (error: unknown)
        {
            logMainError("Window state save failed", error);
        }
    });
}
