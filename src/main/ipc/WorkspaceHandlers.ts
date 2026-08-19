/**
 * Workspace IPC handlers. Every path and payload is validated in Main before touching the engine.
 */

import { dialog, ipcMain, type IpcMainInvokeEvent } from "electron";
import { IPC_CHANNELS } from "../../shared/contracts/IpcChannels.js";
import type { Agent, Config, HarnessConfig, LayerOptionInput, LayerSelection, RuleInput } from "../../shared/models/Workspace.js";
import { settingsService } from "../services/SettingsService.js";
import { workspaceService } from "../services/WorkspaceService.js";
import { fail, runIpc } from "../utils/Ipc.js";
import { isTrustedSender } from "../windows/MainWindow.js";

/** Reject IPC from any WebContents other than the main window. */
function assertTrusted(event: IpcMainInvokeEvent): void
{
    if (!isTrustedSender(event.sender)) fail(new Error("Invalid IPC sender"));
}

/** Register workspace IPC handlers. */
export function registerWorkspaceHandlers(): void
{
    ipcMain.handle(IPC_CHANNELS.workspaceOpenDirectory, async (event) =>
    {
        assertTrusted(event);
        const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
        if (result.canceled) return undefined;
        return result.filePaths[0];
    });

    ipcMain.handle(IPC_CHANNELS.workspaceLoad, (event, root: string) => runIpc(async () =>
    {
        assertTrusted(event);
        const workspace = await workspaceService.load(root);
        await settingsService.update({ lastWorkspaceRoot: workspace.root });
        return workspace;
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceSaveConfig, (event, root: string, config: Config) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.saveConfig(root, config);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceSaveRule, (event, root: string, input: RuleInput) => runIpc(async () =>
    {
        assertTrusted(event);
        await workspaceService.saveRule(root, input);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceSaveLayerOption, (event, root: string, input: LayerOptionInput) => runIpc(async () =>
    {
        assertTrusted(event);
        await workspaceService.saveLayerOption(root, input);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceSaveSharedRule, (event, root: string, path: string, body: string) => runIpc(async () =>
    {
        assertTrusted(event);
        await workspaceService.saveSharedRule(root, path, body);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceSaveAgent, (event, root: string, agent: Agent) => runIpc(async () =>
    {
        assertTrusted(event);
        await workspaceService.saveAgent(root, agent);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceDeleteSource, (event, root: string, path: string) => runIpc(async () =>
    {
        assertTrusted(event);
        await workspaceService.deleteSource(root, path);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceAddLayer, (event, root: string, name: string, initialOption: string) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.addLayer(root, name, initialOption);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceRemoveLayer, (event, root: string, name: string) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.removeLayer(root, name);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceRenameLayer, (event, root: string, from: string, to: string) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.renameLayer(root, from, to);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceAddLayerOption, (event, root: string, layer: string, option: string) => runIpc(async () =>
    {
        assertTrusted(event);
        await workspaceService.addLayerOption(root, layer, option);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceRemoveLayerOption, (event, root: string, layer: string, option: string) => runIpc(async () =>
    {
        assertTrusted(event);
        await workspaceService.removeLayerOption(root, layer, option);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceRenameLayerOption, (event, root: string, layer: string, from: string, to: string) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.renameLayerOption(root, layer, from, to);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceAddHarness, (event, root: string, harness: HarnessConfig) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.addHarness(root, harness);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceRemoveHarness, (event, root: string, name: string) => runIpc(async () =>
    {
        assertTrusted(event);
        await workspaceService.removeHarness(root, name);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceRenameHarness, (event, root: string, from: string, to: string) => runIpc(async () =>
    {
        assertTrusted(event);
        await workspaceService.renameHarness(root, from, to);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceGenerate, (event, root: string, selection?: LayerSelection[]) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.generate(root, selection);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceCheck, (event, root: string, selection?: LayerSelection[]) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.check(root, selection);
    }));

    ipcMain.handle(IPC_CHANNELS.workspaceSetup, (event, root: string, selection?: LayerSelection[]) => runIpc(async () =>
    {
        assertTrusted(event);
        return workspaceService.setup(root, selection);
    }));
}
