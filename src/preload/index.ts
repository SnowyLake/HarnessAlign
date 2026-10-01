/**
 * Preload adapter that exposes typed `window.appApi` and no generic `ipcRenderer`.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { AppApi } from "../shared/contracts/AppApi.js";
import { IPC_CHANNELS } from "../shared/contracts/IpcChannels.js";
import type { AppUpdateStatus } from "../shared/models/AppUpdate.js";
import type { AppSettings } from "../shared/models/AppSettings.js";
import type { LogChange } from "../shared/models/Console.js";
import type { Agent, Config, HarnessConfig, LayerOptionInput, RuleInput } from "../shared/models/Workspace.js";

/** Renderer-facing capability API bridged onto `window.appApi`. */
const appApi: AppApi = {
    console: {
        read: () => ipcRenderer.invoke(IPC_CHANNELS.consoleRead),
        append: (input) => ipcRenderer.invoke(IPC_CHANNELS.consoleAppend, input),
        clear: () => ipcRenderer.invoke(IPC_CHANNELS.consoleClear),
        onChanged: (callback) =>
        {
            /** Forward only typed console events from Main. */
            const listener = (_event: IpcRendererEvent, change: LogChange): void => callback(change);
            ipcRenderer.on(IPC_CHANNELS.consoleChanged, listener);
            return () => { ipcRenderer.removeListener(IPC_CHANNELS.consoleChanged, listener); };
        },
    },
    sync: {
        status: () => ipcRenderer.invoke(IPC_CHANNELS.syncStatus),
        connect: (input) => ipcRenderer.invoke(IPC_CHANNELS.syncConnect, input),
        disconnect: () => ipcRenderer.invoke(IPC_CHANNELS.syncDisconnect),
        preview: () => ipcRenderer.invoke(IPC_CHANNELS.syncPreview),
        inspect: (previewId, key) => ipcRenderer.invoke(IPC_CHANNELS.syncInspect, previewId, key),
        apply: (input) => ipcRenderer.invoke(IPC_CHANNELS.syncApply, input),
        discard: (input) => ipcRenderer.invoke(IPC_CHANNELS.syncDiscard, input),
    },
    app: {
        getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.appGetVersion),
        openExternal: (url) => ipcRenderer.invoke(IPC_CHANNELS.appOpenExternal, url),
    },
    appUpdate: {
        setDraftState: (hasUnsaved) => ipcRenderer.invoke(IPC_CHANNELS.appUpdateDraftState, hasUnsaved),
        status: () => ipcRenderer.invoke(IPC_CHANNELS.appUpdateStatus),
        check: () => ipcRenderer.invoke(IPC_CHANNELS.appUpdateCheck),
        download: () => ipcRenderer.invoke(IPC_CHANNELS.appUpdateDownload),
        onChanged: (callback) =>
        {
            const listener = (_event: IpcRendererEvent, status: AppUpdateStatus): void => callback(status);
            ipcRenderer.on(IPC_CHANNELS.appUpdateChanged, listener);
            return () =>
            {
                ipcRenderer.removeListener(IPC_CHANNELS.appUpdateChanged, listener);
            };
        },
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
        saveConfig: (config, guard) => ipcRenderer.invoke(IPC_CHANNELS.workspaceSaveConfig, config, guard),
        saveRule: (input, guard) => ipcRenderer.invoke(IPC_CHANNELS.workspaceSaveRule, input, guard),
        saveLayerOption: (input, guard) => ipcRenderer.invoke(IPC_CHANNELS.workspaceSaveLayerOption, input, guard),
        saveSharedRule: (path, body, guard) => ipcRenderer.invoke(IPC_CHANNELS.workspaceSaveSharedRule, path, body, guard),
        saveAgent: (agent, guard) => ipcRenderer.invoke(IPC_CHANNELS.workspaceSaveAgent, agent, guard),
        deleteSource: (path) => ipcRenderer.invoke(IPC_CHANNELS.workspaceDeleteSource, path),
        renameSource: (from, to) => ipcRenderer.invoke(IPC_CHANNELS.workspaceRenameSource, from, to),
        addLayer: (name) => ipcRenderer.invoke(IPC_CHANNELS.workspaceAddLayer, name),
        removeLayer: (name) => ipcRenderer.invoke(IPC_CHANNELS.workspaceRemoveLayer, name),
        renameLayer: (from, to) => ipcRenderer.invoke(IPC_CHANNELS.workspaceRenameLayer, from, to),
        addLayerOption: (layer, option) => ipcRenderer.invoke(IPC_CHANNELS.workspaceAddLayerOption, layer, option),
        removeLayerOption: (layer, option) => ipcRenderer.invoke(IPC_CHANNELS.workspaceRemoveLayerOption, layer, option),
        renameLayerOption: (layer, from, to) => ipcRenderer.invoke(IPC_CHANNELS.workspaceRenameLayerOption, layer, from, to),
        addHarness: (harness: HarnessConfig) => ipcRenderer.invoke(IPC_CHANNELS.workspaceAddHarness, harness),
        removeHarness: (name) => ipcRenderer.invoke(IPC_CHANNELS.workspaceRemoveHarness, name),
        updateHarness: (from, harness) => ipcRenderer.invoke(IPC_CHANNELS.workspaceUpdateHarness, from, harness),
        openHarnessRoot: (name) => ipcRenderer.invoke(IPC_CHANNELS.workspaceOpenHarnessRoot, name),
        openItemFolder: (target) => ipcRenderer.invoke(IPC_CHANNELS.workspaceOpenItemFolder, target),
        addSkillSource: (input) => ipcRenderer.invoke(IPC_CHANNELS.workspaceAddSkillSource, input),
        removeSkillSource: (owner, name) => ipcRenderer.invoke(IPC_CHANNELS.workspaceRemoveSkillSource, owner, name),
        discoverSkills: () => ipcRenderer.invoke(IPC_CHANNELS.workspaceDiscoverSkills),
        readDiscoveredSkillContent: (previewId) => ipcRenderer.invoke(IPC_CHANNELS.workspaceReadDiscoveredSkillContent, previewId),
        installDiscoveredSkill: (previewId) => ipcRenderer.invoke(IPC_CHANNELS.workspaceInstallDiscoveredSkill, previewId),
        installSkills: (ids) => ipcRenderer.invoke(IPC_CHANNELS.workspaceInstallSkills, ids),
        checkSkillUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.workspaceCheckSkillUpdates),
        readSkillUpdatePreview: (previewId) => ipcRenderer.invoke(IPC_CHANNELS.workspaceSkillUpdatePreview, previewId),
        applySkillUpdates: (previewIds) => ipcRenderer.invoke(IPC_CHANNELS.workspaceApplySkillUpdates, previewIds),
        readSkillContent: (id) => ipcRenderer.invoke(IPC_CHANNELS.workspaceReadSkillContent, id),
        saveSkillContent: (id, content, expectedContent) => ipcRenderer.invoke(IPC_CHANNELS.workspaceSaveSkillContent, id, content, expectedContent),
        listUserSkills: () => ipcRenderer.invoke(IPC_CHANNELS.workspaceListUserSkills),
        importUserSkills: (ids, overwrite) => ipcRenderer.invoke(IPC_CHANNELS.workspaceImportUserSkills, ids, overwrite),
        removeSkill: (id) => ipcRenderer.invoke(IPC_CHANNELS.workspaceRemoveSkill, id),
        generate: (selection) => ipcRenderer.invoke(IPC_CHANNELS.workspaceGenerate, selection),
        previewSetup: (selection) => ipcRenderer.invoke(IPC_CHANNELS.workspaceSetupPreview, selection),
        setup: (previewId, overwriteExternal) => ipcRenderer.invoke(IPC_CHANNELS.workspaceSetup, previewId, overwriteExternal),
    },
};

contextBridge.exposeInMainWorld("appApi", appApi);
