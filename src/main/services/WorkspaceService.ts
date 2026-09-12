/**
 * Privileged workspace operations that wrap the engine after path validation.
 * The config root is always `%USERPROFILE%`; renderer input never chooses a directory.
 */

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
    updateHarness,
} from "../../engine/Edit.js";
import { generate, readGeneratedFiles, reportGenerate } from "../../engine/Generate.js";
import { reportSetup, setup } from "../../engine/Setup.js";
import type { AppApi } from "../../shared/contracts/AppApi.js";
import { importUserSkills, listUserSkills, removeSkill } from "../../engine/Skills.js";
import * as skillRemote from "./SkillRemoteService.js";

/** Tail of the single-user workspace queue, including reads that must see complete writes. */
let workspaceQueue: Promise<unknown> = Promise.resolve();

/** Serialize workspace operations and release the queue even when an operation fails. */
export function withWorkspace<T>(work: (root: string) => Promise<T>): Promise<T>
{
    // ponytail: one workspace queue; split remote downloads only if UI latency becomes a measured problem.
    const operation = workspaceQueue.then(async () => work(await ensureUserWorkspace()));
    workspaceQueue = operation.catch(() => undefined);
    return operation;
}

/** Privileged workspace operations that wrap the engine. */
export const workspaceService: AppApi["workspace"] = {
    /** Load and validate the user `.harness-align` workspace. */
    load: () => withWorkspace(async (root) =>
    {
        const [workspace, generatedFiles] = await Promise.all([loadWorkspace(root), readGeneratedFiles(root)]);
        return {
            ...workspace,
            generatedFiles: [...generatedFiles].map(([path, content]) => ({ path, content: content.toString("utf8") })),
        };
    }),

    /** Validate and write `config.json`. */
    saveConfig: (config) => withWorkspace((root) => saveConfig(root, config)),

    /** Validate and write a root rule. */
    saveRule: (input) => withWorkspace((root) => saveRule(root, input)),

    /** Validate and write a layer option. */
    saveLayerOption: (input) => withWorkspace((root) => saveLayerOption(root, input)),

    /** Validate and write a shared-rule markdown file. */
    saveSharedRule: (path, body) => withWorkspace((root) => saveSharedRule(root, path, body)),

    /** Validate and write a subagent source file. */
    saveAgent: (agent) => withWorkspace((root) => saveAgent(root, agent)),

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

    /** Install selected discovered skills into the project. */
    installSkills: (ids) => withWorkspace((root) => skillRemote.installSkills(root, ids)),

    /** Compare installed GitHub skills with remote content hashes. */
    checkSkillUpdates: () => withWorkspace((root) => skillRemote.checkSkillUpdates(root)),

    /** Apply remote updates for selected installed skills. */
    applySkillUpdates: (ids) => withWorkspace((root) => skillRemote.applySkillUpdates(root, ids)),

    /** List skills under the current user profile. */
    listUserSkills: () => withWorkspace(() => listUserSkills()),

    /** Import selected user-profile skills into the project. */
    importUserSkills: (ids, overwrite) => withWorkspace((root) => importUserSkills(root, ids, overwrite)),

    /** Remove one installed project skill. */
    removeSkill: (id) => withWorkspace((root) => removeSkill(root, id)),

    /** Generate outputs and return the report string. */
    generate: (selection) => withWorkspace(async (root) => reportGenerate(await generate(root, selection))),

    /** Generate then deploy into existing user harness roots. */
    setup: (selection) => withWorkspace(async (root) => reportSetup(await setup(root, selection))),
};
