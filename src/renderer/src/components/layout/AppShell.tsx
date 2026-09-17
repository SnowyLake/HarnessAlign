/**
 * Ant Design desktop chrome with sidebar navigation and workspace commands.
 */

import {
    BuildOutlined,
    CodeOutlined,
    DeploymentUnitOutlined,
    FileDoneOutlined,
    FileTextOutlined,
    RobotOutlined,
    ReloadOutlined,
    RocketOutlined,
    SaveOutlined,
    SettingOutlined,
    SyncOutlined,
    ThunderboltOutlined,
} from "@ant-design/icons";
import { Badge, Button, Flex, Layout, Menu, Modal, Space, Spin, Tooltip, Typography, type MenuProps } from "antd";
import { useState, type ReactNode } from "react";
import appIcon from "../../../../../build/icon.png";
import { useAppStore, workspaceChangeCount, type AppView, type WorkspaceView } from "@/stores/AppStore";
import { SyncPanel } from "@/features/settings/SyncPanel";

const { Header, Sider, Content } = Layout;

/** Navigation item shown in the app chrome sidebar. */
interface NavItem
{
    label: string;
    icon: ReactNode;
}

/** Primary workspace modules shown in the desktop sidebar. */
const WORKSPACE_NAV_ITEMS: Readonly<Record<Exclude<WorkspaceView, "shared-rules">, NavItem>> = {
    project: { label: "Harnesses", icon: <DeploymentUnitOutlined /> },
    rules: { label: "Rules", icon: <FileTextOutlined /> },
    layers: { label: "Layers", icon: <BuildOutlined /> },
    agents: { label: "Agents", icon: <RobotOutlined /> },
    generated: { label: "Generated", icon: <FileDoneOutlined /> },
    skills: { label: "Skills", icon: <ThunderboltOutlined /> },
};

/** Props for the desktop chrome that wraps feature pages and owns header commands. */
export interface AppShellProps
{
    children: ReactNode;
    onSave: () => void;
    onReload: () => void;
    onGenerate: () => void;
    onSetup: () => void;
}

/** Render the Ant Design application shell and top-level commands. */
export function AppShell({ children, onSave, onReload, onGenerate, onSetup }: AppShellProps)
{
    const view = useAppStore((state) => state.view);
    const setView = useAppStore((state) => state.setView);
    const workspace = useAppStore((state) => state.workspace);
    const isBusy = useAppStore((state) => state.isBusy);
    const hasSourceDrafts = useAppStore((state) => Object.keys(state.editorDrafts).length > 0);
    const setSyncDialog = useAppStore((state) => state.setSyncDialog);
    const dirtyCount = useAppStore(workspaceChangeCount);
    const [isSetupOpen, setIsSetupOpen] = useState(false);
    const [isReloadOpen, setIsReloadOpen] = useState(false);
    const navigationView = view === "shared-rules" ? "rules" : view;
    const currentNav = navigationView === "settings" || navigationView === "console" ? undefined : WORKSPACE_NAV_ITEMS[navigationView];
    const pageLabel = currentNav?.label ?? (view === "console" ? "Console" : "Settings");
    const primaryItems: MenuProps["items"] = [
        { key: "project", icon: WORKSPACE_NAV_ITEMS.project.icon, label: WORKSPACE_NAV_ITEMS.project.label },
        { key: "rules", icon: WORKSPACE_NAV_ITEMS.rules.icon, label: WORKSPACE_NAV_ITEMS.rules.label },
        { key: "layers", icon: WORKSPACE_NAV_ITEMS.layers.icon, label: WORKSPACE_NAV_ITEMS.layers.label },
        { key: "agents", icon: WORKSPACE_NAV_ITEMS.agents.icon, label: WORKSPACE_NAV_ITEMS.agents.label },
        { key: "skills", icon: WORKSPACE_NAV_ITEMS.skills.icon, label: WORKSPACE_NAV_ITEMS.skills.label },
    ];
    const utilityItems: MenuProps["items"] = [
        { key: "generated", icon: WORKSPACE_NAV_ITEMS.generated.icon, label: WORKSPACE_NAV_ITEMS.generated.label },
        { key: "console", icon: <CodeOutlined />, label: "Console" },
        { key: "settings", icon: <SettingOutlined />, label: "Settings" },
    ];

    /** Select one known application view from an Ant Design menu. */
    const handleMenuClick: MenuProps["onClick"] = ({ key }) =>
    {
        if (key !== navigationView) setView(key as AppView);
    };

    /** Confirm discarding every workspace draft before reading local files. */
    const handleReload = (): void =>
    {
        const state = useAppStore.getState();
        if (!state.workspace || state.isBusy) return;
        if (workspaceChangeCount(state) > 0) setIsReloadOpen(true);
        else onReload();
    };

    return (
        <Layout className="app-shell">
            <Header className="app-topbar">
                <Flex align="center" gap={20} className="app-topbar-context">
                    <button type="button" className="app-brand" onClick={() => setView("project")}>
                        <img className="app-brand-mark" src={appIcon} alt="" width={36} height={36} />
                        <span className="app-brand-name">Harness Align</span>
                    </button>
                </Flex>
                <Flex align="center" gap={12} wrap={false}>
                    <span className="app-command-status" role="status">
                        {isBusy ? <Space size={8}><Spin size="small" /><Typography.Text type="secondary">Working...</Typography.Text></Space>
                            : dirtyCount > 0 ? <Badge status="warning" text={`${dirtyCount} unsaved`} /> : null}
                    </span>
                    <Tooltip title="Save all changes (Ctrl+S)">
                        <Button icon={<SaveOutlined />} disabled={!workspace || isBusy || dirtyCount === 0}
                                aria-label="Save all changes" aria-keyshortcuts="Control+S" onClick={onSave}>Save all</Button>
                    </Tooltip>
                    <Tooltip title="Reload local files">
                        <Button icon={<ReloadOutlined />} disabled={!workspace || isBusy || isReloadOpen}
                                aria-label="Reload local files" onClick={handleReload}>Reload</Button>
                    </Tooltip>
                    <Tooltip title={dirtyCount > 0 ? "Save all changes before syncing" : "Preview and sync configuration"}>
                        <Button icon={<SyncOutlined />} disabled={!workspace || isBusy || dirtyCount > 0}
                                aria-label="Sync configuration" onClick={() => setSyncDialog("review")}>Sync</Button>
                    </Tooltip>
                    <Space.Compact>
                        <Tooltip title={hasSourceDrafts ? "Save source changes before generating" : "Generate"}>
                            <Button icon={<BuildOutlined />} disabled={!workspace || isBusy || hasSourceDrafts} aria-label="Generate" onClick={onGenerate}>Generate</Button>
                        </Tooltip>
                        <Tooltip title={hasSourceDrafts ? "Save source changes before deploying" : "Deploy to existing harnesses"}>
                            <Button type="primary" icon={<RocketOutlined />} disabled={!workspace || isBusy || hasSourceDrafts}
                                    aria-label="Setup" onClick={() => setIsSetupOpen(true)}>Setup</Button>
                        </Tooltip>
                    </Space.Compact>
                </Flex>
            </Header>
            <Layout className="app-workbench" hasSider>
                <Sider
                    className="app-sider"
                    width={184}
                    breakpoint="xl"
                    collapsedWidth={64}
                    trigger={null}
                    theme="light"
                >
                    <nav className="app-sider-navigation" aria-label="Application navigation">
                        <Menu className="app-sider-primary" mode="inline" selectedKeys={[navigationView]} items={primaryItems} onClick={handleMenuClick} />
                        <div className="app-sider-footer">
                            <Menu mode="inline" selectedKeys={[view]} items={utilityItems} onClick={handleMenuClick} />
                        </div>
                    </nav>
                </Sider>
                <Layout className="app-main">
                    <Content className="app-content" inert={isBusy && view !== "console"} aria-busy={isBusy} aria-label={pageLabel}>{children}</Content>
                </Layout>
            </Layout>
            <SyncPanel />
            <Modal
                open={isReloadOpen}
                title="Discard changes and reload?"
                okText="Discard and reload"
                cancelText="Cancel"
                okButtonProps={{ danger: true, disabled: isBusy }}
                onCancel={() => setIsReloadOpen(false)}
                onOk={() =>
                {
                    if (useAppStore.getState().isBusy) return;
                    setIsReloadOpen(false);
                    onReload();
                }}
            >
                <Typography.Paragraph>
                    Reload discards all unsaved changes in the app, including drafts on other pages and Layer order and options, and loads the current local files.
                    If loading fails, your current workspace and unsaved changes are kept.
                </Typography.Paragraph>
            </Modal>
            <Modal
                open={isSetupOpen}
                title="Deploy configuration?"
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
                    Setup regenerates output and replaces rules, agents, shared rules, and same-name skills in existing assistant directories. Missing directories are skipped.
                </Typography.Paragraph>
            </Modal>
        </Layout>
    );
}
