/** Choose the before and after columns for a sync review from the direction that will be written. */

/** File or source action that decides which version replaces the other. */
export interface SyncDiffInput
{
    action?: "unchanged" | "upload" | "apply" | "upload-apply" | "stop" | "conflict" | "unavailable";
    direction?: "upload" | "download" | "conflict" | "same";
    choice?: "local" | "remote";
    /** First-sync adoption. It overrides merge direction for a configuration source, not an additional-file action. */
    mode?: "initialize" | "merge" | "local" | "remote";
}

/** Left is the current text. Right is the text that will be written when `decisive` is true. */
export interface SyncDiffEnds
{
    before: "local" | "remote";
    after: "local" | "remote";
    summary: string;
    decisive: boolean;
    /** The saved plan result replaces both Local and Remote, so one pair of columns cannot show the write. */
    replacesBoth: boolean;
}

const LOCAL_WINS: SyncDiffEnds = { before: "remote", after: "local", summary: "Local replaces Remote", decisive: true, replacesBoth: false };
const REMOTE_WINS: SyncDiffEnds = { before: "local", after: "remote", summary: "Remote replaces Local", decisive: true, replacesBoth: false };

/** Orient the split diff so red lines are removed from the destination and green lines are written. */
export function syncDiffEnds(input: SyncDiffInput): SyncDiffEnds
{
    if (input.action === undefined && (input.mode === "local" || input.mode === "initialize")) return LOCAL_WINS;
    if (input.action === undefined && input.mode === "remote") return REMOTE_WINS;
    if (input.action === "upload" || (input.action === undefined && input.direction === "upload")) return LOCAL_WINS;
    if (input.action === "apply" || (input.action === undefined && input.direction === "download")) return REMOTE_WINS;
    if (input.action === "conflict" || input.direction === "conflict")
    {
        if (input.choice === "local") return LOCAL_WINS;
        if (input.choice === "remote") return REMOTE_WINS;
        return { before: "remote", after: "local", summary: "Choose a version. Red lines are only on Remote. Green lines are only on Local.", decisive: false, replacesBoth: false };
    }
    if (input.action === "upload-apply")
    {
        return { before: "remote", after: "local", summary: "The selected result replaces both Local and Remote.", decisive: true, replacesBoth: true };
    }
    if (input.action === "stop") return { before: "local", after: "remote", summary: "Sync will stop for this file. Local files stay in place.", decisive: false, replacesBoth: false };
    if (input.action === "unavailable") return { before: "local", after: "remote", summary: "This file is pending.", decisive: false, replacesBoth: false };
    return { before: "local", after: "remote", summary: "", decisive: false, replacesBoth: false };
}

/** Label a configuration row with the version that whole-sync adoption or merge will write. */
export function sourceDirectionLabel(direction: "upload" | "download" | "conflict" | "same", mode: "initialize" | "merge" | "local" | "remote", choice: "local" | "remote" | undefined): string
{
    if (mode === "local" || mode === "initialize") return "Local → Remote";
    if (mode === "remote") return "Remote → Local";
    if (direction === "conflict") return choice ? `Use ${choice === "local" ? "Local" : "Remote"}` : "Resolve conflict";
    if (direction === "upload") return "Local → Remote";
    if (direction === "download") return "Remote → Local";
    return "Unchanged";
}
