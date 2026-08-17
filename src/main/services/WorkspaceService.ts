/**
 * Privileged workspace operations that wrap the CLI engine after path validation.
 */

import { join, resolve } from "node:path";
import {
    addHarness,
    addProfile,
    deleteSource,
    loadWorkspace,
    removeHarness,
    removeProfile,
    renameHarness,
    saveAgent,
    saveConfig,
    saveRule,
    saveSharedRule,
} from "../../engine/Edit.js";
import { check, generate, reportGenerate } from "../../engine/Generate.js";
import { reportSetup, setup } from "../../engine/Setup.js";
import type { Agent, Config, HarnessConfig, RuleInput, Workspace } from "../../shared/models/Workspace.js";
import { ABSOLUTE_PATH_SCHEMA } from "../../shared/models/Schemas.js";

/** Resolve and validate an absolute workspace root from the renderer. */
function rootPath(root: string): string
{
    return resolve(ABSOLUTE_PATH_SCHEMA.parse(root));
}

/** Privileged workspace operations that wrap the CLI engine. */
export class WorkspaceService
{
    /** Load and validate a `.halign` workspace. */
    load(root: string): Promise<Workspace>
    {
        return loadWorkspace(rootPath(root));
    }

    /** Validate and write `config.json`. */
    saveConfig(root: string, config: Config): Promise<Config>
    {
        return saveConfig(rootPath(root), config);
    }

    /** Validate and write a root or domain rule. */
    saveRule(root: string, input: RuleInput): Promise<void>
    {
        return saveRule(rootPath(root), input);
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

    /** Create a profile directory and add it to config. */
    addProfile(root: string, profile: string): Promise<Config>
    {
        return addProfile(rootPath(root), profile);
    }

    /** Remove a profile from config after it is unused. */
    removeProfile(root: string, profile: string): Promise<Config>
    {
        return removeProfile(rootPath(root), profile);
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

    /** Generate outputs and return the CLI report string. */
    async generate(root: string, profile?: string): Promise<string>
    {
        const resolved = rootPath(root);
        const outputs = profile ? await generate(resolved, profile) : await generate(resolved);
        return reportGenerate(join(resolved, ".halign", "generated"), outputs);
    }

    /** Compare generated output with the workspace and return differences. */
    check(root: string, profile?: string): Promise<string[]>
    {
        return profile ? check(rootPath(root), profile) : check(rootPath(root));
    }

    /** Generate then deploy into existing user harness roots. */
    async setup(root: string, profile?: string): Promise<string>
    {
        return reportSetup(profile ? await setup(rootPath(root), profile) : await setup(rootPath(root)));
    }
}

/** Shared workspace service used by IPC handlers. */
export const workspaceService = new WorkspaceService();
