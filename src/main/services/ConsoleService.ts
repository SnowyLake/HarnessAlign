/** In-memory application log history, retained until Main exits and never written to disk. */

import { EventEmitter } from "node:events";
import type { LogChange, LogEntry, LogInput, LogSnapshot } from "../../shared/models/Console.js";

const EVENTS = new EventEmitter();
let entries: LogEntry[] = [];
let revision = 0;

/** Append one record and publish an incremental event to the renderer. */
export function appendLog(input: LogInput): void
{
    const entry: LogEntry = { ...input, id: ++revision, timestamp: new Date().toISOString() };
    entries.push(entry);
    EVENTS.emit("change", { revision, entry } satisfies LogChange);
}

/** Record a Main failure without depending on an available renderer. */
export function logMainError(title: string, error: unknown): void
{
    appendLog({ level: "error", title, details: error instanceof Error ? error.stack ?? error.message : String(error) });
}

/** Read a stable snapshot for initial history hydration. */
export function readLogs(): LogSnapshot
{
    return { revision, entries: [...entries] };
}

/** Clear retained entries without reusing ids from this application run. */
export function clearLogs(): void
{
    entries = [];
    EVENTS.emit("change", { revision: ++revision, entry: null } satisfies LogChange);
}

/** Observe appends and clears without repeatedly transferring the full history. */
export function subscribeLogs(callback: (change: LogChange) => void): () => void
{
    EVENTS.on("change", callback);
    return () => { EVENTS.off("change", callback); };
}
