/**
 * Renderer-only UI state. Workspace files stay in Main; this store never reads the filesystem.
 */

import { create } from "zustand";
import type { ThemeMode } from "@shared/models/AppSettings";
import type { Workspace } from "@shared/models/Workspace";

/** Workspace modules available from the primary navigation. */
export type WorkspaceView = "project" | "rules" | "domain" | "agents" | "generated";

/** Top-level desktop shell view. */
export type AppView = WorkspaceView | "settings" | "showcase";

/** Tone applied to output notifications and the full output dialog. */
export type OutputTone = "neutral" | "success" | "error";

/** Currently selected workspace editor target. */
export type Selection =
    | { kind: "config" }
    | { kind: "harness"; name: string }
    | { kind: "harness-new" }
    | { kind: "profile"; name: string }
    | { kind: "profile-new" }
    | { kind: "rule"; path: string }
    | { kind: "rule-new"; scope: "root" | "domain" | "shared"; profile?: string }
    | { kind: "agent"; path: string }
    | { kind: "agent-new" }
    | { kind: "generated" }
    | { kind: "generated-file"; path: string };

/** Stable remount key for uncontrolled forms bound to the current selection. */
export function selectionKey(selection: Selection): string
{
    switch (selection.kind)
    {
        case "config":
            return "config";
        case "harness":
            return `harness:${selection.name}`;
        case "harness-new":
            return "harness-new";
        case "profile":
            return `profile:${selection.name}`;
        case "profile-new":
            return "profile-new";
        case "rule":
            return `rule:${selection.path}`;
        case "rule-new":
            return `rule-new:${selection.scope}:${selection.profile ?? ""}`;
        case "agent":
            return `agent:${selection.path}`;
        case "agent-new":
            return "agent-new";
        case "generated":
            return "generated";
        case "generated-file":
            return `generated-file:${selection.path}`;
    }
}

/** Return whether a selection belongs to the requested workspace module and still exists. */
function selectionMatchesView(view: WorkspaceView, selection: Selection, workspace: Workspace, profile: string): boolean
{
    switch (view)
    {
        case "project":
            return selection.kind === "config"
                || selection.kind === "harness-new"
                || (selection.kind === "harness" && workspace.config.harnesses.some((item) => item.name === selection.name))
                || selection.kind === "profile-new"
                || (selection.kind === "profile" && workspace.config.profiles.includes(selection.name));
        case "rules":
            return (selection.kind === "rule-new" && selection.scope !== "domain")
                || (selection.kind === "rule" && [...workspace.rootRules, ...workspace.sharedRules].some((item) => item.path === selection.path));
        case "domain":
            return (selection.kind === "rule-new" && selection.scope === "domain" && selection.profile === profile)
                || (selection.kind === "rule" && (workspace.domainRules[profile] ?? []).some((item) => item.path === selection.path));
        case "agents":
            return selection.kind === "agent-new"
                || (selection.kind === "agent" && workspace.agents.some((item) => item.path === selection.path));
        case "generated":
            return (selection.kind === "generated" && workspace.generatedFiles.length === 0)
                || (selection.kind === "generated-file" && workspace.generatedFiles.some((item) => item.path === selection.path));
    }
}

/** Choose the first useful editor target when entering a workspace module. */
function selectionForView(view: WorkspaceView, selection: Selection, workspace: Workspace | undefined, profile: string): Selection
{
    if (!workspace) return view === "generated" ? { kind: "generated" } : { kind: "config" };
    const selectedProfile = workspace.config.profiles.includes(profile) ? profile : workspace.config.defaultProfile;
    if (selectionMatchesView(view, selection, workspace, selectedProfile)) return selection;
    switch (view)
    {
        case "project":
            return { kind: "config" };
        case "rules":
        {
            const rule = workspace.rootRules[0] ?? workspace.sharedRules[0];
            return rule ? { kind: "rule", path: rule.path } : { kind: "rule-new", scope: "root" };
        }
        case "domain":
        {
            const rule = workspace.domainRules[selectedProfile]?.[0];
            return rule ? { kind: "rule", path: rule.path } : { kind: "rule-new", scope: "domain", profile: selectedProfile };
        }
        case "agents":
        {
            const agent = workspace.agents[0];
            return agent ? { kind: "agent", path: agent.path } : { kind: "agent-new" };
        }
        case "generated":
        {
            const file = workspace.generatedFiles[0];
            return file ? { kind: "generated-file", path: file.path } : { kind: "generated" };
        }
    }
}

/** Zustand state and setters for the desktop shell. */
interface AppState
{
    view: AppView;
    workspace: Workspace | undefined;
    selection: Selection;
    profile: string;
    output: string;
    outputTone: OutputTone;
    outputTitle: string;
    outputNoticeId: number;
    isOutputNoticeVisible: boolean;
    isOutputDialogOpen: boolean;
    isBusy: boolean;
    theme: ThemeMode;
    setView: (view: AppView) => void;
    setWorkspace: (workspace: Workspace | undefined) => void;
    setSelection: (selection: Selection) => void;
    setProfile: (profile: string) => void;
    setOutput: (output: string, tone?: OutputTone, title?: string) => void;
    dismissOutputNotice: () => void;
    setOutputDialogOpen: (isOpen: boolean) => void;
    setIsBusy: (isBusy: boolean) => void;
    setTheme: (theme: ThemeMode) => void;
    beginBusy: () => void;
    endBusy: () => void;
}

/** Renderer UI state for workspace modules, settings, and command progress. */
export const useAppStore = create<AppState>((set) => ({
    view: "project",
    workspace: undefined,
    selection: { kind: "config" },
    profile: "",
    output: "Open a directory that contains .halign.",
    outputTone: "neutral",
    outputTitle: "Output",
    outputNoticeId: 0,
    isOutputNoticeVisible: false,
    isOutputDialogOpen: false,
    isBusy: false,
    theme: "system",
    setView: (view) => set((state) => ({
        view,
        selection: view === "settings" || view === "showcase"
            ? state.selection
            : selectionForView(view, state.selection, state.workspace, state.profile),
    })),
    setWorkspace: (workspace) => set((state) => ({
        workspace,
        selection: state.view === "settings" || state.view === "showcase"
            ? state.selection
            : selectionForView(state.view, state.selection, workspace, state.profile),
    })),
    setSelection: (selection) => set({ selection }),
    setProfile: (profile) => set((state) => ({
        profile,
        selection: state.view === "domain"
            ? selectionForView("domain", state.selection, state.workspace, profile)
            : state.selection,
    })),
    setOutput: (output, tone = "neutral", title = "Output") => set((state) => ({
        output,
        outputTone: tone,
        outputTitle: title,
        outputNoticeId: state.outputNoticeId + 1,
        isOutputNoticeVisible: true,
    })),
    dismissOutputNotice: () => set({ isOutputNoticeVisible: false }),
    setOutputDialogOpen: (isOutputDialogOpen) => set({ isOutputDialogOpen }),
    setIsBusy: (isBusy) => set({ isBusy }),
    setTheme: (theme) => set({ theme }),
    beginBusy: () => set({ isBusy: true }),
    endBusy: () => set({ isBusy: false }),
}));
