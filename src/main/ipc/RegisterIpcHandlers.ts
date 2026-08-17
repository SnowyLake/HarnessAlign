/**
 * Register Main IPC handlers for app, settings, and workspace capabilities.
 */

import { registerAppHandlers } from "./AppHandlers.js";
import { registerSettingsHandlers } from "./SettingsHandlers.js";
import { registerWorkspaceHandlers } from "./WorkspaceHandlers.js";

/** Register every privileged IPC handler for the main window. */
export function registerIpcHandlers(): void
{
    registerAppHandlers();
    registerSettingsHandlers();
    registerWorkspaceHandlers();
}
