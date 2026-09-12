/**
 * Desktop root: load the user workspace and route feature modules through unified operation feedback.
 * Renderer work stays on `window.appApi`.
 */

import { App as AntApp, Button, ConfigProvider, Result, Spin, theme as antTheme } from "antd";
import { useEffect, useState } from "react";
import { FeedbackBridge, showError, showSuccess, writeLog } from "@/components/common/Feedback";
import { AppShell } from "@/components/layout/AppShell";
import { ConsolePage } from "@/features/console/ConsolePage";
import { applyTheme, SettingsPage } from "@/features/settings/SettingsPage";
import { WorkspacePage } from "@/features/workspace/WorkspacePage";
import { refreshWorkspace, runCommand, saveWorkspaceChanges } from "@/features/workspace/WorkspaceTasks";
import { useAppStore, workspaceChangeCount } from "@/stores/AppStore";

/** Root React tree for the desktop shell. */
export function App()
{
    const view = useAppStore((state) => state.view);
    const themeMode = useAppStore((state) => state.theme);
    const workspace = useAppStore((state) => state.workspace);
    const [loadError, setLoadError] = useState<string>();
    const [loadAttempt, setLoadAttempt] = useState(0);
    const [prefersDark, setPrefersDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
    const isDark = themeMode === "dark" || (themeMode === "system" && prefersDark);

    useEffect(() =>
    {
        let isCancelled = false;
        setLoadError(undefined);
        void (async () =>
        {
            const settings = await window.appApi.settings.get();
            if (isCancelled) return;
            useAppStore.getState().setTheme(settings.theme);
            applyTheme(settings.theme);
            const loaded = await window.appApi.workspace.load();
            if (isCancelled) return;
            useAppStore.getState().setWorkspace(loaded);
            writeLog("info", "Workspace loaded");
        })().catch((error: unknown) =>
        {
            if (!isCancelled)
            {
                setLoadError("See Console for details.");
                showError(error, "Workspace load failed");
            }
        });
        const unsubscribe = window.appApi.settings.onChanged((settings) =>
        {
            useAppStore.getState().setTheme(settings.theme);
            applyTheme(settings.theme);
        });
        return () =>
        {
            isCancelled = true;
            unsubscribe();
        };
    }, [loadAttempt]);

    useEffect(() =>
    {
        /** Ask the desktop shell to protect unsaved drafts when closing or reloading. */
        const handleBeforeUnload = (event: BeforeUnloadEvent): void =>
        {
            if (workspaceChangeCount(useAppStore.getState()) === 0) return;
            event.preventDefault();
            event.returnValue = "";
        };
        window.addEventListener("beforeunload", handleBeforeUnload);
        return () => window.removeEventListener("beforeunload", handleBeforeUnload);
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
        /** Persist retained drafts using the standard desktop save shortcut. */
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
        if (!current || Object.keys(useAppStore.getState().editorDrafts).length > 0) return;
        void runCommand(async () =>
        {
            const report = await window.appApi.workspace.generate(useAppStore.getState().layerSelection);
            showSuccess("Generate completed", report);
            await refreshWorkspace();
            if (useAppStore.getState().view !== "console") useAppStore.getState().setView("generated");
        }, "Generate");
    };

    /** Deploy generated output to existing harness directories. */
    const handleSetup = (): void =>
    {
        const current = useAppStore.getState().workspace;
        if (!current || Object.keys(useAppStore.getState().editorDrafts).length > 0) return;
        void runCommand(async () =>
        {
            const report = await window.appApi.workspace.setup(useAppStore.getState().layerSelection);
            showSuccess("Setup completed", report);
            await refreshWorkspace();
        }, "Setup");
    };

    /** Render the active feature page. */
    const page = view === "console"
        ? <ConsolePage />
        : view === "settings"
            ? <SettingsPage />
            : <WorkspacePage view={view} />;

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
                    borderRadius: 8,
                    controlHeight: 36,
                    fontFamily: '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif',
                },
                components: {
                    Button: { primaryShadow: "0 2px 0 rgba(5, 145, 255, 0.1)" },
                    Form: { itemMarginBottom: 20 },
                    Layout: {
                        bodyBg: isDark ? "#0d0f12" : "#f4f6f8",
                        headerBg: isDark ? "#17191d" : "#ffffff",
                        lightSiderBg: isDark ? "#17191d" : "#ffffff",
                    },
                    Menu: {
                        activeBarBorderWidth: 0,
                        itemBg: "transparent",
                        itemMarginInline: 0,
                        itemHeight: 40,
                        itemBorderRadius: 8,
                        itemSelectedBg: isDark ? "#172b4d" : "#e6f4ff",
                    },
                    Statistic: { contentFontSize: 22 },
                },
            }}
        >
            <AntApp className="app-root">
                <FeedbackBridge />
                <AppShell onSave={handleSave} onGenerate={handleGenerate} onSetup={handleSetup}>
                    {workspace || view === "console" ? page : (
                        <div className="workspace-load-state">
                            {loadError ? <Result status="error" title="Unable to load workspace" subTitle={loadError}
                                extra={<Button type="primary" onClick={() => setLoadAttempt((current) => current + 1)}>Retry</Button>} /> : <Spin size="large" aria-label="Loading workspace" />}
                        </div>
                    )}
                </AppShell>
            </AntApp>
        </ConfigProvider>
    );
}
