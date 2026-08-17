/**
 * Renderer-facing capability contract implemented in preload.
 * Shared code must not import Electron, Node, DOM, or React.
 */

import type { AppSettings } from "../models/AppSettings.js";
import type { Agent, Config, HarnessConfig, RuleInput, Workspace } from "../models/Workspace.js";

/** Privileged capabilities exposed to the renderer through `window.appApi`. */
export interface AppApi
{
    app: {
        getVersion(): Promise<string>;
        openExternal(url: string): Promise<void>;
    };
    settings: {
        get(): Promise<AppSettings>;
        update(patch: Partial<AppSettings>): Promise<AppSettings>;
        onChanged(callback: (settings: AppSettings) => void): () => void;
    };
    workspace: {
        openDirectory(): Promise<string | undefined>;
        load(root: string): Promise<Workspace>;
        saveConfig(root: string, config: Config): Promise<Config>;
        saveRule(root: string, input: RuleInput): Promise<void>;
        saveSharedRule(root: string, path: string, body: string): Promise<void>;
        saveAgent(root: string, agent: Agent): Promise<void>;
        deleteSource(root: string, path: string): Promise<void>;
        addProfile(root: string, profile: string): Promise<Config>;
        removeProfile(root: string, profile: string): Promise<Config>;
        addHarness(root: string, harness: HarnessConfig): Promise<Config>;
        removeHarness(root: string, name: string): Promise<void>;
        renameHarness(root: string, from: string, to: string): Promise<void>;
        generate(root: string, profile?: string): Promise<string>;
        check(root: string, profile?: string): Promise<string[]>;
        setup(root: string, profile?: string): Promise<string>;
    };
}
