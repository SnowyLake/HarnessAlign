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
    hasPendingApplication?: boolean;
    localState?: "current" | "changed" | "uninitialized" | "unknown";
    localError?: string;
}

/** Side chosen for an entire conflicting unit. */
export type SyncChoice = "local" | "remote";
/** Choose an actual, remote, or unresolved legacy version before confirmation. */
export type SyncFileChoice = "target" | "remote" | "legacy" | "stop";
/** Direction determined from actual bytes, the remote version and the common baseline. */
export type FileSyncState = "match" | "local-changed" | "remote-changed" | "migration" | "conflict" | "missing" | "folder-missing" | "parent-missing" | "unsafe";

/** One actual-file effect in the same reviewed GitHub operation. */
export interface SyncFileChange
{
    key: string;
    target: string;
    state: FileSyncState;
    action: "unchanged" | "upload" | "apply" | "upload-apply" | "stop" | "conflict" | "unavailable";
    needsChoice: boolean;
    canUseTarget: boolean;
    canUseSource: boolean;
    hasLegacy?: boolean;
    error?: string;
}

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
    fileChanges: SyncFileChange[];
    applyCount: number;
    unresolvedCount: number;
    recoveryRequired: boolean;
    planError?: string;
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
    files: { path: string; local: SyncFileView | null; remote: SyncFileView | null; actual?: SyncFileView | null; saved?: SyncFileView | null; result?: SyncFileView | null }[];
    omittedFiles: number;
}

/** User decisions reference a retained preview rather than supplying arbitrary file writes. */
export interface SyncApplyInput
{
    previewId: string;
    mode: "initialize" | "merge" | "local" | "remote";
    choices: Record<string, SyncChoice>;
    fileChoices?: Record<string, SyncFileChoice> | undefined;
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
    applicationPending?: boolean;
}

/** Read-only startup result. `pending` means the Sync button should show work is waiting. */
export interface SyncCheckResult
{
    pending: boolean;
}

/** Report whether a preview still needs review, initialization, or upload recovery. */
export function syncPreviewHasWork(preview: Pick<SyncPreview, "remoteEmpty" | "uploadCount" | "downloadCount"> & Partial<Pick<SyncPreview, "applyCount" | "unresolvedCount" | "recoveryRequired" | "fileChanges">>, hasPendingUpload = false): boolean
{
    return hasPendingUpload || preview.recoveryRequired === true || preview.remoteEmpty || preview.uploadCount > 0 || preview.downloadCount > 0
        || (preview.applyCount ?? 0) > 0 || (preview.unresolvedCount ?? 0) > 0 || preview.fileChanges?.some((file) => file.action === "unavailable") === true;
}
