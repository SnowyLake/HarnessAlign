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
    mode: "merge" | "local" | "remote";
    choices: Record<string, SyncChoice>;
}

/** Completion report delivered after local sources and the common baseline are saved. */
export interface SyncResult
{
    status: SyncStatus;
    message: string;
}
