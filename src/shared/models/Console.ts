/** Session log contracts shared by Main, Preload, and Renderer without runtime dependencies. */

/** An operation summary with diagnostic text kept separate from notifications. */
export interface LogInput
{
    level: "info" | "success" | "error";
    title: string;
    details: string;
}

/** A timestamped record assigned a monotonically increasing id by Main. */
export interface LogEntry extends LogInput
{
    id: number;
    timestamp: string;
}

/** One ordered append or clear event from the application session. */
export interface LogChange
{
    revision: number;
    entry: LogEntry | null;
}

/** Initial history used when the renderer starts or reloads. */
export interface LogSnapshot
{
    revision: number;
    entries: LogEntry[];
}
