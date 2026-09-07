/**
 * Ant Design desktop preferences page.
 */

import { DesktopOutlined, FileTextOutlined, InfoCircleOutlined } from "@ant-design/icons";
import type { ThemeMode } from "@shared/models/AppSettings";
import { Card, Col, Form, Row, Segmented, Space, Typography } from "antd";
import { useEffect, useState } from "react";
import { showError } from "@/components/common/Feedback";
import { AgentDocumentTitleForm } from "@/features/workspace/WorkspaceEditor";
import { useAppStore } from "@/stores/AppStore";

/** Theme choices rendered by the Ant Design select. */
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
    const [version, setVersion] = useState("");

    useEffect(() =>
    {
        void window.appApi.app.getVersion().then(setVersion).catch(() => setVersion(""));
    }, []);

    return (
        <div className="workspace-scroll">
            <div className="settings-page">
                <Row gutter={[16, 16]}>
                    <Col xs={24} lg={16}>
                        <Card title="Appearance" extra={<DesktopOutlined />} className="settings-card">
                            <Form layout="vertical" requiredMark={false}>
                                <Form.Item label="Theme" extra="System automatically follows the Windows light or dark setting.">
                                    <Segmented<ThemeMode>
                                        block
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
                                </Form.Item>
                            </Form>
                        </Card>
                    </Col>
                    <Col xs={24} lg={8}>
                        <Card title="About" extra={<InfoCircleOutlined />} className="settings-card">
                            <Space orientation="vertical" size={4}>
                                <Typography.Text strong>Harness Align Desktop</Typography.Text>
                                <Typography.Text type="secondary">Version</Typography.Text>
                                <Typography.Text code>{version || "-"}</Typography.Text>
                            </Space>
                        </Card>
                    </Col>
                    <Col xs={24} lg={12}>
                        <Card title="Generated instructions" extra={<FileTextOutlined />} className="settings-card">
                            {workspace ? <AgentDocumentTitleForm workspace={workspace} /> : <Typography.Text type="secondary">The user workspace is not loaded yet.</Typography.Text>}
                        </Card>
                    </Col>
                </Row>
            </div>
        </div>
    );
}
