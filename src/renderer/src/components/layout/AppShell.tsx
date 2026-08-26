/**
 * Ant Design desktop chrome with horizontal navigation and workspace commands.
 */

import {
    AppstoreOutlined,
    BuildOutlined,
    CheckCircleOutlined,
    CloudServerOutlined,
    ExperimentOutlined,
    FileDoneOutlined,
    FileTextOutlined,
    HomeOutlined,
    RobotOutlined,
    RocketOutlined,
    SaveOutlined,
    SettingOutlined,
    ThunderboltOutlined,
} from "@ant-design/icons";
import { Badge, Button, Flex, Layout, Menu, Modal, Space, Spin, Tooltip, Typography, type MenuProps } from "antd";
import { useEffect, useState, type ReactNode } from "react";
import { useAppStore, visibleView, type AppView } from "@/stores/AppStore";

const { Header, Content } = Layout;

/** Navigation item shown in the app chrome sidebar. */
interface NavItem
{
    view: AppView;
    label: string;
    description: string;
    icon: ReactNode;
}

/** Primary workspace modules shown in the desktop sidebar. */
const WORKSPACE_NAV_ITEMS: readonly NavItem[] = [
    { view: "project", label: "Home", description: "Configure harnesses, layers, and skill sources.", icon: <HomeOutlined /> },
    { view: "rules", label: "Rules", description: "Edit repository and shared instructions.", icon: <FileTextOutlined /> },
    { view: "layers", label: "Layers", description: "Manage selectable instruction layers.", icon: <AppstoreOutlined /> },
    { view: "agents", label: "Agents", description: "Define reusable subagent profiles.", icon: <RobotOutlined /> },
    { view: "skills", label: "Skills", description: "Discover and manage project skills.", icon: <ThunderboltOutlined /> },
    { view: "generated", label: "Generated", description: "Inspect generated harness output.", icon: <FileDoneOutlined /> },
];

/** Props for the desktop chrome that wraps feature pages and owns header commands. */
export interface AppShellProps
{
    children: ReactNode;
    onSave: () => void;
    onGenerate: () => void;
    onCheck: () => void;
    onSetup: () => void;
}

/** Render the Ant Design application shell and top-level commands. */
export function AppShell({ children, onSave, onGenerate, onCheck, onSetup }: AppShellProps)
{
    const view = useAppStore((state) => state.view);
    const setView = useAppStore((state) => state.setView);
    const workspace = useAppStore((state) => state.workspace);
    const isBusy = useAppStore((state) => state.isBusy);
    const dirtyCount = useAppStore((state) => Object.keys(state.editorDrafts).length);
    const [version, setVersion] = useState("");
    const [isSetupOpen, setIsSetupOpen] = useState(false);
    const effectiveView = visibleView(view);
    const currentNav = WORKSPACE_NAV_ITEMS.find((item) => item.view === effectiveView);
    const pageTitle = currentNav?.label ?? (effectiveView === "settings" ? "Settings" : "Ant Design");
    const pageDescription = currentNav?.description ?? (effectiveView === "settings" ? "Desktop preferences and local paths." : "Official component showcase.");
    const pageIcon = currentNav?.icon ?? (effectiveView === "settings" ? <SettingOutlined /> : <ExperimentOutlined />);
    const primaryItems: MenuProps["items"] = WORKSPACE_NAV_ITEMS.map((item) => ({ key: item.view, icon: item.icon, label: item.label }));

    useEffect(() =>
    {
        void window.appApi.app.getVersion().then(setVersion).catch(() => setVersion(""));
    }, []);

    useEffect(() =>
    {
        if (visibleView(view) !== view) setView(visibleView(view));
    }, [view, setView]);

    /** Select one known application view from an Ant Design menu. */
    const handleMenuClick: MenuProps["onClick"] = ({ key }) => setView(key as AppView);

    return (
        <Layout className="app-shell">
            <Header className="app-topbar">
                <Flex align="center" gap={20} className="app-topbar-context">
                    <button type="button" className="app-brand" onClick={() => setView("project")}>
                        <span className="app-brand-mark">HA</span>
                        <span className="app-brand-copy">
                            <span className="app-brand-name">Harness Align</span>
                            <span className="app-brand-version">{version ? `Desktop ${version}` : "Desktop"}</span>
                        </span>
                    </button>
                    <span className="app-topbar-divider" />
                    <div className="app-workspace-identity">
                        <CloudServerOutlined />
                        <span className="app-workspace-copy">
                            <Typography.Text strong ellipsis>{workspace?.config.name ?? "Loading workspace"}</Typography.Text>
                            <Typography.Text type="secondary" ellipsis title={workspace?.root ?? ""}>{workspace ? `${workspace.root}\\.halign` : "Reading local configuration"}</Typography.Text>
                        </span>
                    </div>
                </Flex>
                <Flex align="center" gap={12} wrap={false}>
                    {isBusy ? <Space size={6}><Spin size="small" /><Typography.Text type="secondary">Working...</Typography.Text></Space> : dirtyCount > 0 ? <Badge status="processing" text={`${dirtyCount} unsaved`} /> : null}
                    <Tooltip title="Save all changes (Ctrl+S)">
                        <Button icon={<SaveOutlined />} disabled={!workspace || isBusy} aria-keyshortcuts="Control+S" onClick={onSave}>Save</Button>
                    </Tooltip>
                    <Space.Compact>
                        <Button icon={<CheckCircleOutlined />} disabled={!workspace || isBusy} onClick={onCheck}>Check</Button>
                        <Button type="primary" icon={<BuildOutlined />} disabled={!workspace || isBusy} onClick={onGenerate}>Generate</Button>
                        <Button icon={<RocketOutlined />} disabled={!workspace || isBusy} onClick={() => setIsSetupOpen(true)}>Setup</Button>
                    </Space.Compact>
                </Flex>
            </Header>
            <div className="app-navigation">
                <Menu mode="horizontal" selectedKeys={[effectiveView]} items={primaryItems} onClick={handleMenuClick} />
                <Space size={4}>
                    {import.meta.env.DEV ? (
                        <Button type={effectiveView === "showcase" ? "primary" : "text"} ghost={effectiveView === "showcase"} icon={<ExperimentOutlined />} onClick={() => setView("showcase")}>UI Kit</Button>
                    ) : null}
                    <Button type={effectiveView === "settings" ? "primary" : "text"} ghost={effectiveView === "settings"} icon={<SettingOutlined />} onClick={() => setView("settings")}>Settings</Button>
                </Space>
            </div>
            <section className="app-page-header">
                <span className="app-page-icon">{pageIcon}</span>
                <div className="app-page-heading">
                    <Typography.Title level={3}>{pageTitle}</Typography.Title>
                    <Typography.Text type="secondary">{pageDescription}</Typography.Text>
                </div>
            </section>
            <Content className="app-content" inert={isBusy} aria-busy={isBusy}>{children}</Content>
            <Modal
                open={isSetupOpen}
                title="Run Setup?"
                okText="Setup"
                confirmLoading={isBusy}
                onCancel={() => setIsSetupOpen(false)}
                onOk={() =>
                {
                    setIsSetupOpen(false);
                    onSetup();
                }}
            >
                <Typography.Paragraph>
                    Setup updates existing harness directories under USERPROFILE, shared-rules, and same-name skills. Other user skills are kept.
                </Typography.Paragraph>
            </Modal>
        </Layout>
    );
}
