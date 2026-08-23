/**
 * Renderer-facing capability contract implemented in preload.
 * Shared code must not import Electron, Node, DOM, or React.
 */

import type { AppSettings } from "../models/AppSettings.js";
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
} from "../models/Workspace.js";

/** Privileged capabilities exposed to the renderer through `window.appApi`. */
export interface AppApi
{
    app: {
        getVersion(): Promise<string>;
        openExternal(url: string): Promise<void>;
        openConfigDirectory(): Promise<string>;
    };
    settings: {
        get(): Promise<AppSettings>;
        update(patch: Partial<AppSettings>): Promise<AppSettings>;
        onChanged(callback: (settings: AppSettings) => void): () => void;
    };
    workspace: {
        load(): Promise<Workspace>;
        saveConfig(config: Config): Promise<Config>;
        saveRule(input: RuleInput): Promise<void>;
        saveLayerOption(input: LayerOptionInput): Promise<void>;
        saveSharedRule(path: string, body: string): Promise<void>;
        saveAgent(agent: Agent): Promise<void>;
        deleteSource(path: string): Promise<void>;
        renameSource(from: string, to: string): Promise<void>;
        addLayer(name: string, initialOption: string): Promise<Config>;
        removeLayer(name: string): Promise<Config>;
        renameLayer(from: string, to: string): Promise<Config>;
        addLayerOption(layer: string, option: string): Promise<void>;
        removeLayerOption(layer: string, option: string): Promise<void>;
        renameLayerOption(layer: string, from: string, to: string): Promise<Config>;
        addHarness(harness: HarnessConfig): Promise<Config>;
        removeHarness(name: string): Promise<void>;
        renameHarness(from: string, to: string): Promise<void>;
        updateHarness(from: string, harness: HarnessConfig): Promise<Config>;
        addSkillSource(input: { url: string; branch?: string }): Promise<Config>;
        removeSkillSource(owner: string, name: string): Promise<Config>;
        discoverSkills(): Promise<RemoteSkill[]>;
        installSkills(ids: string[]): Promise<string>;
        checkSkillUpdates(): Promise<SkillUpdate[]>;
        applySkillUpdates(ids: string[]): Promise<string>;
        listUserSkills(): Promise<UserSkill[]>;
        importUserSkills(ids: string[], overwrite: boolean): Promise<string>;
        removeSkill(id: string): Promise<void>;
        generate(selection?: LayerSelection[]): Promise<string>;
        check(selection?: LayerSelection[]): Promise<string[]>;
        setup(selection?: LayerSelection[]): Promise<string>;
    };
}
