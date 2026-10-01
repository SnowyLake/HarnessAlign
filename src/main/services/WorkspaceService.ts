/**
 * Privileged workspace operations that wrap the engine after path validation.
 * The config root is always `%USERPROFILE%`; renderer input never chooses a directory.
 */

import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import {
    addHarness,
    addLayer,
    addLayerOption,
    addSkillSource,
    deleteSource,
    ensureUserWorkspace,
    loadWorkspace,
    removeHarness,
    removeLayer,
    removeLayerOption,
    removeSkillSource,
    renameLayer,
    renameLayerOption,
    renameSource,
    saveAgent,
    saveConfig,
    saveLayerOption,
    saveRule,
    saveSharedRule,
    saveSkillContent,
    updateHarness,
} from "../../engine/Edit.js";
import { assertContained, ensureRegularSource, lstatIfExists } from "../../engine/FsSafe.js";
import { generate, inspectGenerated, readGeneratedFiles, reportGenerate, safeOutputRelative } from "../../engine/Generate.js";
import { HalignError, valueText } from "../../engine/Model.js";
import { previewSetup, reportSetup, setup } from "../../engine/Setup.js";
import type { AppApi } from "../../shared/contracts/AppApi.js";
import { assertSkillName, importUserSkills, listImportableUserSkills, loadSkills, readSkillContent, removeSkill } from "../../engine/Skills.js";
import type { LayerSelection, WorkspaceItemTarget } from "../../shared/models/Workspace.js";
import * as skillRemote from "./SkillRemoteService.js";

/** Tail of the single-user workspace queue, including reads that must see complete writes. */
let workspaceQueue: Promise<unknown> = Promise.resolve();
let hasUnsavedDrafts = true;
let isUpdateExclusive = false;

/** Only the latest Main-owned deployment preview may be applied. */
let setupReview: { id: string; root: string; revision: string; selection: LayerSelection[] | undefined } | undefined;

/** Track the trusted renderer's draft state without accepting workspace paths or update URLs. */
export function setUpdateDraftState(hasUnsaved: boolean): void
{
    hasUnsavedDrafts = hasUnsaved;
}

/** Refuse installation if the renderer has reported any new draft during the download. */
export function assertUpdateDraftsSaved(): void
{
    if (hasUnsavedDrafts) throw new HalignError("application update: save all workspace changes before downloading or installing");
}

/** Drain existing work and reserve the workspace until the updater fails or starts installation. */
export async function withWorkspaceForUpdate<T>(work: () => Promise<T>, isInstalling: () => boolean = () => false): Promise<T>
{
    if (isUpdateExclusive) throw new HalignError("application update: another download is already running");
    assertUpdateDraftsSaved();
    isUpdateExclusive = true;
    try
    {
        await workspaceQueue;
        assertUpdateDraftsSaved();
        return await work();
    }
    finally
    {
        if (!isInstalling()) isUpdateExclusive = false;
    }
}

/** Serialize workspace operations and release the queue even when an operation fails. */
export function withWorkspace<T>(work: (root: string) => Promise<T>): Promise<T>
{
    if (isUpdateExclusive) return Promise.reject(new HalignError("workspace: application update is downloading or installing; retry after it finishes"));
    // ponytail: one workspace queue; split remote downloads only if UI latency becomes a measured problem.
    const operation = workspaceQueue.then(async () => work(await ensureUserWorkspace()));
    workspaceQueue = operation.catch(() => undefined);
    return operation;
}

/** Resolve an existing source, generated file, or installed SKILL.md to its safe containing folder. */
export async function resolveWorkspaceItemFolder(rootPath: string, target: WorkspaceItemTarget): Promise<string>
{
    const root = resolve(rootPath);
    let relativePath: string;
    if (target.kind === "generated") relativePath = `.harness-align/generated/${safeOutputRelative(target.path)}`;
    else if (target.kind === "skill")
    {
        const id = assertSkillName(target.id, `.harness-align/skills/${target.id}`);
        if (!(await loadSkills(root)).some((skill) => skill.id === id)) throw new HalignError(`.harness-align/skills/${id}: skill does not exist`);
        relativePath = `.harness-align/skills/${id}/SKILL.md`;
    }
    else
    {
        const workspace = await loadWorkspace(root);
        const sources = [...workspace.rootRules, ...workspace.sharedRules, ...workspace.agents, ...Object.values(workspace.layerOptions).flat()];
        if (!sources.some((source) => source.path === target.path)) throw new HalignError(`Open in explorer: source file does not exist in the workspace, got ${valueText(target.path)}`);
        relativePath = target.path;
    }
    const path = resolve(root, ...relativePath.split("/"));
    assertContained(join(root, ".harness-align"), path, "Open in explorer");
    await ensureRegularSource(root, path);
    const stats = await lstatIfExists(path);
    if (!stats) throw new HalignError(`Open in explorer: file does not exist: ${path}`);
    if (!stats.isFile()) throw new HalignError(`Open in explorer: expected a file: ${path}`);
    return dirname(path);
}

/** Privileged workspace operations that wrap the engine. Folder opening stays in the IPC handler so this module stays Electron-free. */
export const workspaceService: Omit<AppApi["workspace"], "openHarnessRoot" | "openItemFolder"> = {
    /** Load and validate the user `.harness-align` workspace. */
    load: () => withWorkspace(async (root) =>
    {
        const [workspace, generatedFiles] = await Promise.all([loadWorkspace(root), readGeneratedFiles(root)]);
        return {
            ...workspace,
            generationStatus: await inspectGenerated(root, generatedFiles),
            generatedFiles: [...generatedFiles].map(([path, content]) => ({ path, content: content.toString("utf8") })),
        };
    }),

    /** Validate and write `config.json`. */
    saveConfig: (config, guard) => withWorkspace((root) => saveConfig(root, config, guard)),

    /** Validate and write a root rule. */
    saveRule: (input, guard) => withWorkspace((root) => saveRule(root, input, guard)),

    /** Validate and write a layer option. */
    saveLayerOption: (input, guard) => withWorkspace((root) => saveLayerOption(root, input, guard)),

    /** Validate and write a shared-rule markdown file. */
    saveSharedRule: (path, body, guard) => withWorkspace((root) => saveSharedRule(root, path, body, guard)),

    /** Validate and write a subagent source file. */
    saveAgent: (agent, guard) => withWorkspace((root) => saveAgent(root, agent, guard)),

    /** Delete a `.harness-align` source file after containment checks. */
    deleteSource: (path) => withWorkspace((root) => deleteSource(root, path)),

    /** Atomically rename a rule or agent source within its source kind. */
    renameSource: (from, to) => withWorkspace((root) => renameSource(root, from, to)),

    /** Create an empty catalog layer directory. */
    addLayer: (name) => withWorkspace((root) => addLayer(root, name)),

    /** Remove a layer directory and drop it from the project selection when present. */
    removeLayer: (name) => withWorkspace((root) => removeLayer(root, name)),

    /** Rename a layer directory and cascade its project selection when present. */
    renameLayer: (from, to) => withWorkspace((root) => renameLayer(root, from, to)),

    /** Create an empty option under an existing layer. */
    addLayerOption: (layer, option) => withWorkspace((root) => addLayerOption(root, layer, option)),

    /** Remove a non-selected option from a layer. */
    removeLayerOption: (layer, option) => withWorkspace((root) => removeLayerOption(root, layer, option)),

    /** Rename an option and cascade a saved selection. */
    renameLayerOption: (layer, from, to) => withWorkspace((root) => renameLayerOption(root, layer, from, to)),

    /** Add a harness declaration to config. */
    addHarness: (harness) => withWorkspace((root) => addHarness(root, harness)),

    /** Remove a harness declaration and its generated references. */
    removeHarness: (name) => withWorkspace((root) => removeHarness(root, name)),

    /** Update a harness and cascade its name when necessary. */
    updateHarness: (from, harness) => withWorkspace((root) => updateHarness(root, from, harness)),

    /** Register a GitHub skill source URL. */
    addSkillSource: (input) => withWorkspace((root) => addSkillSource(root, input)),

    /** Remove a registered GitHub skill source. */
    removeSkillSource: (owner, name) => withWorkspace((root) => removeSkillSource(root, owner, name)),

    /** Discover remote skills from configured GitHub sources. */
    discoverSkills: () => withWorkspace((root) => skillRemote.discoverSkills(root)),

    /** Read one remote SKILL.md from the current discovery cache. */
    readDiscoveredSkillContent: (previewId) => withWorkspace((root) => skillRemote.readDiscoveredSkillContent(root, previewId)),

    /** Install the exact skill selected from the current discovery cache. */
    installDiscoveredSkill: (previewId) => withWorkspace((root) => skillRemote.installDiscoveredSkill(root, previewId)),

    /** Install selected discovered skills into the project. */
    installSkills: (ids) => withWorkspace((root) => skillRemote.installSkills(root, ids)),

    /** Compare installed GitHub skills with remote content hashes. */
    checkSkillUpdates: () => withWorkspace((root) => skillRemote.checkSkillUpdates(root)),

    /** Apply remote updates for selected installed skills. */
    applySkillUpdates: (previewIds) => withWorkspace((root) => skillRemote.applySkillUpdates(root, previewIds)),

    /** Read one installed skill's main Markdown file. */
    readSkillContent: (id) => withWorkspace((root) => readSkillContent(root, id)),

    /** Save one local skill's main Markdown file. */
    saveSkillContent: (id, content, expectedContent) => withWorkspace((root) => saveSkillContent(root, id, content, expectedContent)),

    /** List skills under the current user profile. */
    listUserSkills: () => withWorkspace((root) => listImportableUserSkills(root)),

    /** Import selected user-profile skills into the project. */
    importUserSkills: (ids, overwrite) => withWorkspace((root) => importUserSkills(root, ids, overwrite)),

    /** Remove one installed project skill. */
    removeSkill: (id) => withWorkspace((root) => removeSkill(root, id)),

    /** Generate outputs and return the report string. */
    generate: (selection) => withWorkspace(async (root) => reportGenerate(await generate(root, selection))),

    /** Review source and target contents without generating or deploying. */
    previewSetup: (selection) => withWorkspace(async (root) =>
    {
        const preview = await previewSetup(root, selection);
        setupReview = { id: randomUUID(), root, revision: preview.revision, selection };
        return { id: setupReview.id, changes: preview.changes };
    }),

    /** Apply only the latest reviewed plan after checking its content revision. */
    setup: (previewId, overwriteExternal) => withWorkspace(async (root) =>
    {
        const review = setupReview;
        if (!review || review.id !== previewId || review.root !== root) throw new HalignError("Setup preview is missing or expired; preview again before deploying");
        setupReview = undefined;
        return reportSetup(await setup(root, review.selection, undefined, review.revision, overwriteExternal));
    }),
};
