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
    importUserSkills,
    listUserSkills,
    loadWorkspace,
    removeHarness,
    removeLayer,
    removeLayerOption,
    removeSkill,
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
import type {
    Agent,
    Config,
    HarnessConfig,
    LayerOptionInput,
    LayerSelection,
    RemoteSkill,
    RuleInput,
    SkillUpdate,
    UserSkill,
    Workspace,
} from "../../shared/models/Workspace.js";
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
export class WorkspaceService
{
    /** Load and validate the user `.harness-align` workspace. */
    async load(): Promise<Workspace>
    {
        return withWorkspace(async (root) =>
        {
            const [workspace, generatedFiles] = await Promise.all([loadWorkspace(root), readGeneratedFiles(root)]);
            return {
                ...workspace,
                generatedFiles: [...generatedFiles].map(([path, content]) => ({ path, content: content.toString("utf8") })),
            };
        });
    }

    /** Validate and write `config.json`. */
    async saveConfig(config: Config): Promise<Config>
    {
        return withWorkspace((root) => saveConfig(root, config));
    }

    /** Validate and write a root rule. */
    async saveRule(input: RuleInput): Promise<void>
    {
        return withWorkspace((root) => saveRule(root, input));
    }

    /** Validate and write a layer option. */
    async saveLayerOption(input: LayerOptionInput): Promise<void>
    {
        return withWorkspace((root) => saveLayerOption(root, input));
    }

    /** Validate and write a shared-rule markdown file. */
    async saveSharedRule(path: string, body: string): Promise<void>
    {
        return withWorkspace((root) => saveSharedRule(root, path, body));
    }

    /** Validate and write a subagent source file. */
    async saveAgent(agent: Agent): Promise<void>
    {
        return withWorkspace((root) => saveAgent(root, agent));
    }

    /** Delete a `.harness-align` source file after containment checks. */
    async deleteSource(path: string): Promise<void>
    {
        return withWorkspace((root) => deleteSource(root, path));
    }

    /** Atomically rename a rule or agent source within its source kind. */
    async renameSource(from: string, to: string): Promise<void>
    {
        return withWorkspace((root) => renameSource(root, from, to));
    }

    /** Create an empty catalog layer directory. */
    async addLayer(name: string): Promise<Config>
    {
        return withWorkspace((root) => addLayer(root, name));
    }

    /** Remove a layer directory and drop it from the project selection when present. */
    async removeLayer(name: string): Promise<Config>
    {
        return withWorkspace((root) => removeLayer(root, name));
    }

    /** Rename a layer directory and cascade its project selection when present. */
    async renameLayer(from: string, to: string): Promise<Config>
    {
        return withWorkspace((root) => renameLayer(root, from, to));
    }

    /** Create an empty option under an existing layer. */
    async addLayerOption(layer: string, option: string): Promise<void>
    {
        return withWorkspace((root) => addLayerOption(root, layer, option));
    }

    /** Remove a non-selected option from a layer. */
    async removeLayerOption(layer: string, option: string): Promise<void>
    {
        return withWorkspace((root) => removeLayerOption(root, layer, option));
    }

    /** Rename an option and cascade a saved selection. */
    async renameLayerOption(layer: string, from: string, to: string): Promise<Config>
    {
        return withWorkspace((root) => renameLayerOption(root, layer, from, to));
    }

    /** Add a harness declaration to config. */
    async addHarness(harness: HarnessConfig): Promise<Config>
    {
        return withWorkspace((root) => addHarness(root, harness));
    }

    /** Remove a harness declaration and its generated references. */
    async removeHarness(name: string): Promise<void>
    {
        return withWorkspace((root) => removeHarness(root, name));
    }

    /** Update a harness and cascade its name when necessary. */
    async updateHarness(from: string, harness: HarnessConfig): Promise<Config>
    {
        return withWorkspace((root) => updateHarness(root, from, harness));
    }

    /** Register a GitHub skill source URL. */
    async addSkillSource(input: { url: string; branch?: string }): Promise<Config>
    {
        return withWorkspace((root) => addSkillSource(root, input));
    }

    /** Remove a registered GitHub skill source. */
    async removeSkillSource(owner: string, name: string): Promise<Config>
    {
        return withWorkspace((root) => removeSkillSource(root, owner, name));
    }

    /** Discover remote skills from configured GitHub sources. */
    async discoverSkills(): Promise<RemoteSkill[]>
    {
        return withWorkspace((root) => skillRemote.discoverSkills(root));
    }

    /** Install selected discovered skills into the project. */
    async installSkills(ids: string[]): Promise<string>
    {
        return withWorkspace((root) => skillRemote.installSkills(root, ids));
    }

    /** Compare installed GitHub skills with remote content hashes. */
    async checkSkillUpdates(): Promise<SkillUpdate[]>
    {
        return withWorkspace((root) => skillRemote.checkSkillUpdates(root));
    }

    /** Apply remote updates for selected installed skills. */
    async applySkillUpdates(ids: string[]): Promise<string>
    {
        return withWorkspace((root) => skillRemote.applySkillUpdates(root, ids));
    }

    /** List skills under the current user profile. */
    listUserSkills(): Promise<UserSkill[]>
    {
        return withWorkspace(() => listUserSkills());
    }

    /** Import selected user-profile skills into the project. */
    async importUserSkills(ids: string[], overwrite: boolean): Promise<string>
    {
        return withWorkspace((root) => importUserSkills(root, ids, overwrite));
    }

    /** Remove one installed project skill. */
    async removeSkill(id: string): Promise<void>
    {
        return withWorkspace((root) => removeSkill(root, id));
    }

    /** Generate outputs and return the report string. */
    async generate(selection?: LayerSelection[]): Promise<string>
    {
        return withWorkspace(async (root) => reportGenerate(await generate(root, selection)));
    }

    /** Generate then deploy into existing user harness roots. */
    async setup(selection?: LayerSelection[]): Promise<string>
    {
        return withWorkspace(async (root) => reportSetup(await setup(root, selection)));
    }
}

/** Shared workspace service used by IPC handlers. */
export const workspaceService = new WorkspaceService();
