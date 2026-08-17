/**
 * IPC channel literals shared by Main and preload.
 * Renderer never sees these strings; it only calls `window.appApi`.
 */

/** Channel names for the typed Main / Preload IPC contract. */
export const IPC_CHANNELS = {
    appGetVersion: "app:get-version",
    appOpenExternal: "app:open-external",
    settingsGet: "settings:get",
    settingsUpdate: "settings:update",
    settingsChanged: "settings:changed",
    workspaceOpenDirectory: "workspace:open-directory",
    workspaceLoad: "workspace:load",
    workspaceSaveConfig: "workspace:save-config",
    workspaceSaveRule: "workspace:save-rule",
    workspaceSaveSharedRule: "workspace:save-shared-rule",
    workspaceSaveAgent: "workspace:save-agent",
    workspaceDeleteSource: "workspace:delete-source",
    workspaceAddProfile: "workspace:add-profile",
    workspaceRemoveProfile: "workspace:remove-profile",
    workspaceAddHarness: "workspace:add-harness",
    workspaceRemoveHarness: "workspace:remove-harness",
    workspaceRenameHarness: "workspace:rename-harness",
    workspaceGenerate: "workspace:generate",
    workspaceCheck: "workspace:check",
    workspaceSetup: "workspace:setup",
} as const;

/** Literal union of IPC channel strings. */
export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
