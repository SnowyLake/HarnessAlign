/**
 * Workspace IPC handlers. Every path and payload is validated in Main before touching the engine.
 * The config root is always `%USERPROFILE%`; renderer input never chooses a directory.
 */

import { ipcMain } from "electron";
import { IPC_CHANNELS } from "../../shared/contracts/IpcChannels.js";
import type { Agent, Config, HarnessConfig, LayerOptionInput, LayerSelection, RuleInput } from "../../shared/models/Workspace.js";
import { workspaceService } from "../services/WorkspaceService.js";
import { assertTrusted, runIpc } from "../utils/Ipc.js";

/** Register workspace IPC handlers. */
export function registerWorkspaceHandlers(): void
{
    ipcMain.handle(IPC_CHANNELS.workspaceLoad, (event) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.load();
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceSaveConfig, (event, config: Config) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.saveConfig(config);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceSaveRule, (event, input: RuleInput) => runIpc(async () =>
    {
        assertTrusted(event);
        await workspaceService.saveRule(input);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceSaveLayerOption, (event, input: LayerOptionInput) => runIpc(async () =>
    {
        assertTrusted(event);
        await workspaceService.saveLayerOption(input);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceSaveSharedRule, (event, path: string, body: string) => runIpc(async () =>
    {
        assertTrusted(event);
        await workspaceService.saveSharedRule(path, body);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceSaveAgent, (event, agent: Agent) => runIpc(async () =>
    {
        assertTrusted(event);
        await workspaceService.saveAgent(agent);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceDeleteSource, (event, path: string) => runIpc(async () =>
    {
        assertTrusted(event);
        await workspaceService.deleteSource(path);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceRenameSource, (event, from: string, to: string) => runIpc(async () =>
    {
        assertTrusted(event);
        await workspaceService.renameSource(from, to);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceAddLayer, (event, name: string, initialOption: string) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.addLayer(name, initialOption);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceRemoveLayer, (event, name: string) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.removeLayer(name);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceRenameLayer, (event, from: string, to: string) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.renameLayer(from, to);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceAddLayerOption, (event, layer: string, option: string) => runIpc(async () =>
    {
        assertTrusted(event);
        await workspaceService.addLayerOption(layer, option);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceRemoveLayerOption, (event, layer: string, option: string) => runIpc(async () =>
    {
        assertTrusted(event);
        await workspaceService.removeLayerOption(layer, option);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceRenameLayerOption, (event, layer: string, from: string, to: string) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.renameLayerOption(layer, from, to);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceAddHarness, (event, harness: HarnessConfig) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.addHarness(harness);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceRemoveHarness, (event, name: string) => runIpc(async () =>
    {
        assertTrusted(event);
        await workspaceService.removeHarness(name);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceRenameHarness, (event, from: string, to: string) => runIpc(async () =>
    {
        assertTrusted(event);
        await workspaceService.renameHarness(from, to);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceUpdateHarness, (event, from: string, harness: HarnessConfig) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.updateHarness(from, harness);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceAddSkillSource, (event, input: { url: string; branch?: string }) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.addSkillSource(input);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceRemoveSkillSource, (event, owner: string, name: string) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.removeSkillSource(owner, name);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceDiscoverSkills, (event) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.discoverSkills();
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceInstallSkills, (event, ids: string[]) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.installSkills(ids);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceCheckSkillUpdates, (event) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.checkSkillUpdates();
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceApplySkillUpdates, (event, ids: string[]) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.applySkillUpdates(ids);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceListUserSkills, (event) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.listUserSkills();
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceImportUserSkills, (event, ids: string[], overwrite: boolean) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.importUserSkills(ids, overwrite);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceRemoveSkill, (event, id: string) => runIpc(async () =>
    {
        assertTrusted(event);
        await workspaceService.removeSkill(id);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceGenerate, (event, selection?: LayerSelection[]) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.generate(selection);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceCheck, (event, selection?: LayerSelection[]) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.check(selection);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceSetup, (event, selection?: LayerSelection[]) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.setup(selection);
    }));
}
