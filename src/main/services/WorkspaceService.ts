/**
 * Privileged workspace operations that wrap the CLI engine after path validation.
 */

import { join, resolve } from "node:path";
import {
    addHarness,
    addLayer,
    addLayerOption,
    addSkillSource,
    deleteSource,
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
import { ABSOLUTE_PATH_SCHEMA } from "../../shared/models/Schemas.js";
import * as skillRemote from "./SkillRemoteService.js";

/** Resolve and validate an absolute workspace root from the renderer. */
function rootPath(root: string): string
{
    return resolve(ABSOLUTE_PATH_SCHEMA.parse(root));
}

/** Privileged workspace operations that wrap the CLI engine. */
export class WorkspaceService
{
    /** Load and validate a `.halign` workspace. */
    async load(root: string): Promise<Workspace>
    {
        const resolved = rootPath(root);
        const [workspace, generatedFiles] = await Promise.all([
            loadWorkspace(resolved),
            readGeneratedFiles(resolved),
        ]);
        return {
            ...workspace,
            generatedFiles: [...generatedFiles].map(([path, content]) => ({ path, content: content.toString("utf8") })),
        };
    }

    /** Validate and write `config.json`. */
    saveConfig(root: string, config: Config): Promise<Config>
    {
        return saveConfig(rootPath(root), config);
    }

    /** Validate and write a root rule. */
    saveRule(root: string, input: RuleInput): Promise<void>
    {
        return saveRule(rootPath(root), input);
    }

    /** Validate and write a layer option. */
    saveLayerOption(root: string, input: LayerOptionInput): Promise<void>
    {
        return saveLayerOption(rootPath(root), input);
    }

    /** Validate and write a shared-rule markdown file. */
    saveSharedRule(root: string, path: string, body: string): Promise<void>
    {
        return saveSharedRule(rootPath(root), path, body);
    }

    /** Validate and write a subagent source file. */
    saveAgent(root: string, agent: Agent): Promise<void>
    {
        return saveAgent(rootPath(root), agent);
    }

    /** Delete a `.halign` source file after containment checks. */
    deleteSource(root: string, path: string): Promise<void>
    {
        return deleteSource(rootPath(root), path);
    }

    /** Create a layer directory with its first empty option. */
    addLayer(root: string, name: string, initialOption: string): Promise<Config>
    {
        return addLayer(rootPath(root), name, initialOption);
    }

    /** Remove a layer directory and drop it from the project selection when present. */
    removeLayer(root: string, name: string): Promise<Config>
    {
        return removeLayer(rootPath(root), name);
    }

    /** Rename a layer directory and cascade its project selection when present. */
    renameLayer(root: string, from: string, to: string): Promise<Config>
    {
        return renameLayer(rootPath(root), from, to);
    }

    /** Create an empty option under an existing layer. */
    addLayerOption(root: string, layer: string, option: string): Promise<void>
    {
        return addLayerOption(rootPath(root), layer, option);
    }

    /** Remove a non-selected option from a layer. */
    removeLayerOption(root: string, layer: string, option: string): Promise<void>
    {
        return removeLayerOption(rootPath(root), layer, option);
    }

    /** Rename an option and cascade a saved selection. */
    renameLayerOption(root: string, layer: string, from: string, to: string): Promise<Config>
    {
        return renameLayerOption(rootPath(root), layer, from, to);
    }

    /** Add a harness declaration to config. */
    addHarness(root: string, harness: HarnessConfig): Promise<Config>
    {
        return addHarness(rootPath(root), harness);
    }

    /** Remove a harness declaration and its generated references. */
    removeHarness(root: string, name: string): Promise<void>
    {
        return removeHarness(rootPath(root), name);
    }

    /** Rename a harness and cascade rule targets and agent keys. */
    renameHarness(root: string, from: string, to: string): Promise<void>
    {
        return renameHarness(rootPath(root), from, to);
    }

    /** Register a GitHub skill source URL. */
    addSkillSource(root: string, input: { url: string; branch?: string }): Promise<Config>
    {
        return addSkillSource(rootPath(root), input);
    }

    /** Remove a registered GitHub skill source. */
    removeSkillSource(root: string, owner: string, name: string): Promise<Config>
    {
        return removeSkillSource(rootPath(root), owner, name);
    }

    /** Discover remote skills from configured GitHub sources. */
    discoverSkills(root: string): Promise<RemoteSkill[]>
    {
        return skillRemote.discoverSkills(rootPath(root));
    }

    /** Install selected discovered skills into the project. */
    installSkills(root: string, ids: string[]): Promise<string>
    {
        return skillRemote.installSkills(rootPath(root), ids);
    }

    /** Compare installed GitHub skills with remote content hashes. */
    checkSkillUpdates(root: string): Promise<SkillUpdate[]>
    {
        return skillRemote.checkSkillUpdates(rootPath(root));
    }

    /** Apply remote updates for selected installed skills. */
    applySkillUpdates(root: string, ids: string[]): Promise<string>
    {
        return skillRemote.applySkillUpdates(rootPath(root), ids);
    }

    /** List skills under the current user profile. */
    listUserSkills(): Promise<UserSkill[]>
    {
        return listUserSkills();
    }

    /** Import selected user-profile skills into the project. */
    importUserSkills(root: string, ids: string[], overwrite: boolean): Promise<string>
    {
        return importUserSkills(rootPath(root), ids, overwrite);
    }

    /** Remove one installed project skill. */
    removeSkill(root: string, id: string): Promise<void>
    {
        return removeSkill(rootPath(root), id);
    }

    /** Generate outputs and return the CLI report string. */
    async generate(root: string, selection?: LayerSelection[]): Promise<string>
    {
        const resolved = rootPath(root);
        const outputs = selection ? await generate(resolved, selection) : await generate(resolved);
        return reportGenerate(join(resolved, ".halign", "generated"), outputs);
    }

    /** Compare generated output with the workspace and return differences. */
    check(root: string, selection?: LayerSelection[]): Promise<string[]>
    {
        return selection ? check(rootPath(root), selection) : check(rootPath(root));
    }

    /** Generate then deploy into existing user harness roots. */
    async setup(root: string, selection?: LayerSelection[]): Promise<string>
    {
        return reportSetup(selection ? await setup(rootPath(root), selection) : await setup(rootPath(root)));
    }
}

/** Shared workspace service used by IPC handlers. */
export const workspaceService = new WorkspaceService();
