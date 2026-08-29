/**
 * Ant Design desktop chrome with sidebar navigation and workspace commands.
 */

import {
    AppstoreOutlined,
    BuildOutlined,
    CheckCircleOutlined,
    CloudServerOutlined,
    DeploymentUnitOutlined,
    ExperimentOutlined,
    FileDoneOutlined,
    FileTextOutlined,
    RobotOutlined,
    RocketOutlined,
    SaveOutlined,
    SettingOutlined,
    ThunderboltOutlined,
} from "@ant-design/icons";
import { Badge, Button, Flex, Layout, Menu, Modal, Space, Spin, Tooltip, Typography, type MenuProps } from "antd";
import { useEffect, useState, type ReactNode } from "react";
import { useAppStore, type AppView, type WorkspaceView } from "@/stores/AppStore";

const { Header, Sider, Content } = Layout;

/** Navigation item shown in the app chrome sidebar. */
interface NavItem
{
    label: string;
    icon: ReactNode;
}

/** Primary workspace modules shown in the desktop sidebar. */
const WORKSPACE_NAV_ITEMS: Readonly<Record<WorkspaceView, NavItem>> = {
    project: { label: "Harnesses", icon: <DeploymentUnitOutlined /> },
    rules: { label: "Rules", icon: <FileTextOutlined /> },
    "shared-rules": { label: "Shared rules", icon: <FileTextOutlined /> },
    "layer-registration": { label: "Layer setup", icon: <AppstoreOutlined /> },
    "layer-editor": { label: "Layer editor", icon: <AppstoreOutlined /> },
    agents: { label: "Agents", icon: <RobotOutlined /> },
    skills: { label: "Skills", icon: <ThunderboltOutlined /> },
    "skill-registration": { label: "Skill registration", icon: <ThunderboltOutlined /> },
    generated: { label: "Generated", icon: <FileDoneOutlined /> },
};

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
    const dirtyCount = useAppStore((state) =>
    {
        const savedLayers = state.workspace?.config.layers ?? [];
        const hasLayerChanges = savedLayers.length !== state.layerSelection.length
            || savedLayers.some((item, index) => item.name !== state.layerSelection[index]?.name || item.selected !== state.layerSelection[index]?.option);
        return Object.keys(state.editorDrafts).length + (hasLayerChanges ? 1 : 0);
    });
    const [version, setVersion] = useState("");
    const [isSetupOpen, setIsSetupOpen] = useState(false);
    const currentNav = view === "settings" || view === "showcase" ? undefined : WORKSPACE_NAV_ITEMS[view];
    const pageLabel = currentNav?.label ?? (view === "settings" ? "Settings" : "Ant Design");
    const primaryItems: MenuProps["items"] = [
        { key: "project", icon: WORKSPACE_NAV_ITEMS.project.icon, label: WORKSPACE_NAV_ITEMS.project.label },
        {
            key: "rules-group",
            icon: WORKSPACE_NAV_ITEMS.rules.icon,
            label: "Rules",
            children: [
                { key: "rules", label: "Inline" },
                { key: "shared-rules", label: "Shared" },
            ],
        },
        {
            key: "layers",
            icon: <AppstoreOutlined />,
            label: "Layers",
            children: [
                { key: "layer-editor", label: "Editor" },
                { key: "layer-registration", label: "Setup" },
            ],
        },
        { key: "agents", icon: WORKSPACE_NAV_ITEMS.agents.icon, label: WORKSPACE_NAV_ITEMS.agents.label },
        {
            key: "skills-group",
            icon: WORKSPACE_NAV_ITEMS.skills.icon,
            label: "Skills",
            children: [
                { key: "skills", label: "Library" },
                { key: "skill-registration", label: "Registration" },
            ],
        },
        { key: "generated", icon: WORKSPACE_NAV_ITEMS.generated.icon, label: WORKSPACE_NAV_ITEMS.generated.label },
    ];
    const utilityItems: MenuProps["items"] = [
        ...(import.meta.env.DEV ? [{ key: "showcase", icon: <ExperimentOutlined />, label: "UI Kit" }] : []),
        { key: "settings", icon: <SettingOutlined />, label: "Settings" },
    ];
    const topbarButtonClassNames = { content: "app-topbar-button-label" };

    useEffect(() =>
    {
        void window.appApi.app.getVersion().then(setVersion).catch(() => setVersion(""));
    }, []);

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
                            <Typography.Text ellipsis title={workspace?.root ?? ""}>{workspace ? `${workspace.root}\\.halign` : "Loading workspace..."}</Typography.Text>
                        </span>
                    </div>
                </Flex>
                <Flex align="center" gap={12} wrap={false}>
                    {isBusy ? <Space size={6}><Spin size="small" /><Typography.Text type="secondary">Working...</Typography.Text></Space> : dirtyCount > 0 ? <Badge status="processing" text={`${dirtyCount} unsaved`} /> : null}
                    <Tooltip title="Save all changes (Ctrl+S)">
                        <Button classNames={topbarButtonClassNames} icon={<SaveOutlined />} disabled={!workspace || isBusy} aria-keyshortcuts="Control+S" onClick={onSave}>Save</Button>
                    </Tooltip>
                    <Space.Compact>
                        <Button classNames={topbarButtonClassNames} icon={<CheckCircleOutlined />} disabled={!workspace || isBusy} onClick={onCheck}>Check</Button>
                        <Button classNames={topbarButtonClassNames} type="primary" icon={<BuildOutlined />} disabled={!workspace || isBusy} onClick={onGenerate}>Generate</Button>
                        <Button classNames={topbarButtonClassNames} icon={<RocketOutlined />} disabled={!workspace || isBusy} onClick={() => setIsSetupOpen(true)}>Setup</Button>
                    </Space.Compact>
                </Flex>
            </Header>
            <Layout className="app-workbench" hasSider>
                <Sider
                    className="app-sider"
                    width={200}
                    theme="light"
                >
                    <nav className="app-sider-navigation" aria-label="Application navigation">
                        <Menu className="app-sider-primary" mode="inline" selectedKeys={[view]} items={primaryItems} onClick={handleMenuClick} />
                        <div className="app-sider-footer">
                            <Menu mode="inline" selectedKeys={[view]} items={utilityItems} onClick={handleMenuClick} />
                        </div>
                    </nav>
                </Sider>
                <Layout className="app-main">
                    <Content className="app-content" inert={isBusy} aria-busy={isBusy} aria-label={pageLabel}>{children}</Content>
                </Layout>
            </Layout>
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
