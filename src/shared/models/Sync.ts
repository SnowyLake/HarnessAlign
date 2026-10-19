/** Typed sync capabilities expose relative source names and previews, never stored credentials or local roots. */

/** A private GitHub repository connection supplied once by the user. */
export interface SyncConnectionInput
{
    owner: string;
    repository: string;
    branch: string;
    token: string;
}

/** Public connection status with no credential material. */
export interface SyncStatus
{
    connected: boolean;
    owner: string;
    repository: string;
    branch: string;
    lastSyncedAt: string | null;
    hasPendingUpload: boolean;
    localState?: "current" | "changed" | "uninitialized" | "unknown";
    localError?: string;
}

/** Side chosen for an entire conflicting unit. */
export type SyncChoice = "local" | "remote";

/** A file, directory, or whole skill changed since the common baseline. */
export interface SyncChange
{
    key: string;
    paths: string[];
    direction: "upload" | "download" | "conflict" | "same";
}

/** A server-owned preview bound to exact local and remote versions. */
export interface SyncPreview
{
    id: string;
    head: string;
    firstSync: boolean;
    remoteEmpty: boolean;
    uploadCount: number;
    downloadCount: number;
    changes: SyncChange[];
    notice: string;
}

/** Bounded content preview for a regular file or binary asset. */
export interface SyncFileView
{
    bytes: number;
    hash: string;
    text: string | null;
    truncated: boolean;
}

/** Side-by-side file content for a changed unit. */
export interface SyncDetail
{
    files: { path: string; local: SyncFileView | null; remote: SyncFileView | null }[];
    omittedFiles: number;
}

/** User decisions reference a retained preview rather than supplying arbitrary file writes. */
export interface SyncApplyInput
{
    previewId: string;
    mode: "initialize" | "merge" | "local" | "remote";
    choices: Record<string, SyncChoice>;
}

/** One source group selected from a retained preview for immediate local restoration. */
export interface SyncDiscardInput
{
    previewId: string;
    key: string;
}

/** Completion report delivered after a sync or local restoration operation. */
export interface SyncResult
{
    status: SyncStatus;
    message: string;
}

/** Read-only startup result. `pending` means the Sync button should show work is waiting. */
export interface SyncCheckResult
{
    pending: boolean;
}

/** Report whether a preview still needs review, initialization, or upload recovery. */
export function syncPreviewHasWork(preview: Pick<SyncPreview, "remoteEmpty" | "uploadCount" | "downloadCount">, hasPendingUpload = false): boolean
{
    return hasPendingUpload || preview.remoteEmpty || preview.uploadCount > 0 || preview.downloadCount > 0;
}
