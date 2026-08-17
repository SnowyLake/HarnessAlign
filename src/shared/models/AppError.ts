/**
 * Structured IPC error DTO. Main converts thrown values here before they reach the renderer.
 */

/** Structured error returned across IPC to the renderer. */
export interface AppError
{
    code: string;
    message: string;
    details?: unknown;
}
