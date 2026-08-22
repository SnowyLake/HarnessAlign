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
    workspaceSaveLayerOption: "workspace:save-layer-option",
    workspaceSaveSharedRule: "workspace:save-shared-rule",
    workspaceSaveAgent: "workspace:save-agent",
    workspaceDeleteSource: "workspace:delete-source",
    workspaceAddLayer: "workspace:add-layer",
    workspaceRemoveLayer: "workspace:remove-layer",
    workspaceRenameLayer: "workspace:rename-layer",
    workspaceAddLayerOption: "workspace:add-layer-option",
    workspaceRemoveLayerOption: "workspace:remove-layer-option",
    workspaceRenameLayerOption: "workspace:rename-layer-option",
    workspaceAddHarness: "workspace:add-harness",
    workspaceRemoveHarness: "workspace:remove-harness",
    workspaceRenameHarness: "workspace:rename-harness",
    workspaceAddSkillSource: "workspace:add-skill-source",
    workspaceRemoveSkillSource: "workspace:remove-skill-source",
    workspaceDiscoverSkills: "workspace:discover-skills",
    workspaceInstallSkills: "workspace:install-skills",
    workspaceCheckSkillUpdates: "workspace:check-skill-updates",
    workspaceApplySkillUpdates: "workspace:apply-skill-updates",
    workspaceListUserSkills: "workspace:list-user-skills",
    workspaceImportUserSkills: "workspace:import-user-skills",
    workspaceRemoveSkill: "workspace:remove-skill",
    workspaceGenerate: "workspace:generate",
    workspaceCheck: "workspace:check",
    workspaceSetup: "workspace:setup",
} as const;

/** Literal union of IPC channel strings. */
export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
