/**
 * Renderer-only UI state. Workspace files stay in Main; this store never reads the filesystem.
 */

import { create } from "zustand";
import type { ThemeMode } from "@shared/models/AppSettings";
import type { LayerSelection, Workspace } from "@shared/models/Workspace";

/** Workspace modules available from the primary navigation. */
export type WorkspaceView = "project" | "rules" | "shared-rules" | "layer-registration" | "layer-editor" | "skills" | "skill-registration" | "agents" | "generated";

/** Top-level desktop shell view. */
export type AppView = WorkspaceView | "settings" | "showcase";

/** Tone applied to output notifications and the full output dialog. */
export type OutputTone = "success" | "error";

/** Currently selected workspace editor target. */
export type Selection =
    | { kind: "config" }
    | { kind: "harness"; name: string }
    | { kind: "harness-new" }
    | { kind: "layer"; name: string }
    | { kind: "layer-new" }
    | { kind: "layer-option"; path: string }
    | { kind: "layer-option-new"; layer: string }
    | { kind: "rule"; path: string }
    | { kind: "rule-new"; scope: "root" | "shared" }
    | { kind: "agent"; path: string }
    | { kind: "agent-new" }
    | { kind: "generated" }
    | { kind: "generated-file"; path: string };

/** Form values captured for one editor, grouped by field name. */
export type FormSnapshot = Record<string, string[]>;

/** Unsaved editor values and the persisted baseline used for dirty checks. */
export interface EditorDraft
{
    selection: Selection;
    baseline: FormSnapshot;
    current: FormSnapshot;
}

/** Commands that can be requested from a workspace tree item. */
export type EditorAction = "save" | "delete";

/** One tree command waiting for the matching editor to handle it. */
export interface PendingEditorAction
{
    id: number;
    key: string;
    action: EditorAction;
}

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
        case "layer":
            return `layer:${selection.name}`;
        case "layer-new":
            return "layer-new";
        case "layer-option":
            return `layer-option:${selection.path}`;
        case "layer-option-new":
            return `layer-option-new:${selection.layer}`;
        case "rule":
            return `rule:${selection.path}`;
        case "rule-new":
            return `rule-new:${selection.scope}`;
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
function selectionMatchesView(view: WorkspaceView, selection: Selection, workspace: Workspace): boolean
{
    switch (view)
    {
        case "project":
            return selection.kind === "harness-new"
                || (selection.kind === "harness" && workspace.config.harnesses.some((item) => item.name === selection.name));
        case "rules":
            return (selection.kind === "rule-new" && selection.scope === "root")
                || (selection.kind === "rule" && workspace.rootRules.some((item) => item.path === selection.path));
        case "shared-rules":
            return (selection.kind === "rule-new" && selection.scope === "shared")
                || (selection.kind === "rule" && workspace.sharedRules.some((item) => item.path === selection.path));
        case "layer-registration":
            return true;
        case "layer-editor":
            return selection.kind === "layer-new"
                || (selection.kind === "layer" && Object.hasOwn(workspace.layerOptions, selection.name))
                || (selection.kind === "layer-option-new" && Object.hasOwn(workspace.layerOptions, selection.layer))
                || (selection.kind === "layer-option" && Object.values(workspace.layerOptions).flat().some((item) => item.path === selection.path));
        case "skills":
        case "skill-registration":
            return true;
        case "agents":
            return selection.kind === "agent-new"
                || (selection.kind === "agent" && workspace.agents.some((item) => item.path === selection.path));
        case "generated":
            return (selection.kind === "generated" && workspace.generatedFiles.length === 0)
                || (selection.kind === "generated-file" && workspace.generatedFiles.some((item) => item.path === selection.path));
    }
}

/** Choose the first useful editor target when entering a workspace module. */
function selectionForView(view: WorkspaceView, selection: Selection, workspace: Workspace | undefined): Selection
{
    if (!workspace) return view === "generated" ? { kind: "generated" } : { kind: "config" };
    if (selectionMatchesView(view, selection, workspace)) return selection;
    switch (view)
    {
        case "project":
        {
            const harness = workspace.config.harnesses[0];
            return harness ? { kind: "harness", name: harness.name } : { kind: "harness-new" };
        }
        case "rules":
        {
            const rule = workspace.rootRules[0];
            return rule ? { kind: "rule", path: rule.path } : { kind: "rule-new", scope: "root" };
        }
        case "shared-rules":
        {
            const rule = workspace.sharedRules[0];
            return rule ? { kind: "rule", path: rule.path } : { kind: "rule-new", scope: "shared" };
        }
        case "layer-registration":
            return selection;
        case "layer-editor":
        {
            const layer = Object.keys(workspace.layerOptions)[0];
            if (!layer) return { kind: "layer-new" };
            const option = workspace.layerOptions[layer]?.[0];
            return option ? { kind: "layer-option", path: option.path } : { kind: "layer", name: layer };
        }
        case "skills":
        case "skill-registration":
            return selection;
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

/** Build the saved ordered layer selection for a workspace. */
function savedLayerSelection(workspace: Workspace | undefined): LayerSelection[]
{
    return workspace?.config.layers.map((layer) => ({ name: layer.name, option: layer.selected })) ?? [];
}

/** Preserve the current Project Layer membership while dropping deleted catalog entries. */
function reconcileLayerSelection(current: readonly LayerSelection[], workspace: Workspace): LayerSelection[]
{
    const next: LayerSelection[] = [];
    for (const selection of current)
    {
        const options = Object.hasOwn(workspace.layerOptions, selection.name) ? workspace.layerOptions[selection.name] : undefined;
        if (!options?.length) continue;
        const saved = workspace.config.layers.find((layer) => layer.name === selection.name)?.selected;
        const option = options.some((candidate) => candidate.name === selection.option)
            ? selection.option
            : saved && options.some((candidate) => candidate.name === saved)
                ? saved
                : options[0]!.name;
        next.push({ name: selection.name, option });
    }
    return next;
}

/** Zustand state and setters for the desktop shell. */
interface AppState
{
    view: AppView;
    workspace: Workspace | undefined;
    selection: Selection;
    layerSelection: LayerSelection[];
    output: string;
    outputTone: OutputTone;
    outputTitle: string;
    outputNoticeId: number;
    isOutputNoticeVisible: boolean;
    isOutputDialogOpen: boolean;
    isBusy: boolean;
    theme: ThemeMode;
    editorDrafts: Record<string, EditorDraft>;
    pendingEditorAction: PendingEditorAction | undefined;
    nextEditorActionId: number;
    setView: (view: AppView) => void;
    setWorkspace: (workspace: Workspace | undefined) => void;
    setSelection: (selection: Selection) => void;
    setLayerSelection: (selection: LayerSelection[]) => void;
    setOutput: (output: string, tone: OutputTone, title: string) => void;
    dismissOutputNotice: () => void;
    setOutputDialogOpen: (isOpen: boolean) => void;
    setIsBusy: (isBusy: boolean) => void;
    setTheme: (theme: ThemeMode) => void;
    setEditorDraft: (key: string, draft: EditorDraft | undefined) => void;
    clearEditorDraft: (key: string) => void;
    requestEditorAction: (selection: Selection, action: EditorAction) => void;
    consumeEditorAction: (id: number) => void;
}

/** Renderer UI state for workspace modules, settings, and command progress. */
export const useAppStore = create<AppState>((set) => ({
    view: "project",
    workspace: undefined,
    selection: { kind: "config" },
    layerSelection: [],
    output: "Loading the user workspace.",
    outputTone: "success",
    outputTitle: "Output",
    outputNoticeId: 0,
    isOutputNoticeVisible: false,
    isOutputDialogOpen: false,
    isBusy: false,
    theme: "system",
    editorDrafts: {},
    pendingEditorAction: undefined,
    nextEditorActionId: 1,
    setView: (view) => set((state) => ({
        view,
        selection: view === "settings" || view === "showcase"
            ? state.selection
            : selectionForView(view, state.selection, state.workspace),
    })),
    setWorkspace: (workspace) => set((state) =>
    {
        const isDifferentRoot = state.workspace?.root !== workspace?.root;
        return {
            workspace,
            selection: state.view === "settings" || state.view === "showcase"
                ? state.selection
                : selectionForView(state.view, state.selection, workspace),
            layerSelection: !workspace
                ? []
                : isDifferentRoot
                    ? savedLayerSelection(workspace)
                    : reconcileLayerSelection(state.layerSelection, workspace),
            editorDrafts: isDifferentRoot ? {} : state.editorDrafts,
            pendingEditorAction: isDifferentRoot ? undefined : state.pendingEditorAction,
        };
    }),
    setSelection: (selection) => set({ selection }),
    setLayerSelection: (layerSelection) => set({ layerSelection }),
    setOutput: (output, tone, title) => set((state) => ({
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
    setEditorDraft: (key, draft) => set((state) =>
    {
        const editorDrafts = { ...state.editorDrafts };
        if (draft) editorDrafts[key] = draft;
        else delete editorDrafts[key];
        return { editorDrafts };
    }),
    clearEditorDraft: (key) => set((state) =>
    {
        if (!(key in state.editorDrafts)) return state;
        const editorDrafts = { ...state.editorDrafts };
        delete editorDrafts[key];
        return { editorDrafts };
    }),
    requestEditorAction: (selection, action) => set((state) => ({
        selection,
        pendingEditorAction: {
            id: state.nextEditorActionId,
            key: selectionKey(selection),
            action,
        },
        nextEditorActionId: state.nextEditorActionId + 1,
    })),
    consumeEditorAction: (id) => set((state) => ({
        pendingEditorAction: state.pendingEditorAction?.id === id ? undefined : state.pendingEditorAction,
    })),
}));
