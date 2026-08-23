/**
 * Desktop root: load the user workspace, route feature modules, and own command output notifications.
 * Renderer work stays on `window.appApi`.
 */

import { useEffect } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { AppOutput } from "@/components/layout/AppOutput";
import { SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { applyTheme, SettingsPage } from "@/features/settings/SettingsPage";
import { ShowcasePage } from "@/features/showcase/ShowcasePage";
import { WorkspacePage } from "@/features/workspace/WorkspacePage";
import { refreshWorkspace, runCommand, saveWorkspaceChanges } from "@/features/workspace/WorkspaceTasks";
import { useAppStore, visibleView, type WorkspaceView } from "@/stores/AppStore";

/** Root React tree for the desktop shell. */
export function App()
{
    const view = useAppStore((state) => state.view);
    const effectiveView = visibleView(view);

    useEffect(() =>
    {
        void (async () =>
        {
            const settings = await window.appApi.settings.get();
            useAppStore.getState().setTheme(settings.theme);
            applyTheme(settings.theme);
            const loaded = await window.appApi.workspace.load();
            useAppStore.getState().setWorkspace(loaded);
            useAppStore.getState().setSelection({ kind: "config" });
            useAppStore.getState().setOutput(`Loaded ${loaded.root}\\.halign`, "success", "Workspace loaded");
        })().catch((error: unknown) =>
        {
            const message = error instanceof Error ? error.message : String(error);
            useAppStore.getState().setOutput(message, "error", "Load failed");
        });
        return window.appApi.settings.onChanged((settings) =>
        {
            useAppStore.getState().setTheme(settings.theme);
            applyTheme(settings.theme);
        });
    }, []);

    useEffect(() =>
    {
        const media = window.matchMedia("(prefers-color-scheme: dark)");
        const sync = (): void =>
        {
            if (useAppStore.getState().theme === "system") applyTheme("system");
        };
        media.addEventListener("change", sync);
        return () => media.removeEventListener("change", sync);
    }, []);

    /** Save every retained workspace change from the header. */
    const handleSave = (): void => void saveWorkspaceChanges();

    useEffect(() =>
    {
        const handleKeyDown = (event: KeyboardEvent): void =>
        {
            if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.key.toLowerCase() !== "s") return;
            event.preventDefault();
            void saveWorkspaceChanges();
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, []);

    /** Generate outputs for the current ordered layer selection. */
    const handleGenerate = (): void =>
    {
        const current = useAppStore.getState().workspace;
        if (!current) return;
        void runCommand(async () =>
        {
            const report = await window.appApi.workspace.generate(useAppStore.getState().layerSelection);
            useAppStore.getState().setOutput(report, "success", "Generate completed");
            await refreshWorkspace();
            useAppStore.getState().setView("generated");
        });
    };

    /** Check generated output against the current sources. */
    const handleCheck = (): void =>
    {
        const current = useAppStore.getState().workspace;
        if (!current) return;
        void runCommand(async () =>
        {
            const differences = await window.appApi.workspace.check(useAppStore.getState().layerSelection);
            if (differences.length === 0)
            {
                useAppStore.getState().setOutput("Check passed. Generated output is up to date.", "success", "Check passed");
            }
            else
            {
                useAppStore.getState().setOutput(`Check failed:\n${differences.join("\n")}`, "error", "Check failed");
            }
        });
    };

    /** Deploy generated output to existing harness directories. */
    const handleSetup = (): void =>
    {
        const current = useAppStore.getState().workspace;
        if (!current) return;
        void runCommand(async () =>
        {
            const report = await window.appApi.workspace.setup(useAppStore.getState().layerSelection);
            useAppStore.getState().setOutput(report, "success", "Setup completed");
            await refreshWorkspace();
        });
    };

    /** Render the active feature page. */
    const page = effectiveView === "settings"
        ? <SettingsPage />
        : import.meta.env.DEV && effectiveView === "showcase"
            ? <ShowcasePage />
            : <WorkspacePage view={effectiveView as WorkspaceView} />;

    return (
        <Toaster>
            <TooltipProvider>
                <SidebarProvider open={false} className="h-full min-h-0">
                    <AppShell onSave={handleSave} onGenerate={handleGenerate} onCheck={handleCheck} onSetup={handleSetup}>
                        <div className="min-h-0 flex-1 overflow-hidden">{page}</div>
                    </AppShell>
                    <AppOutput />
                </SidebarProvider>
            </TooltipProvider>
        </Toaster>
    );
}
