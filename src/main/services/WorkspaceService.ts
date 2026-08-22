/**
 * Privileged workspace operations that wrap the CLI engine after path validation.
 * The config root is always `%USERPROFILE%`; renderer input never chooses a directory.
 */

import { join } from "node:path";
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
    renameHarness,
    renameLayer,
    renameLayerOption,
    saveAgent,
    saveConfig,
    saveLayerOption,
    saveRule,
    saveSharedRule,
} from "../../engine/Edit.js";
import { check, generate, readGeneratedFiles, reportGenerate } from "../../engine/Generate.js";
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

/** Resolve `%USERPROFILE%` and create `.halign` on first use. */
async function userRoot(): Promise<string>
{
    return ensureUserWorkspace();
}

/** Privileged workspace operations that wrap the CLI engine. */
export class WorkspaceService
{
    /** Load and validate the user `.halign` workspace. */
    async load(): Promise<Workspace>
    {
        const root = await userRoot();
        const [workspace, generatedFiles] = await Promise.all([
            loadWorkspace(root),
            readGeneratedFiles(root),
        ]);
        return {
            ...workspace,
            generatedFiles: [...generatedFiles].map(([path, content]) => ({ path, content: content.toString("utf8") })),
        };
    }

    /** Validate and write `config.json`. */
    async saveConfig(config: Config): Promise<Config>
    {
        return saveConfig(await userRoot(), config);
    }

    /** Validate and write a root rule. */
    async saveRule(input: RuleInput): Promise<void>
    {
        return saveRule(await userRoot(), input);
    }

    /** Validate and write a layer option. */
    async saveLayerOption(input: LayerOptionInput): Promise<void>
    {
        return saveLayerOption(await userRoot(), input);
    }

    /** Validate and write a shared-rule markdown file. */
    async saveSharedRule(path: string, body: string): Promise<void>
    {
        return saveSharedRule(await userRoot(), path, body);
    }

    /** Validate and write a subagent source file. */
    async saveAgent(agent: Agent): Promise<void>
    {
        return saveAgent(await userRoot(), agent);
    }

    /** Delete a `.halign` source file after containment checks. */
    async deleteSource(path: string): Promise<void>
    {
        return deleteSource(await userRoot(), path);
    }

    /** Create a layer directory with its first empty option. */
    async addLayer(name: string, initialOption: string): Promise<Config>
    {
        return addLayer(await userRoot(), name, initialOption);
    }

    /** Remove a layer directory and drop it from the project selection when present. */
    async removeLayer(name: string): Promise<Config>
    {
        return removeLayer(await userRoot(), name);
    }

    /** Rename a layer directory and cascade its project selection when present. */
    async renameLayer(from: string, to: string): Promise<Config>
    {
        return renameLayer(await userRoot(), from, to);
    }

    /** Create an empty option under an existing layer. */
    async addLayerOption(layer: string, option: string): Promise<void>
    {
        return addLayerOption(await userRoot(), layer, option);
    }

    /** Remove a non-selected option from a layer. */
    async removeLayerOption(layer: string, option: string): Promise<void>
    {
        return removeLayerOption(await userRoot(), layer, option);
    }

    /** Rename an option and cascade a saved selection. */
    async renameLayerOption(layer: string, from: string, to: string): Promise<Config>
    {
        return renameLayerOption(await userRoot(), layer, from, to);
    }

    /** Add a harness declaration to config. */
    async addHarness(harness: HarnessConfig): Promise<Config>
    {
        return addHarness(await userRoot(), harness);
    }

    /** Remove a harness declaration and its generated references. */
    async removeHarness(name: string): Promise<void>
    {
        return removeHarness(await userRoot(), name);
    }

    /** Rename a harness and cascade rule targets and agent keys. */
    async renameHarness(from: string, to: string): Promise<void>
    {
        return renameHarness(await userRoot(), from, to);
    }

    /** Register a GitHub skill source URL. */
    async addSkillSource(input: { url: string; branch?: string }): Promise<Config>
    {
        return addSkillSource(await userRoot(), input);
    }

    /** Remove a registered GitHub skill source. */
    async removeSkillSource(owner: string, name: string): Promise<Config>
    {
        return removeSkillSource(await userRoot(), owner, name);
    }

    /** Discover remote skills from configured GitHub sources. */
    async discoverSkills(): Promise<RemoteSkill[]>
    {
        return skillRemote.discoverSkills(await userRoot());
    }

    /** Install selected discovered skills into the project. */
    async installSkills(ids: string[]): Promise<string>
    {
        return skillRemote.installSkills(await userRoot(), ids);
    }

    /** Compare installed GitHub skills with remote content hashes. */
    async checkSkillUpdates(): Promise<SkillUpdate[]>
    {
        return skillRemote.checkSkillUpdates(await userRoot());
    }

    /** Apply remote updates for selected installed skills. */
    async applySkillUpdates(ids: string[]): Promise<string>
    {
        return skillRemote.applySkillUpdates(await userRoot(), ids);
    }

    /** List skills under the current user profile. */
    listUserSkills(): Promise<UserSkill[]>
    {
        return listUserSkills();
    }

    /** Import selected user-profile skills into the project. */
    async importUserSkills(ids: string[], overwrite: boolean): Promise<string>
    {
        return importUserSkills(await userRoot(), ids, overwrite);
    }

    /** Remove one installed project skill. */
    async removeSkill(id: string): Promise<void>
    {
        return removeSkill(await userRoot(), id);
    }

    /** Generate outputs and return the CLI report string. */
    async generate(selection?: LayerSelection[]): Promise<string>
    {
        const root = await userRoot();
        const outputs = await generate(root, selection);
        return reportGenerate(join(root, ".halign", "generated"), outputs);
    }

    /** Compare generated output with the workspace and return differences. */
    async check(selection?: LayerSelection[]): Promise<string[]>
    {
        return check(await userRoot(), selection);
    }

    /** Generate then deploy into existing user harness roots. */
    async setup(selection?: LayerSelection[]): Promise<string>
    {
        return reportSetup(await setup(await userRoot(), selection));
    }
}

/** Shared workspace service used by IPC handlers. */
export const workspaceService = new WorkspaceService();
