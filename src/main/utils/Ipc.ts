/**
 * Convert thrown values into IPC errors without leaking Node exceptions to the renderer.
 */

import type { IpcMainInvokeEvent } from "electron";
import { HalignError } from "../../engine/Model.js";
import { isTrustedSender } from "../windows/MainWindow.js";

/** Verify the sender before running privileged work and normalize failures for IPC. */
export async function runIpc<T>(event: IpcMainInvokeEvent, work: () => T | Promise<T>): Promise<T>
{
    try
    {
        if (!isTrustedSender(event)) throw new Error("Invalid IPC sender");
        return await work();
    }
    catch (error)
    {
        const thrown = new Error(error instanceof Error ? error.message : String(error));
        thrown.name = error instanceof HalignError ? "HALIGN" : "INTERNAL";
        throw thrown;
    }
}
