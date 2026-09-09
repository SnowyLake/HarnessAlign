/**
 * Ant Design desktop preferences page.
 */

import { DesktopOutlined, FileTextOutlined, GithubOutlined } from "@ant-design/icons";
import type { ThemeMode } from "@shared/models/AppSettings";
import { Button, Card, Flex, Segmented, Space, Typography } from "antd";
import { useEffect, useState } from "react";
import { showError } from "@/components/common/Feedback";
import { AgentDocumentTitleForm } from "@/features/workspace/WorkspaceEditor";
import { useAppStore } from "@/stores/AppStore";

/** Theme choices rendered by the Ant Design segmented control. */
const THEME_ITEMS: readonly { label: string; value: ThemeMode }[] = [
    { label: "System", value: "system" },
    { label: "Light", value: "light" },
    { label: "Dark", value: "dark" },
];

/** Apply the current theme class on `document.documentElement`. */
export function applyTheme(theme: ThemeMode): void
{
    const isDark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", isDark);
}

/** Render desktop appearance and generated document preferences. */
export function SettingsPage()
{
    const theme = useAppStore((state) => state.theme);
    const setTheme = useAppStore((state) => state.setTheme);
    const workspace = useAppStore((state) => state.workspace);
    const syncStatus = useAppStore((state) => state.syncStatus);
    const setSyncDialog = useAppStore((state) => state.setSyncDialog);
    const [version, setVersion] = useState("");

    useEffect(() =>
    {
        void window.appApi.app.getVersion().then(setVersion).catch(() => setVersion(""));
    }, []);

    return (
        <div className="workspace-scroll">
            <div className="settings-page">
                <Typography.Title level={3} className="page-title">Settings</Typography.Title>
                <Card title={<Space><DesktopOutlined />Appearance</Space>}>
                    <Flex align="center" justify="space-between" gap={24} wrap>
                        <Typography.Text>Theme</Typography.Text>
                        <Segmented<ThemeMode>
                            aria-label="Theme"
                            value={theme}
                            options={[...THEME_ITEMS]}
                            onChange={(next) =>
                            {
                                void window.appApi.settings.update({ theme: next }).then((settings) =>
                                {
                                    setTheme(settings.theme);
                                    applyTheme(settings.theme);
                                }).catch((error: unknown) => showError(error instanceof Error ? error.message : String(error)));
                            }}
                        />
                    </Flex>
                </Card>
                <Card title={<Space><FileTextOutlined />Generated instructions</Space>}>
                    {workspace ? <AgentDocumentTitleForm workspace={workspace} /> : <Typography.Text type="secondary">The user workspace is not loaded yet.</Typography.Text>}
                </Card>
                <Card title={<Space><GithubOutlined />GitHub connection</Space>}>
                    <Flex align="center" justify="space-between" gap={24} wrap>
                        <Space orientation="vertical" size={4} style={{ minWidth: 0, flex: "1 1 280px" }}>
                            <Typography.Text strong style={{ overflowWrap: "anywhere" }}>
                                {syncStatus?.connected ? `${syncStatus.owner}/${syncStatus.repository}` : "No repository connected"}
                            </Typography.Text>
                            <Typography.Text type="secondary">
                                {syncStatus?.connected ? `Branch: ${syncStatus.branch} · Last synced: ${syncStatus.lastSyncedAt ? new Date(syncStatus.lastSyncedAt).toLocaleString() : "Not yet"}`
                                    : "Connect a private repository to sync configuration across devices."}
                            </Typography.Text>
                        </Space>
                        <Button onClick={() => setSyncDialog("connection")}>{syncStatus?.connected ? "Manage connection" : "Connect GitHub"}</Button>
                    </Flex>
                </Card>
                <Typography.Text type="secondary" className="settings-about">Harness Align {version}</Typography.Text>
            </div>
        </div>
    );
}
