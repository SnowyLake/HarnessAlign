/**
 * Desktop root: load the user workspace, route feature modules, and own command output notifications.
 * Renderer work stays on `window.appApi`.
 */

import { App as AntApp, ConfigProvider, theme as antTheme } from "antd";
import { useEffect, useState } from "react";
import { FeedbackBridge } from "@/components/common/Feedback";
import { AppShell } from "@/components/layout/AppShell";
import { AppOutput } from "@/components/layout/AppOutput";
import { applyTheme, SettingsPage } from "@/features/settings/SettingsPage";
import { ShowcasePage } from "@/features/showcase/ShowcasePage";
import { WorkspacePage } from "@/features/workspace/WorkspacePage";
import { refreshWorkspace, runCommand, saveWorkspaceChanges } from "@/features/workspace/WorkspaceTasks";
import { useAppStore, type WorkspaceView } from "@/stores/AppStore";

/** Root React tree for the desktop shell. */
export function App()
{
    const view = useAppStore((state) => state.view);
    const themeMode = useAppStore((state) => state.theme);
    const [prefersDark, setPrefersDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
    const isDark = themeMode === "dark" || (themeMode === "system" && prefersDark);

    useEffect(() =>
    {
        void (async () =>
        {
            const settings = await window.appApi.settings.get();
            useAppStore.getState().setTheme(settings.theme);
            applyTheme(settings.theme);
            const loaded = await window.appApi.workspace.load();
            useAppStore.getState().setWorkspace(loaded);
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
        /** Synchronize the current system theme with Ant Design. */
        const sync = (): void =>
        {
            setPrefersDark(media.matches);
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
    const page = view === "settings"
        ? <SettingsPage />
        : import.meta.env.DEV && view === "showcase"
            ? <ShowcasePage />
            : <WorkspacePage view={view as WorkspaceView} />;

    return (
        <ConfigProvider
            componentSize="middle"
            theme={{
                cssVar: { key: "harness-align" },
                algorithm: isDark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
                token: {
                    colorPrimary: isDark ? "#4096ff" : "#1677ff",
                    colorInfo: isDark ? "#4096ff" : "#1677ff",
                    colorBgLayout: isDark ? "#0d0f12" : "#f4f6f8",
                    colorBgContainer: isDark ? "#17191d" : "#ffffff",
                    colorText: isDark ? "#f2f3f5" : "#1f2329",
                    colorTextSecondary: isDark ? "#a6aab2" : "#646a73",
                    colorBorder: isDark ? "#3a3e46" : "#d9dce1",
                    colorBorderSecondary: isDark ? "#2b2e34" : "#e7e9ec",
                    controlItemBgHover: isDark ? "#202329" : "#f5f7fa",
                    controlItemBgActive: isDark ? "#172b4d" : "#e6f4ff",
                    borderRadius: 10,
                    controlHeight: 38,
                    fontFamily: '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif',
                },
                components: {
                    Button: { primaryShadow: "0 2px 0 rgba(5, 145, 255, 0.1)" },
                    Card: { boxShadowTertiary: "0 1px 2px rgba(0, 0, 0, 0.03)" },
                    Layout: {
                        bodyBg: isDark ? "#0d0f12" : "#f4f6f8",
                        headerBg: isDark ? "#17191d" : "#ffffff",
                        lightSiderBg: isDark ? "#17191d" : "#ffffff",
                    },
                    Menu: {
                        activeBarBorderWidth: 0,
                        itemBg: "transparent",
                        itemMarginInline: 0,
                        itemSelectedBg: isDark ? "#172b4d" : "#e6f4ff",
                    },
                    Statistic: { contentFontSize: 22 },
                },
            }}
        >
            <AntApp className="app-root">
                <FeedbackBridge />
                <AppShell onSave={handleSave} onGenerate={handleGenerate} onCheck={handleCheck} onSetup={handleSetup}>
                    {page}
                </AppShell>
                <AppOutput />
            </AntApp>
        </ConfigProvider>
    );
}
