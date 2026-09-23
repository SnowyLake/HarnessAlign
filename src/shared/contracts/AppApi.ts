/**
 * Renderer-facing capability contract implemented in preload.
 * Shared code must not import Electron, Node, DOM, or React.
 */

import type { AppUpdateStatus } from "../models/AppUpdate.js";
import type { AppSettings } from "../models/AppSettings.js";
import type { LogChange, LogInput, LogSnapshot } from "../models/Console.js";
import type { SyncApplyInput, SyncConnectionInput, SyncDetail, SyncDiscardInput, SyncPreview, SyncResult, SyncStatus } from "../models/Sync.js";
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
    console: {
        read(): Promise<LogSnapshot>;
        append(input: LogInput): Promise<void>;
        clear(): Promise<void>;
        onChanged(callback: (change: LogChange) => void): () => void;
    };
    sync: {
        status(): Promise<SyncStatus>;
        connect(input: SyncConnectionInput): Promise<SyncStatus>;
        disconnect(): Promise<SyncStatus>;
        preview(): Promise<SyncPreview>;
        inspect(previewId: string, key: string): Promise<SyncDetail>;
        apply(input: SyncApplyInput): Promise<SyncResult>;
        discard(input: SyncDiscardInput): Promise<SyncResult>;
    };
    app: {
        getVersion(): Promise<string>;
        openExternal(url: string): Promise<void>;
    };
    appUpdate: {
        status(): Promise<AppUpdateStatus>;
        check(): Promise<AppUpdateStatus>;
        download(): Promise<AppUpdateStatus>;
        onChanged(callback: (status: AppUpdateStatus) => void): () => void;
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
        addLayer(name: string): Promise<Config>;
        removeLayer(name: string): Promise<Config>;
        renameLayer(from: string, to: string): Promise<Config>;
        addLayerOption(layer: string, option: string): Promise<void>;
        removeLayerOption(layer: string, option: string): Promise<void>;
        renameLayerOption(layer: string, from: string, to: string): Promise<Config>;
        addHarness(harness: HarnessConfig): Promise<Config>;
        removeHarness(name: string): Promise<void>;
        updateHarness(from: string, harness: HarnessConfig): Promise<Config>;
        openHarnessRoot(name: string): Promise<void>;
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
        setup(selection?: LayerSelection[]): Promise<string>;
    };
}
