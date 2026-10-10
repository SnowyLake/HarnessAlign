/** Derive honest workflow labels from saved disk comparisons and unsaved editor state. */
import type { Workspace } from "../../../shared/models/Workspace.js";
import type { SyncPreview, SyncStatus } from "../../../shared/models/Sync.js";

/** One persistent stage with a concise label and an explanation for its detail view. */
export interface WorkflowStage
{
    name: "Edits" | "Generated" | "Setup" | "Sync";
    status: "success" | "warning" | "error" | "default";
    label: string;
    detail: string;
}

/** Keep draft uncertainty separate from disk drift and never claim live remote equality. */
export function workflowStages(workspace: Workspace, dirtyCount: number, sync: SyncStatus | undefined, preview?: SyncPreview): WorkflowStage[]
{
    const generated = workspace.generationStatus;
    const deployment = workspace.deploymentStatus;
    const skipped = deployment.changes.filter((change) => change.status === "skipped" && change.path !== "~/.agents/skills").length;
    const external = deployment.changes.some((change) => change.external && change.status !== "unchanged");
    const conflicts = preview?.changes.filter((change) => change.direction === "conflict").length ?? 0;
    const remotePending = !!preview && (preview.remoteEmpty || preview.firstSync || preview.uploadCount > 0 || preview.downloadCount > 0 || conflicts > 0);
    return [
        { name: "Edits", status: dirtyCount ? "warning" : "success", label: dirtyCount ? `${dirtyCount} unsaved` : "Saved",
            detail: dirtyCount ? "Save all to continue." : "" },
        { name: "Generated", status: generated.state === "error" ? "error" : dirtyCount || generated.state !== "current" ? "warning" : "success",
            label: generated.state === "error" ? "Error" : dirtyCount ? "Save first" : generated.state === "current" ? "Current" : "Generate needed",
            detail: generated.error ?? "" },
        { name: "Setup", status: deployment.state === "error" ? "error" : dirtyCount || deployment.state === "pending" || skipped ? "warning" : "success",
            label: deployment.state === "error" ? "Error" : dirtyCount ? "Save first" : external ? "Review changes" : deployment.state === "pending" ? "Deploy needed" : skipped ? "Skipped targets" : "Current",
            detail: deployment.error ?? (external ? "External edits detected. Review before overwriting. " : "")
                + (skipped ? `${skipped} unavailable targets.` : "") },
        { name: "Sync", status: !sync || !sync.connected ? "default" : sync.hasPendingUpload || dirtyCount || remotePending || sync.localState !== "current" ? "warning" : "success",
            label: !sync ? "Unknown" : !sync.connected ? "Not connected" : sync.hasPendingUpload ? "Recovery needed" : dirtyCount ? "Save first"
                : conflicts ? "Conflicts" : remotePending ? "Review sync" : sync.localState === "changed" ? "Sync needed" : sync.localState === "uninitialized" ? "First sync" : sync.localState === "current" ? "Locally synced" : "Check needed",
            detail: !sync ? "Open Sync to check status." : sync.localError ? sync.localError : !sync.connected ? "Connect GitHub to enable sync."
                : sync.hasPendingUpload ? "Open Sync to recover interrupted upload."
                : preview ? `${preview.uploadCount} uploads · ${preview.downloadCount} downloads · ${conflicts} conflicts` : "" },
    ];
}
