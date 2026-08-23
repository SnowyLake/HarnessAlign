/**
 * Preload adapter that exposes typed `window.appApi` and no generic `ipcRenderer`.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { AppApi } from "../shared/contracts/AppApi.js";
import { IPC_CHANNELS } from "../shared/contracts/IpcChannels.js";
import type { AppSettings } from "../shared/models/AppSettings.js";
import type { Agent, Config, HarnessConfig, LayerOptionInput, RuleInput } from "../shared/models/Workspace.js";

/** Renderer-facing capability API bridged onto `window.appApi`. */
const appApi: AppApi = {
    app: {
        getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.appGetVersion),
        openExternal: (url) => ipcRenderer.invoke(IPC_CHANNELS.appOpenExternal, url),
        openConfigDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.appOpenConfigDirectory),
    },
    settings: {
        get: () => ipcRenderer.invoke(IPC_CHANNELS.settingsGet),
        update: (patch) => ipcRenderer.invoke(IPC_CHANNELS.settingsUpdate, patch),
        onChanged: (callback) =>
        {
            const listener = (_event: IpcRendererEvent, settings: AppSettings) =>
            {
                callback(settings);
            };
            ipcRenderer.on(IPC_CHANNELS.settingsChanged, listener);
            return () =>
            {
                ipcRenderer.removeListener(IPC_CHANNELS.settingsChanged, listener);
            };
        },
    },
    workspace: {
        load: () => ipcRenderer.invoke(IPC_CHANNELS.workspaceLoad),
        saveConfig: (config: Config) => ipcRenderer.invoke(IPC_CHANNELS.workspaceSaveConfig, config),
        saveRule: (input: RuleInput) => ipcRenderer.invoke(IPC_CHANNELS.workspaceSaveRule, input),
        saveLayerOption: (input: LayerOptionInput) => ipcRenderer.invoke(IPC_CHANNELS.workspaceSaveLayerOption, input),
        saveSharedRule: (path, body) => ipcRenderer.invoke(IPC_CHANNELS.workspaceSaveSharedRule, path, body),
        saveAgent: (agent: Agent) => ipcRenderer.invoke(IPC_CHANNELS.workspaceSaveAgent, agent),
        deleteSource: (path) => ipcRenderer.invoke(IPC_CHANNELS.workspaceDeleteSource, path),
        renameSource: (from, to) => ipcRenderer.invoke(IPC_CHANNELS.workspaceRenameSource, from, to),
        addLayer: (name, initialOption) => ipcRenderer.invoke(IPC_CHANNELS.workspaceAddLayer, name, initialOption),
        removeLayer: (name) => ipcRenderer.invoke(IPC_CHANNELS.workspaceRemoveLayer, name),
        renameLayer: (from, to) => ipcRenderer.invoke(IPC_CHANNELS.workspaceRenameLayer, from, to),
        addLayerOption: (layer, option) => ipcRenderer.invoke(IPC_CHANNELS.workspaceAddLayerOption, layer, option),
        removeLayerOption: (layer, option) => ipcRenderer.invoke(IPC_CHANNELS.workspaceRemoveLayerOption, layer, option),
        renameLayerOption: (layer, from, to) => ipcRenderer.invoke(IPC_CHANNELS.workspaceRenameLayerOption, layer, from, to),
        addHarness: (harness: HarnessConfig) => ipcRenderer.invoke(IPC_CHANNELS.workspaceAddHarness, harness),
        removeHarness: (name) => ipcRenderer.invoke(IPC_CHANNELS.workspaceRemoveHarness, name),
        renameHarness: (from, to) => ipcRenderer.invoke(IPC_CHANNELS.workspaceRenameHarness, from, to),
        updateHarness: (from, harness) => ipcRenderer.invoke(IPC_CHANNELS.workspaceUpdateHarness, from, harness),
        addSkillSource: (input) => ipcRenderer.invoke(IPC_CHANNELS.workspaceAddSkillSource, input),
        removeSkillSource: (owner, name) => ipcRenderer.invoke(IPC_CHANNELS.workspaceRemoveSkillSource, owner, name),
        discoverSkills: () => ipcRenderer.invoke(IPC_CHANNELS.workspaceDiscoverSkills),
        installSkills: (ids) => ipcRenderer.invoke(IPC_CHANNELS.workspaceInstallSkills, ids),
        checkSkillUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.workspaceCheckSkillUpdates),
        applySkillUpdates: (ids) => ipcRenderer.invoke(IPC_CHANNELS.workspaceApplySkillUpdates, ids),
        listUserSkills: () => ipcRenderer.invoke(IPC_CHANNELS.workspaceListUserSkills),
        importUserSkills: (ids, overwrite) => ipcRenderer.invoke(IPC_CHANNELS.workspaceImportUserSkills, ids, overwrite),
        removeSkill: (id) => ipcRenderer.invoke(IPC_CHANNELS.workspaceRemoveSkill, id),
        generate: (selection) => ipcRenderer.invoke(IPC_CHANNELS.workspaceGenerate, selection),
        check: (selection) => ipcRenderer.invoke(IPC_CHANNELS.workspaceCheck, selection),
        setup: (selection) => ipcRenderer.invoke(IPC_CHANNELS.workspaceSetup, selection),
    },
};

contextBridge.exposeInMainWorld("appApi", appApi);
