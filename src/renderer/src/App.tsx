/**
 * Desktop root: restore last workspace from Main settings, then route feature pages.
 * Renderer work stays on `window.appApi`.
 */

import { AppShell, Toolbar } from "@/components/layout/AppShell";
import { SettingsPage, applyTheme } from "@/features/settings/SettingsPage";
import { ShowcasePage } from "@/features/showcase/ShowcasePage";
import { WorkspacePage, refreshWorkspace } from "@/features/workspace/WorkspacePage";
import { useAppStore } from "@/stores/AppStore";
import { useEffect } from "react";

/** Root React tree for the desktop shell. */
export function App()
{
    const view = useAppStore((state) => state.view);

    useEffect(() =>
    {
        void (async () =>
        {
            const settings = await window.appApi.settings.get();
            useAppStore.getState().setTheme(settings.theme);
            applyTheme(settings.theme);
            if (settings.lastWorkspaceRoot)
            {
                try
                {
                    const workspace = await window.appApi.workspace.load(settings.lastWorkspaceRoot);
                    useAppStore.getState().setWorkspace(workspace);
                    useAppStore.getState().setProfile(workspace.config.defaultProfile);
                    useAppStore.getState().setLog(`Opened ${workspace.root}`);
                }
                catch (error)
                {
                    useAppStore.getState().setLog(error instanceof Error ? error.message : String(error));
                }
            }
        })().catch((error: unknown) =>
        {
            useAppStore.getState().setLog(error instanceof Error ? error.message : String(error));
        });
        return window.appApi.settings.onChanged((settings) =>
        {
            useAppStore.getState().setTheme(settings.theme);
            applyTheme(settings.theme);
        });
    }, []);

    /** Run toolbar work while holding the busy flag and logging thrown errors. */
    const run = async (work: () => Promise<void>): Promise<void> =>
    {
        useAppStore.getState().setIsBusy(true);
        try
        {
            await work();
        }
        catch (error)
        {
            useAppStore.getState().setLog(error instanceof Error ? error.message : String(error));
        }
        finally
        {
            useAppStore.getState().setIsBusy(false);
        }
    };

    return (
        <AppShell>
            <Toolbar
                onOpen={() =>
                {
                    void run(async () =>
                    {
                        const root = await window.appApi.workspace.openDirectory();
                        if (!root) return;
                        const workspace = await window.appApi.workspace.load(root);
                        useAppStore.getState().setWorkspace(workspace);
                        useAppStore.getState().setProfile(workspace.config.defaultProfile);
                        useAppStore.getState().setSelection({ kind: "settings" });
                        useAppStore.getState().setLog(`Opened ${workspace.root}`);
                    });
                }}
                onGenerate={() =>
                {
                    const workspace = useAppStore.getState().workspace;
                    if (!workspace) return;
                    void run(async () =>
                    {
                        const report = await window.appApi.workspace.generate(workspace.root, useAppStore.getState().profile);
                        useAppStore.getState().setLog(report);
                        await refreshWorkspace();
                    });
                }}
                onCheck={() =>
                {
                    const workspace = useAppStore.getState().workspace;
                    if (!workspace) return;
                    void run(async () =>
                    {
                        const differences = await window.appApi.workspace.check(workspace.root, useAppStore.getState().profile);
                        useAppStore.getState().setLog(differences.length === 0 ? "Check passed. Generated output is up to date." : `Check failed:\n${differences.join("\n")}`);
                    });
                }}
                onSetup={() =>
                {
                    const workspace = useAppStore.getState().workspace;
                    if (!workspace) return;
                    if (!window.confirm("Setup updates existing harness directories under USERPROFILE and shared-rules. Continue?")) return;
                    void run(async () =>
                    {
                        const report = await window.appApi.workspace.setup(workspace.root, useAppStore.getState().profile);
                        useAppStore.getState().setLog(report);
                        await refreshWorkspace();
                    });
                }}
            />
            {view === "workspace" ? <WorkspacePage /> : null}
            {view === "settings" ? <SettingsPage /> : null}
            {view === "showcase" ? <ShowcasePage /> : null}
        </AppShell>
    );
}
