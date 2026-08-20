/**
 * Shared workspace runners used by the shell and editor forms.
 * Command errors go to Output; mutation errors return for form Alerts.
 */

import type { Workspace } from "@shared/models/Workspace";
import { toast } from "@/components/ui/toast";
import { selectionKey, useAppStore, type Selection } from "@/stores/AppStore";

/** Reload the open workspace after a source or generate change. */
export async function refreshWorkspace(next?: Selection): Promise<void>
{
    const current = useAppStore.getState().workspace;
    if (!current) return;
    const workspace = await window.appApi.workspace.load(current.root);
    useAppStore.getState().setWorkspace(workspace);
    if (next) useAppStore.getState().setSelection(next);
}

/** Run Open / Generate / Check / Setup work while holding busy; errors open the output notification flow. */
export async function runCommand(work: () => Promise<void>): Promise<void>
{
    const { beginBusy, endBusy, setOutput } = useAppStore.getState();
    beginBusy();
    try
    {
        await work();
    }
    catch (error)
    {
        const message = error instanceof Error ? error.message : String(error);
        setOutput(message, "error", "Command failed");
    }
    finally
    {
        endBusy();
    }
}

/** Run a form save/delete while holding busy; failures toast briefly and return the full message. */
export async function runMutation(work: () => Promise<void>): Promise<{ ok: true } | { ok: false; message: string }>
{
    const { beginBusy, endBusy } = useAppStore.getState();
    beginBusy();
    try
    {
        await work();
        return { ok: true };
    }
    catch (error)
    {
        const message = error instanceof Error ? error.message : String(error);
        toast.add({ title: "Action failed", type: "error" });
        return { ok: false, message };
    }
    finally
    {
        endBusy();
    }
}

/** Persist a Layer rename and rewrite matching editor drafts and Project selection. */
export async function persistLayerRename(workspace: Workspace, from: string, to: string): Promise<void>
{
    await window.appApi.workspace.renameLayer(workspace.root, from, to);
    const state = useAppStore.getState();
    const previousOptionPrefix = `layer-option:.halign/layers/${from}/`;
    const nextOptionPrefix = `layer-option:.halign/layers/${to}/`;
    for (const [key, draft] of Object.entries(state.editorDrafts))
    {
        if (!key.startsWith(previousOptionPrefix)) continue;
        state.setEditorDraft(nextOptionPrefix + key.slice(previousOptionPrefix.length), draft);
        state.clearEditorDraft(key);
    }
    const previousNewOptionKey = selectionKey({ kind: "layer-option-new", layer: from });
    const nextNewOptionKey = selectionKey({ kind: "layer-option-new", layer: to });
    const newOptionDraft = state.editorDrafts[previousNewOptionKey];
    if (newOptionDraft) state.setEditorDraft(nextNewOptionKey, newOptionDraft);
    state.clearEditorDraft(previousNewOptionKey);
    const previousLayerKey = selectionKey({ kind: "layer", name: from });
    const nextLayerKey = selectionKey({ kind: "layer", name: to });
    const layerDraft = state.editorDrafts[previousLayerKey];
    if (layerDraft) state.setEditorDraft(nextLayerKey, layerDraft);
    state.clearEditorDraft(previousLayerKey);
    if (state.selection.kind === "layer-option" && state.selection.path.startsWith(`.halign/layers/${from}/`))
    {
        state.setSelection({ kind: "layer-option", path: `.halign/layers/${to}/${state.selection.path.slice(`.halign/layers/${from}/`.length)}` });
    }
    else if (state.selection.kind === "layer-option-new" && state.selection.layer === from)
    {
        state.setSelection({ kind: "layer-option-new", layer: to });
    }
    else if (state.selection.kind === "layer" && state.selection.name === from)
    {
        state.setSelection({ kind: "layer", name: to });
    }
    state.setLayerSelection(state.layerSelection.map((item) => item.name === from ? { ...item, name: to } : item));
    await refreshWorkspace({ kind: "layer", name: to });
}

/** Persist a Layer option rename and rewrite matching editor drafts and Project selection. */
export async function persistLayerOptionRename(workspace: Workspace, layer: string, from: string, to: string): Promise<string>
{
    await window.appApi.workspace.renameLayerOption(workspace.root, layer, from, to);
    const nextPath = `.halign/layers/${layer}/${to}.md`;
    const state = useAppStore.getState();
    state.setLayerSelection(state.layerSelection.map((selection) => selection.name === layer && selection.option === from
        ? { ...selection, option: to }
        : selection));
    const previousKey = selectionKey({ kind: "layer-option", path: `.halign/layers/${layer}/${from}.md` });
    const nextKey = selectionKey({ kind: "layer-option", path: nextPath });
    const draft = state.editorDrafts[previousKey];
    if (draft) state.setEditorDraft(nextKey, draft);
    state.clearEditorDraft(previousKey);
    return nextPath;
}
