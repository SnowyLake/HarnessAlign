/**
 * Convert thrown values into IPC errors without leaking Node exceptions to the renderer.
 */

import type { IpcMainInvokeEvent } from "electron";
import { HalignError } from "../../engine/Model.js";
import { isTrustedSender } from "../windows/MainWindow.js";

/** Throw an Error that the IPC wrapper can serialize for the renderer. */
export function fail(error: unknown): never
{
    const thrown = new Error(error instanceof Error ? error.message : String(error));
    thrown.name = error instanceof HalignError ? "HALIGN" : "INTERNAL";
    throw thrown;
}

/** Reject IPC from any WebContents other than the main window. */
export function assertTrusted(event: IpcMainInvokeEvent): void
{
    if (!isTrustedSender(event)) fail(new Error("Invalid IPC sender"));
}

/** Run privileged work and convert domain failures into IPC errors. */
export async function runIpc<T>(work: () => Promise<T>): Promise<T>
{
    try
    {
        return await work();
    }
    catch (error)
    {
        fail(error);
    }
}
