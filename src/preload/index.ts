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
        openDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.workspaceOpenDirectory),
        load: (root) => ipcRenderer.invoke(IPC_CHANNELS.workspaceLoad, root),
        saveConfig: (root, config: Config) => ipcRenderer.invoke(IPC_CHANNELS.workspaceSaveConfig, root, config),
        saveRule: (root, input: RuleInput) => ipcRenderer.invoke(IPC_CHANNELS.workspaceSaveRule, root, input),
        saveLayerOption: (root, input: LayerOptionInput) => ipcRenderer.invoke(IPC_CHANNELS.workspaceSaveLayerOption, root, input),
        saveSharedRule: (root, path, body) => ipcRenderer.invoke(IPC_CHANNELS.workspaceSaveSharedRule, root, path, body),
        saveAgent: (root, agent: Agent) => ipcRenderer.invoke(IPC_CHANNELS.workspaceSaveAgent, root, agent),
        deleteSource: (root, path) => ipcRenderer.invoke(IPC_CHANNELS.workspaceDeleteSource, root, path),
        addLayer: (root, name, initialOption) => ipcRenderer.invoke(IPC_CHANNELS.workspaceAddLayer, root, name, initialOption),
        removeLayer: (root, name) => ipcRenderer.invoke(IPC_CHANNELS.workspaceRemoveLayer, root, name),
        renameLayer: (root, from, to) => ipcRenderer.invoke(IPC_CHANNELS.workspaceRenameLayer, root, from, to),
        addLayerOption: (root, layer, option) => ipcRenderer.invoke(IPC_CHANNELS.workspaceAddLayerOption, root, layer, option),
        removeLayerOption: (root, layer, option) => ipcRenderer.invoke(IPC_CHANNELS.workspaceRemoveLayerOption, root, layer, option),
        renameLayerOption: (root, layer, from, to) => ipcRenderer.invoke(IPC_CHANNELS.workspaceRenameLayerOption, root, layer, from, to),
        addHarness: (root, harness: HarnessConfig) => ipcRenderer.invoke(IPC_CHANNELS.workspaceAddHarness, root, harness),
        removeHarness: (root, name) => ipcRenderer.invoke(IPC_CHANNELS.workspaceRemoveHarness, root, name),
        renameHarness: (root, from, to) => ipcRenderer.invoke(IPC_CHANNELS.workspaceRenameHarness, root, from, to),
        addSkillSource: (root, input) => ipcRenderer.invoke(IPC_CHANNELS.workspaceAddSkillSource, root, input),
        removeSkillSource: (root, owner, name) => ipcRenderer.invoke(IPC_CHANNELS.workspaceRemoveSkillSource, root, owner, name),
        discoverSkills: (root) => ipcRenderer.invoke(IPC_CHANNELS.workspaceDiscoverSkills, root),
        installSkills: (root, ids) => ipcRenderer.invoke(IPC_CHANNELS.workspaceInstallSkills, root, ids),
        checkSkillUpdates: (root) => ipcRenderer.invoke(IPC_CHANNELS.workspaceCheckSkillUpdates, root),
        applySkillUpdates: (root, ids) => ipcRenderer.invoke(IPC_CHANNELS.workspaceApplySkillUpdates, root, ids),
        listUserSkills: () => ipcRenderer.invoke(IPC_CHANNELS.workspaceListUserSkills),
        importUserSkills: (root, ids, overwrite) => ipcRenderer.invoke(IPC_CHANNELS.workspaceImportUserSkills, root, ids, overwrite),
        removeSkill: (root, id) => ipcRenderer.invoke(IPC_CHANNELS.workspaceRemoveSkill, root, id),
        generate: (root, selection) => ipcRenderer.invoke(IPC_CHANNELS.workspaceGenerate, root, selection),
        check: (root, selection) => ipcRenderer.invoke(IPC_CHANNELS.workspaceCheck, root, selection),
        setup: (root, selection) => ipcRenderer.invoke(IPC_CHANNELS.workspaceSetup, root, selection),
    },
};

contextBridge.exposeInMainWorld("appApi", appApi);
