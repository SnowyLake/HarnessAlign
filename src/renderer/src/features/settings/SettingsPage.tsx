/**
 * Ant Design desktop preferences and workspace location page.
 */

import { DesktopOutlined, FolderOpenOutlined, InfoCircleOutlined } from "@ant-design/icons";
import type { ThemeMode } from "@shared/models/AppSettings";
import { Button, Card, Col, Form, Input, Row, Segmented, Space, Typography } from "antd";
import { useEffect, useState } from "react";
import { showError, showSuccess } from "@/components/common/Feedback";
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

/** Render desktop appearance and local workspace information. */
export function SettingsPage()
{
    const theme = useAppStore((state) => state.theme);
    const setTheme = useAppStore((state) => state.setTheme);
    const workspaceRoot = useAppStore((state) => state.workspace?.root);
    const [version, setVersion] = useState("");
    const [isOpening, setIsOpening] = useState(false);
    const configDirectory = workspaceRoot ? `${workspaceRoot}\\.halign` : "%USERPROFILE%\\.halign";

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
                            <Typography.Paragraph type="secondary">Choose how Harness Align follows your desktop appearance.</Typography.Paragraph>
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
                                                showSuccess("Theme saved");
                                            }).catch((error: unknown) => showError(error instanceof Error ? error.message : String(error)));
                                        }}
                                    />
                                </Form.Item>
                            </Form>
                        </Card>
                    </Col>
                    <Col xs={24} lg={8}>
                        <Card title="About" extra={<InfoCircleOutlined />} className="settings-card">
                            <Space direction="vertical" size={4}>
                                <Typography.Text strong>Harness Align Desktop</Typography.Text>
                                <Typography.Text type="secondary">Version</Typography.Text>
                                <Typography.Text code>{version || "-"}</Typography.Text>
                            </Space>
                        </Card>
                    </Col>
                    <Col span={24}>
                        <Card title="Workspace" extra={<FolderOpenOutlined />}>
                            <Typography.Paragraph type="secondary">Harness Align reads and writes validated configuration in this local directory.</Typography.Paragraph>
                            <Form layout="vertical" requiredMark={false}>
                                <Form.Item label="Config directory">
                            <Space.Compact block>
                                <Input value={configDirectory} readOnly />
                                <Button
                                    icon={<FolderOpenOutlined />}
                                    loading={isOpening}
                                    onClick={() =>
                                    {
                                        setIsOpening(true);
                                        void window.appApi.app.openConfigDirectory().catch((error: unknown) =>
                                        {
                                            showError(error instanceof Error ? error.message : String(error));
                                        }).finally(() => setIsOpening(false));
                                    }}
                                >
                                    Open
                                </Button>
                            </Space.Compact>
                                </Form.Item>
                            </Form>
                        </Card>
                    </Col>
                </Row>
            </div>
        </div>
    );
}
