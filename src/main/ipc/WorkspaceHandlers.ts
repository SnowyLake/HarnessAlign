/**
 * Workspace IPC handlers. Every path and payload is validated in Main before touching the engine.
 * The config root is always `%USERPROFILE%`; renderer input never chooses a directory.
 */

import { ipcMain } from "electron";
import { IPC_CHANNELS } from "../../shared/contracts/IpcChannels.js";
import { z } from "zod";
import { AGENT_SCHEMA, CONFIG_SCHEMA, HARNESS_SCHEMA, LAYER_OPTION_INPUT_SCHEMA, LAYER_SELECTION_SCHEMA, RULE_INPUT_SCHEMA, SKILL_IDS_SCHEMA, SKILL_SOURCE_INPUT_SCHEMA } from "../../shared/models/Schemas.js";
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

    ipcMain.handle(IPC_CHANNELS.workspaceSaveConfig, (event, config: unknown) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.saveConfig(CONFIG_SCHEMA.parse(config));
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceSaveRule, (event, input: unknown) => runIpc(async () =>
    {
        assertTrusted(event);
        await workspaceService.saveRule(RULE_INPUT_SCHEMA.parse(input));
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceSaveLayerOption, (event, input: unknown) => runIpc(async () =>
    {
        assertTrusted(event);
        await workspaceService.saveLayerOption(LAYER_OPTION_INPUT_SCHEMA.parse(input));
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceSaveSharedRule, (event, path: unknown, body: unknown) => runIpc(async () =>
    {
        assertTrusted(event);
        await workspaceService.saveSharedRule(z.string().parse(path), z.string().parse(body));
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceSaveAgent, (event, agent: unknown) => runIpc(async () =>
    {
        assertTrusted(event);
        await workspaceService.saveAgent(AGENT_SCHEMA.parse(agent));
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceDeleteSource, (event, path: unknown) => runIpc(async () =>
    {
        assertTrusted(event);
        await workspaceService.deleteSource(z.string().parse(path));
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceRenameSource, (event, from: unknown, to: unknown) => runIpc(async () =>
    {
        assertTrusted(event);
        await workspaceService.renameSource(z.string().parse(from), z.string().parse(to));
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceAddLayer, (event, name: unknown) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.addLayer(z.string().parse(name));
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceRemoveLayer, (event, name: unknown) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.removeLayer(z.string().parse(name));
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceRenameLayer, (event, from: unknown, to: unknown) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.renameLayer(z.string().parse(from), z.string().parse(to));
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceAddLayerOption, (event, layer: unknown, option: unknown) => runIpc(async () =>
    {
        assertTrusted(event);
        await workspaceService.addLayerOption(z.string().parse(layer), z.string().parse(option));
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceRemoveLayerOption, (event, layer: unknown, option: unknown) => runIpc(async () =>
    {
        assertTrusted(event);
        await workspaceService.removeLayerOption(z.string().parse(layer), z.string().parse(option));
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceRenameLayerOption, (event, layer: unknown, from: unknown, to: unknown) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.renameLayerOption(z.string().parse(layer), z.string().parse(from), z.string().parse(to));
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceAddHarness, (event, harness: unknown) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.addHarness(HARNESS_SCHEMA.parse(harness));
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceRemoveHarness, (event, name: unknown) => runIpc(async () =>
    {
        assertTrusted(event);
        await workspaceService.removeHarness(z.string().parse(name));
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceUpdateHarness, (event, from: unknown, harness: unknown) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.updateHarness(z.string().parse(from), HARNESS_SCHEMA.parse(harness));
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceAddSkillSource, (event, input: unknown) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.addSkillSource(SKILL_SOURCE_INPUT_SCHEMA.parse(input));
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceRemoveSkillSource, (event, owner: unknown, name: unknown) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.removeSkillSource(z.string().parse(owner), z.string().parse(name));
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceDiscoverSkills, (event) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.discoverSkills();
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceInstallSkills, (event, ids: unknown) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.installSkills(SKILL_IDS_SCHEMA.parse(ids));
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceCheckSkillUpdates, (event) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.checkSkillUpdates();
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceApplySkillUpdates, (event, ids: unknown) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.applySkillUpdates(SKILL_IDS_SCHEMA.parse(ids));
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceListUserSkills, (event) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.listUserSkills();
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceImportUserSkills, (event, ids: unknown, overwrite: unknown) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.importUserSkills(SKILL_IDS_SCHEMA.parse(ids), z.boolean().parse(overwrite));
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceRemoveSkill, (event, id: unknown) => runIpc(async () =>
    {
        assertTrusted(event);
        await workspaceService.removeSkill(z.string().parse(id));
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceGenerate, (event, selection?: unknown) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.generate(LAYER_SELECTION_SCHEMA.parse(selection));
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceSetup, (event, selection?: unknown) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.setup(LAYER_SELECTION_SCHEMA.parse(selection));
    }));
}
