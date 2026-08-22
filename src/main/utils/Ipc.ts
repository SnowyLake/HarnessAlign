/**
 * Convert thrown values into IPC errors without leaking Node exceptions to the renderer.
 */

import type { IpcMainInvokeEvent } from "electron";
import { HalignError } from "../../engine/Model.js";
import type { AppError } from "../../shared/models/AppError.js";
import { isTrustedSender } from "../windows/MainWindow.js";

/** Convert an unknown thrown value into the IPC error DTO. */
export function toAppError(error: unknown): AppError
{
    if (error instanceof HalignError) return { code: "HALIGN", message: error.message };
    if (error instanceof Error) return { code: "INTERNAL", message: error.message };
    return { code: "INTERNAL", message: String(error) };
}

/** Throw an Error that the IPC wrapper can serialize for the renderer. */
export function fail(error: unknown): never
{
    const appError = toAppError(error);
    const thrown = new Error(appError.message);
    thrown.name = appError.code;
    throw thrown;
}

/** Reject IPC from any WebContents other than the main window. */
export function assertTrusted(event: IpcMainInvokeEvent): void
{
    if (!isTrustedSender(event.sender)) fail(new Error("Invalid IPC sender"));
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
