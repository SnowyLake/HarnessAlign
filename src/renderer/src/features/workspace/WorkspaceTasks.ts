/**
 * Shared workspace runners used by the shell and editor forms.
 * Command errors go to Output; mutation errors return for form Alerts.
 */

import { showError, showSuccess } from "@/components/common/Feedback";
import { fileName, ruleDisplayName, uniqueAgentPath, uniqueRulePath } from "@/lib/Utils";
import { selectionKey, useAppStore, type FormSnapshot, type Selection } from "@/stores/AppStore";
import type { AgentFormat, Config, HarnessConfig, RuleInput, Workspace } from "@shared/models/Workspace";

/** Result of persisting one editor snapshot through the existing workspace API. */
export interface EditorSaveResult
{
    selection: Selection;
    message: string;
}

/** Convert unknown failures to the message shown by renderer notifications. */
function errorMessage(error: unknown): string
{
    return error instanceof Error ? error.message : String(error);
}

/** Read one text field from a form snapshot with a persisted fallback. */
function snapshotText(snapshot: FormSnapshot, name: string, fallback = ""): string
{
    return snapshot[name]?.[0] ?? fallback;
}

/** Return the selected harness target allowlist. */
function snapshotTargets(snapshot: FormSnapshot): string[]
{
    return snapshot.targets ?? [];
}

/** Return the deterministic save phase for one editor selection. */
function editorSavePriority(selection: Selection): number
{
    switch (selection.kind)
    {
        case "config":
            return 0;
        case "rule":
        case "rule-new":
            return 10;
        case "layer-option":
        case "layer-option-new":
            return 20;
        case "agent":
        case "agent-new":
            return 30;
        case "layer-new":
            return 40;
        case "layer":
            return 50;
        case "harness":
        case "harness-new":
            return 60;
        case "generated":
        case "generated-file":
            return 100;
    }
}

/** Keep the active editor on the resource produced by a save. */
function savedSelection(current: Selection, before: Selection, after: Selection): Selection
{
    if (before.kind === "layer" && after.kind === "layer" && before.name !== after.name)
    {
        const previousPrefix = `.harness-align/layers/${before.name}/`;
        if (current.kind === "layer-option" && current.path.startsWith(previousPrefix))
        {
            return { kind: "layer-option", path: `.harness-align/layers/${after.name}/${current.path.slice(previousPrefix.length)}` };
        }
        if (current.kind === "layer-option-new" && current.layer === before.name)
        {
            return { kind: "layer-option-new", layer: after.name };
        }
        if (current.kind === "layer" && current.name === before.name) return after;
    }
    return selectionKey(current) === selectionKey(before) ? after : current;
}

/** Move an existing source, save it at the new path, and move it back when saving fails. */
export async function saveRenamedSource(from: string, to: string, save: (path: string) => Promise<void>): Promise<void>
{
    if (from === to)
    {
        await save(to);
        return;
    }
    await window.appApi.workspace.renameSource(from, to);
    try
    {
        await save(to);
    }
    catch (error)
    {
        try
        {
            await window.appApi.workspace.renameSource(to, from);
        }
        catch (rollbackError)
        {
            throw new Error(`${errorMessage(error)}; rename rollback failed: ${errorMessage(rollbackError)}`);
        }
        throw error;
    }
}

/** Persist one mounted or retained editor snapshot without refreshing the renderer workspace. */
export async function persistEditorSnapshot(workspace: Workspace, selection: Selection, snapshot: FormSnapshot): Promise<EditorSaveResult>
{
    switch (selection.kind)
    {
        case "config":
        {
            const next: Config = {
                ...workspace.config,
                name: snapshotText(snapshot, "name", workspace.config.name).trim(),
                layers: useAppStore.getState().layerSelection.map((item) => ({ name: item.name, selected: item.option })),
            };
            await window.appApi.workspace.saveConfig(next);
            return { selection, message: "Saved config.json" };
        }
        case "harness":
        case "harness-new":
        {
            const existing = selection.kind === "harness"
                ? workspace.config.harnesses.find((item) => item.name === selection.name)
                : undefined;
            if (selection.kind === "harness" && !existing) throw new Error(`Harness ${selection.name} no longer exists`);
            const agentFileFormat = snapshotText(snapshot, "agentFileFormat", existing?.agentFormat === "toml" ? "toml" : "md") === "toml" ? "toml" : "md";
            const agentFormat: AgentFormat = agentFileFormat === "toml" ? "toml" : "yaml";
            const harness: HarnessConfig = agentFormat === "toml"
                ? {
                    name: snapshotText(snapshot, "name", existing?.name).trim(),
                    configPath: snapshotText(snapshot, "configPath", existing?.configPath).trim(),
                    agentFormat,
                    agentExtension: agentFileFormat,
                    instructionsField: snapshotText(snapshot, "instructionsField", existing?.instructionsField).trim(),
                }
                : {
                    name: snapshotText(snapshot, "name", existing?.name).trim(),
                    configPath: snapshotText(snapshot, "configPath", existing?.configPath).trim(),
                    agentFormat,
                    agentExtension: agentFileFormat,
                };
            if (!existing) await window.appApi.workspace.addHarness(harness);
            else
            {
                await window.appApi.workspace.updateHarness(existing.name, harness);
            }
            return {
                selection: { kind: "harness", name: harness.name },
                message: existing ? `Saved harness ${harness.name}` : `Created harness ${harness.name}`,
            };
        }
        case "layer-new":
        {
            const name = snapshotText(snapshot, "name").trim();
            await window.appApi.workspace.addLayer(name);
            return {
                selection: { kind: "layer", name },
                message: `Created layer ${name}`,
            };
        }
        case "layer":
        {
            if (!Object.hasOwn(workspace.layerOptions, selection.name)) throw new Error(`Layer ${selection.name} no longer exists`);
            const nextName = snapshotText(snapshot, "name", selection.name).trim();
            if (!nextName) throw new Error("Layer name must not be empty");
            if (nextName !== selection.name) await persistLayerRename(selection.name, nextName);
            return { selection: { kind: "layer", name: nextName }, message: `Saved layer ${nextName}` };
        }
        case "rule":
        case "rule-new":
        {
            const sharedExisting = selection.kind === "rule" ? workspace.sharedRules.find((rule) => rule.path === selection.path) : undefined;
            const existing = selection.kind === "rule" ? workspace.rootRules.find((rule) => rule.path === selection.path) : undefined;
            if (selection.kind === "rule" && !sharedExisting && !existing) throw new Error(`Rule ${selection.path} no longer exists`);
            const isShared = selection.kind === "rule-new" ? selection.scope === "shared" : Boolean(sharedExisting);
            const defaultPath = selection.kind === "rule"
                ? selection.path
                : isShared
                    ? ".harness-align/rules/shared/new-rule.md"
                    : ".harness-align/rules/new-rule.md";
            const original = sharedExisting?.path ?? existing?.path;
            const path = uniqueRulePath(
                original ?? defaultPath,
                snapshotText(snapshot, "name", ruleDisplayName(original ?? defaultPath)),
                [...workspace.rootRules, ...workspace.sharedRules].map((item) => item.path),
            );
            const body = snapshotText(snapshot, "body");
            const save = async (savePath: string): Promise<void> =>
            {
                if (isShared)
                {
                    await window.appApi.workspace.saveSharedRule(savePath, body);
                    return;
                }
                const targets = snapshotTargets(snapshot);
                const payload: RuleInput = { path: savePath, priority: existing?.priority ?? workspace.rootRules.length, targets, body };
                await window.appApi.workspace.saveRule(payload);
            };
            if (original) await saveRenamedSource(original, path, save);
            else await save(path);
            return {
                selection: { kind: "rule", path },
                message: selection.kind === "rule-new" ? `Created ${fileName(path)}` : `Saved ${fileName(path)}`,
            };
        }
        case "layer-option":
        case "layer-option-new":
        {
            const existing = selection.kind === "layer-option"
                ? Object.values(workspace.layerOptions).flat().find((option) => option.path === selection.path)
                : undefined;
            if (selection.kind === "layer-option" && !existing) throw new Error(`Layer option ${selection.path} no longer exists`);
            const layer = selection.kind === "layer-option-new" ? selection.layer : existing?.layer;
            if (!layer) throw new Error("Layer no longer exists for this option");
            const nextName = ruleDisplayName(snapshotText(snapshot, "name", existing?.name ?? "new-option").trim() || "new-option");
            const targets = snapshotTargets(snapshot);
            const body = snapshotText(snapshot, "body");
            let path: string;
            if (existing)
            {
                if (existing.name === nextName)
                {
                    path = existing.path;
                    await window.appApi.workspace.saveLayerOption({ path, targets, body });
                }
                else
                {
                    path = await persistLayerOptionRename(existing.layer, existing.name, nextName);
                    try
                    {
                        await window.appApi.workspace.saveLayerOption({ path, targets, body });
                    }
                    catch (error)
                    {
                        try
                        {
                            await persistLayerOptionRename(existing.layer, nextName, existing.name);
                        }
                        catch (rollbackError)
                        {
                            throw new Error(`${errorMessage(error)}; option rename rollback failed: ${errorMessage(rollbackError)}`);
                        }
                        throw error;
                    }
                }
            }
            else
            {
                await window.appApi.workspace.addLayerOption(layer, nextName);
                path = `.harness-align/layers/${layer}/${nextName}.md`;
                await window.appApi.workspace.saveLayerOption({ path, targets, body });
            }
            return {
                selection: { kind: "layer-option", path },
                message: existing ? `Saved ${fileName(path)}` : `Created option ${nextName}`,
            };
        }
        case "agent":
        case "agent-new":
        {
            const existing = selection.kind === "agent" ? workspace.agents.find((agent) => agent.path === selection.path) : undefined;
            if (selection.kind === "agent" && !existing) throw new Error(`Agent ${selection.path} no longer exists`);
            const harnesses: Record<string, Record<string, unknown>> = {};
            for (const harness of workspace.config.harnesses)
            {
                const metadata = snapshotText(snapshot, `meta-${harness.name}`, JSON.stringify(existing?.harnesses[harness.name] ?? {}));
                harnesses[harness.name] = JSON.parse(metadata) as Record<string, unknown>;
            }
            const path = uniqueAgentPath(existing?.path, snapshotText(snapshot, "name", existing?.name), workspace.agents.map((agent) => agent.path));
            const agent = {
                name: ruleDisplayName(path),
                description: snapshotText(snapshot, "description", existing?.description).trim(),
                harnesses,
                body: snapshotText(snapshot, "body", existing?.body),
            };
            const save = (savePath: string): Promise<void> => window.appApi.workspace.saveAgent({ ...agent, path: savePath });
            if (existing) await saveRenamedSource(existing.path, path, save);
            else await save(path);
            return {
                selection: { kind: "agent", path },
                message: selection.kind === "agent-new" ? `Created ${fileName(path)}` : `Saved ${fileName(path)}`,
            };
        }
        case "generated":
        case "generated-file":
            throw new Error(`${selectionKey(selection)} is read-only`);
    }
}

/** Save every retained editor draft and ordered Layer change through the existing APIs. */
export async function saveWorkspaceChanges(): Promise<void>
{
    const initial = useAppStore.getState();
    if (!initial.workspace || initial.isBusy) return;

    const draftEntries = Object.entries(initial.editorDrafts).map(([key, draft]) => ({ key, draft }));
    const configDraft = draftEntries.find(({ draft }) => draft.selection.kind === "config")?.draft;
    const savedLayers = initial.workspace.config.layers;
    const hasLocalLayerChanges = savedLayers.length !== initial.layerSelection.length
        || savedLayers.some((item, index) => item.name !== initial.layerSelection[index]?.name || item.selected !== initial.layerSelection[index]?.option);
    const pending = draftEntries
        .filter(({ draft }) => draft.selection.kind !== "config")
        .sort((left, right) => editorSavePriority(left.draft.selection) - editorSavePriority(right.draft.selection) || left.key.localeCompare(right.key));

    const { setIsBusy } = initial;
    let currentWorkspace = initial.workspace;
    let nextSelection = initial.selection;
    setIsBusy(true);
    try
    {
        currentWorkspace = await window.appApi.workspace.load();
        if (!hasLocalLayerChanges)
        {
            useAppStore.getState().setLayerSelection(currentWorkspace.config.layers.map((item) => ({ name: item.name, option: item.selected })));
        }
        await persistEditorSnapshot(
            currentWorkspace,
            { kind: "config" },
            configDraft?.current ?? { name: [currentWorkspace.config.name] },
        );
        useAppStore.getState().clearEditorDraft(selectionKey({ kind: "config" }));
        currentWorkspace = await window.appApi.workspace.load();

        for (const entry of pending)
        {
            const result = await persistEditorSnapshot(currentWorkspace, entry.draft.selection, entry.draft.current);
            const state = useAppStore.getState();
            state.clearEditorDraft(entry.key);
            state.clearEditorDraft(selectionKey(result.selection));
            nextSelection = savedSelection(nextSelection, entry.draft.selection, result.selection);
            currentWorkspace = await window.appApi.workspace.load();
        }

        const state = useAppStore.getState();
        state.setWorkspace(currentWorkspace);
        state.setSelection(nextSelection);
        showSuccess("Saved all changes");
    }
    catch (error)
    {
        const message = errorMessage(error);
        let refreshMessage = "";
        try
        {
            currentWorkspace = await window.appApi.workspace.load();
            const state = useAppStore.getState();
            state.setWorkspace(currentWorkspace);
            state.setSelection(nextSelection);
        }
        catch (refreshError)
        {
            refreshMessage = ` Workspace refresh also failed: ${errorMessage(refreshError)}`;
        }
        showError(`Save failed: ${message}${refreshMessage}`);
    }
    finally
    {
        setIsBusy(false);
    }
}

/** Reload the open workspace after a source or generate change. */
export async function refreshWorkspace(next?: Selection): Promise<void>
{
    const current = useAppStore.getState().workspace;
    if (!current) return;
    const workspace = await window.appApi.workspace.load();
    useAppStore.getState().setWorkspace(workspace);
    if (next) useAppStore.getState().setSelection(next);
}

/** Run Generate / Setup work while holding busy; errors open the output notification flow. */
export async function runCommand(work: () => Promise<void>): Promise<void>
{
    const { setIsBusy, setOutput } = useAppStore.getState();
    setIsBusy(true);
    try
    {
        await work();
    }
    catch (error)
    {
        setOutput(errorMessage(error), "error", "Command failed");
    }
    finally
    {
        setIsBusy(false);
    }
}

/** Run a form save/delete while holding busy; failures toast briefly and return the full message. */
export async function runMutation(work: () => Promise<void>): Promise<{ ok: true } | { ok: false; message: string }>
{
    const { setIsBusy } = useAppStore.getState();
    setIsBusy(true);
    try
    {
        await work();
        return { ok: true };
    }
    catch (error)
    {
        const message = errorMessage(error);
        showError(message);
        return { ok: false, message };
    }
    finally
    {
        setIsBusy(false);
    }
}

/** Persist a Layer rename and rewrite matching editor drafts and Home selection. */
export async function persistLayerRename(from: string, to: string): Promise<void>
{
    await window.appApi.workspace.renameLayer(from, to);
    const state = useAppStore.getState();
    const previousOptionPrefix = `layer-option:.harness-align/layers/${from}/`;
    const nextOptionPrefix = `layer-option:.harness-align/layers/${to}/`;
    for (const [key, draft] of Object.entries(state.editorDrafts))
    {
        if (!key.startsWith(previousOptionPrefix)) continue;
        const nextPath = `.harness-align/layers/${to}/${key.slice(previousOptionPrefix.length)}`;
        state.setEditorDraft(nextOptionPrefix + key.slice(previousOptionPrefix.length), {
            ...draft,
            selection: { kind: "layer-option", path: nextPath },
        });
        state.clearEditorDraft(key);
    }
    const previousNewOptionKey = selectionKey({ kind: "layer-option-new", layer: from });
    const nextNewOptionKey = selectionKey({ kind: "layer-option-new", layer: to });
    const newOptionDraft = state.editorDrafts[previousNewOptionKey];
    if (newOptionDraft) state.setEditorDraft(nextNewOptionKey, {
        ...newOptionDraft,
        selection: { kind: "layer-option-new", layer: to },
    });
    state.clearEditorDraft(previousNewOptionKey);
    const previousLayerKey = selectionKey({ kind: "layer", name: from });
    const nextLayerKey = selectionKey({ kind: "layer", name: to });
    const layerDraft = state.editorDrafts[previousLayerKey];
    if (layerDraft) state.setEditorDraft(nextLayerKey, {
        ...layerDraft,
        selection: { kind: "layer", name: to },
    });
    state.clearEditorDraft(previousLayerKey);
    if (state.selection.kind === "layer-option" && state.selection.path.startsWith(`.harness-align/layers/${from}/`))
    {
        state.setSelection({ kind: "layer-option", path: `.harness-align/layers/${to}/${state.selection.path.slice(`.harness-align/layers/${from}/`.length)}` });
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
}

/** Persist a Layer option rename and rewrite matching editor drafts and Home selection. */
export async function persistLayerOptionRename(layer: string, from: string, to: string): Promise<string>
{
    await window.appApi.workspace.renameLayerOption(layer, from, to);
    const nextPath = `.harness-align/layers/${layer}/${to}.md`;
    const state = useAppStore.getState();
    state.setLayerSelection(state.layerSelection.map((selection) => selection.name === layer && selection.option === from
        ? { ...selection, option: to }
        : selection));
    const previousKey = selectionKey({ kind: "layer-option", path: `.harness-align/layers/${layer}/${from}.md` });
    const nextKey = selectionKey({ kind: "layer-option", path: nextPath });
    const draft = state.editorDrafts[previousKey];
    if (draft) state.setEditorDraft(nextKey, {
        ...draft,
        selection: { kind: "layer-option", path: nextPath },
    });
    state.clearEditorDraft(previousKey);
    return nextPath;
}
