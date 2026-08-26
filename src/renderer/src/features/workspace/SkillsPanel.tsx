/**
 * Ant Design Skills page for discovery, updates, import, and removal.
 */

import {
    CloudDownloadOutlined,
    DeleteOutlined,
    ExportOutlined,
    FolderAddOutlined,
    ReloadOutlined,
    SearchOutlined,
    SyncOutlined,
    ThunderboltOutlined,
    WarningOutlined,
} from "@ant-design/icons";
import type { ProjectSkill, RemoteSkill, SkillOrigin, SkillUpdate, UserSkill } from "@shared/models/Workspace";
import { Avatar, Button, Card, Checkbox, Col, Drawer, Empty, Flex, Input, List, Modal, Row, Select, Space, Statistic, Tabs, Tag, Tooltip, Typography, type TabsProps } from "antd";
import { useState, type ReactNode } from "react";
import { refreshWorkspace, runCommand, runMutation } from "@/features/workspace/WorkspaceTasks";
import { useAppStore } from "@/stores/AppStore";

/** Which list the panel currently shows. */
type SkillsListView = "installed" | "discover";

/** Origin filter key for installed skills. */
type OriginFilter = "all" | "local" | "unknown" | `github:${string}/${string}`;

/** Counted origin option shown in the installed-skill filter. */
interface OriginBucket
{
    key: OriginFilter;
    label: string;
    count: number;
}

/** Return whether any haystack contains the normalized search query. */
function matchesQuery(haystacks: readonly string[], query: string): boolean
{
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return haystacks.some((item) => item.toLowerCase().includes(needle));
}

/** Return the stable filter key for an installed skill origin. */
function originFilterKey(origin: SkillOrigin): OriginFilter
{
    if (origin.kind === "github") return `github:${origin.owner}/${origin.name}`;
    if (origin.kind === "local") return "local";
    return "unknown";
}

/** Return searchable fields for an installed skill. */
function installedHaystacks(skill: ProjectSkill): string[]
{
    const fields = [skill.id, skill.title, skill.description];
    if (skill.origin.kind === "github") fields.push(`${skill.origin.owner}/${skill.origin.name}`, skill.origin.branch);
    return fields;
}

/** Return searchable fields for a discovered remote skill. */
function remoteHaystacks(skill: RemoteSkill): string[]
{
    return [skill.id, skill.title, skill.description, `${skill.owner}/${skill.name}`, skill.sourcePath];
}

/** Build counted origin filters from registered sources and installed skills. */
function originBuckets(skillSources: readonly { owner: string; name: string }[], installed: readonly ProjectSkill[]): OriginBucket[]
{
    const buckets: OriginBucket[] = skillSources.map((source) => ({
        key: `github:${source.owner}/${source.name}`,
        label: `${source.owner}/${source.name}`,
        count: installed.filter((skill) => skill.origin.kind === "github"
            && skill.origin.owner === source.owner
            && skill.origin.name === source.name).length,
    }));
    const localCount = installed.filter((skill) => skill.origin.kind === "local").length;
    const unknownCount = installed.filter((skill) => skill.origin.kind === "unknown").length;
    if (localCount > 0) buckets.push({ key: "local", label: "Local", count: localCount });
    if (unknownCount > 0) buckets.push({ key: "unknown", label: "Unknown", count: unknownCount });
    return buckets;
}

/** Return whether an update result describes an available replacement. */
function isOutdated(update: SkillUpdate): boolean
{
    return !update.error && update.currentHash !== update.remoteHash;
}

/** Render one official icon button with a tooltip label. */
function IconAction({ label, disabled, danger, onClick, icon }: { label: string; disabled?: boolean; danger?: boolean; onClick?: () => void; icon: ReactNode })
{
    return (
        <Tooltip title={label}>
            <Button type="text" danger={Boolean(danger)} disabled={Boolean(disabled)} aria-label={label} icon={icon} onClick={() => onClick?.()} />
        </Tooltip>
    );
}

/** Render GitHub provenance or a local origin tag. */
function OriginMeta({ origin }: { origin: SkillOrigin })
{
    if (origin.kind === "github")
    {
        const repo = `${origin.owner}/${origin.name}`;
        return (
            <Button
                type="link"
                size="small"
                icon={<ExportOutlined />}
                onClick={() => void window.appApi.app.openExternal(`https://github.com/${repo}`).catch(() => undefined)}
            >
                {repo}
            </Button>
        );
    }
    return <Tag>{origin.kind === "local" ? "Local" : "Unknown"}</Tag>;
}

/** Render one installed skill row with update and removal actions. */
function InstalledSkillRow({ skill, update, isBusy, onUpdate, onRemove }: {
    skill: ProjectSkill;
    update: SkillUpdate | undefined;
    isBusy: boolean;
    onUpdate: (id: string) => void;
    onRemove: (id: string) => void;
})
{
    const actions: ReactNode[] = [];
    if (update?.error)
    {
        actions.push(<IconAction key="error" label={update.error} danger icon={<WarningOutlined />} />);
    }
    else if (update && isOutdated(update))
    {
        actions.push(<IconAction key="update" label="Apply update" disabled={isBusy} onClick={() => onUpdate(skill.id)} icon={<SyncOutlined />} />);
    }
    actions.push(<IconAction key="remove" label="Remove" danger disabled={isBusy} onClick={() => onRemove(skill.id)} icon={<DeleteOutlined />} />);

    return (
        <List.Item actions={actions}>
            <List.Item.Meta
                avatar={<Avatar shape="square" icon={<ThunderboltOutlined />} />}
                title={<Space size={8}><Typography.Text strong>{skill.id}</Typography.Text><OriginMeta origin={skill.origin} /></Space>}
                description={skill.description || undefined}
            />
        </List.Item>
    );
}

/** Render one selectable skill row for discover and import pickers. */
function SelectableSkillRow({ id, title, description, detail, checked, disabled, onToggle }: {
    id: string;
    title: string;
    description: string;
    detail?: ReactNode;
    checked: boolean;
    disabled?: boolean;
    onToggle: (id: string) => void;
})
{
    return (
        <List.Item>
            <Checkbox checked={checked} disabled={Boolean(disabled)} onChange={() => onToggle(id)}>
                <Space direction="vertical" size={2}>
                    <Space size={8}><Typography.Text strong>{title || id}</Typography.Text>{detail}</Space>
                    {description ? <Typography.Text type="secondary">{description}</Typography.Text> : null}
                </Space>
            </Checkbox>
        </List.Item>
    );
}

/** Render the complete Ant Design Skills management page. */
export function SkillsPanel()
{
    const workspace = useAppStore((state) => state.workspace);
    const isBusy = useAppStore((state) => state.isBusy);
    const setOutput = useAppStore((state) => state.setOutput);
    const [listView, setListView] = useState<SkillsListView>("installed");
    const [originFilter, setOriginFilter] = useState<OriginFilter>("all");
    const [discovered, setDiscovered] = useState<RemoteSkill[]>([]);
    const [updates, setUpdates] = useState<SkillUpdate[]>([]);
    const [userSkills, setUserSkills] = useState<UserSkill[]>([]);
    const [selectedRemote, setSelectedRemote] = useState<string[]>([]);
    const [selectedImport, setSelectedImport] = useState<string[]>([]);
    const [isImportOpen, setIsImportOpen] = useState(false);
    const [isOverwriteOpen, setIsOverwriteOpen] = useState(false);
    const [removeId, setRemoveId] = useState<string>();
    const [filter, setFilter] = useState("");

    if (!workspace) return <Empty description="The user workspace is not loaded yet" />;

    const installed = workspace.skills;
    const buckets = originBuckets(workspace.config.skillSources, installed);
    const updateById = new Map(updates.map((item) => [item.id, item]));
    const outdated = updates.filter(isOutdated);
    const filteredInstalled = installed.filter((skill) => (originFilter === "all" || originFilterKey(skill.origin) === originFilter)
        && matchesQuery(installedHaystacks(skill), filter));
    const filteredDiscovered = discovered.filter((skill) => matchesQuery(remoteHaystacks(skill), filter));
    const originItems = [
        { label: `All (${installed.length})`, value: "all" as OriginFilter },
        ...buckets.map((bucket) => ({ label: `${bucket.label} (${bucket.count})`, value: bucket.key })),
    ];

    /** Toggle a remote skill id in the installation selection. */
    const toggleRemote = (id: string): void =>
    {
        setSelectedRemote((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    };

    /** Toggle a user skill id in the import selection. */
    const toggleImport = (id: string): void =>
    {
        setSelectedImport((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    };

    /** Discover skills from every registered GitHub source. */
    const handleDiscover = (): void =>
    {
        void runCommand(async () =>
        {
            const skills = await window.appApi.workspace.discoverSkills();
            setDiscovered(skills);
            setSelectedRemote([]);
            setOriginFilter("all");
            setListView("discover");
            setOutput(`Discovered ${skills.length} skill(s).`, "success", "Discover completed");
        });
    };

    /** Download the selected discovered skills into this project. */
    const handleDownload = (): void =>
    {
        void runCommand(async () =>
        {
            const report = await window.appApi.workspace.installSkills(selectedRemote);
            setOutput(report, "success", "Install completed");
            setSelectedRemote([]);
            setListView("installed");
            await refreshWorkspace();
        });
    };

    /** Compare installed GitHub skills with remote content hashes. */
    const handleCheckUpdates = (): void =>
    {
        void runCommand(async () =>
        {
            const next = await window.appApi.workspace.checkSkillUpdates();
            setUpdates(next);
            setListView("installed");
            setOutput(`Checked ${next.length} GitHub skill(s).`, "success", "Update check completed");
        });
    };

    /** Apply selected updates and refresh the workspace. */
    const handleApplyUpdates = (ids: string[]): void =>
    {
        if (ids.length === 0) return;
        void runCommand(async () =>
        {
            const report = await window.appApi.workspace.applySkillUpdates(ids);
            setOutput(report, "success", "Updates applied");
            setUpdates((current) => current.filter((item) => !ids.includes(item.id)));
            await refreshWorkspace();
        });
    };

    /** Open the user-skill import drawer after loading its contents. */
    const handleImport = (): void =>
    {
        void runCommand(async () =>
        {
            setUserSkills(await window.appApi.workspace.listUserSkills());
            setSelectedImport([]);
            setIsImportOpen(true);
        });
    };

    /** Import selected user skills and optionally overwrite matching ids. */
    const handleImportConfirm = (overwrite: boolean): void =>
    {
        void runCommand(async () =>
        {
            const report = await window.appApi.workspace.importUserSkills(selectedImport, overwrite);
            setOutput(report, "success", "Import completed");
            setIsImportOpen(false);
            setIsOverwriteOpen(false);
            await refreshWorkspace();
        });
    };

    const installedContent = filteredInstalled.length === 0
        ? <Empty description={installed.length === 0 ? "No installed skills yet. Use Discover or Import." : "No matching skills."} />
        : (
            <List
                dataSource={filteredInstalled}
                renderItem={(skill) => (
                    <InstalledSkillRow
                        skill={skill}
                        update={updateById.get(skill.id)}
                        isBusy={isBusy}
                        onUpdate={(id) => handleApplyUpdates([id])}
                        onRemove={setRemoveId}
                    />
                )}
            />
        );
    const discoverContent = filteredDiscovered.length === 0
        ? <Empty description={discovered.length === 0 ? "No skills found in registered sources." : "No matching discovered skills."} />
        : (
            <List
                dataSource={filteredDiscovered}
                renderItem={(skill) => (
                    <SelectableSkillRow
                        id={skill.id}
                        title={skill.id}
                        description={skill.description}
                        disabled={isBusy || skill.conflict}
                        checked={selectedRemote.includes(skill.id)}
                        onToggle={toggleRemote}
                        detail={skill.conflict
                            ? <Tag color="error">Conflict</Tag>
                            : <Tag>{skill.owner}/{skill.name}@{skill.branch}</Tag>}
                    />
                )}
            />
        );
    const tabItems: TabsProps["items"] = [
        { key: "installed", label: <Space>Installed<Tag>{installed.length}</Tag></Space>, children: installedContent },
        ...(listView === "discover" || discovered.length > 0
            ? [{ key: "discover", label: <Space>Discover<Tag>{discovered.length}</Tag></Space>, children: discoverContent }]
            : []),
    ];

    return (
        <div className="skills-page">
            <Row gutter={[16, 16]}>
                <Col xs={24} md={8}>
                    <Card size="small" className="skills-stat-card"><Statistic title="Installed" value={installed.length} prefix={<ThunderboltOutlined />} /></Card>
                </Col>
                <Col xs={24} md={8}>
                    <Card size="small" className="skills-stat-card"><Statistic title="Registered sources" value={workspace.config.skillSources.length} prefix={<SearchOutlined />} /></Card>
                </Col>
                <Col xs={24} md={8}>
                    <Card size="small" className="skills-stat-card"><Statistic title="Updates available" value={outdated.length} prefix={<SyncOutlined />} {...(outdated.length > 0 ? { valueStyle: { color: "#1677ff" } } : {})} /></Card>
                </Col>
            </Row>
            <Card
                className="skills-catalog-card"
                title={(
                    <Space direction="vertical" size={0}>
                        <Typography.Text strong>Skill library</Typography.Text>
                        <Typography.Text type="secondary" className="card-subtitle">Manage capabilities available to this project.</Typography.Text>
                    </Space>
                )}
                extra={(
                    <Space wrap>
                        <Button icon={<ReloadOutlined />} disabled={isBusy} onClick={handleCheckUpdates}>Check updates</Button>
                        {outdated.length > 0 ? <Button type="primary" disabled={isBusy} onClick={() => handleApplyUpdates(outdated.map((item) => item.id))}>Apply {outdated.length}</Button> : null}
                        <Button icon={<FolderAddOutlined />} disabled={isBusy} onClick={handleImport}>Import</Button>
                        <Button
                            icon={<SearchOutlined />}
                            disabled={isBusy || workspace.config.skillSources.length === 0}
                            title={workspace.config.skillSources.length === 0 ? "Register a GitHub source on the Home page" : undefined}
                            onClick={handleDiscover}
                        >
                            Discover
                        </Button>
                        {listView === "discover" ? <Button type="primary" icon={<CloudDownloadOutlined />} disabled={isBusy || selectedRemote.length === 0} onClick={handleDownload}>Install selected</Button> : null}
                    </Space>
                )}
            >
                <Flex gap={12} wrap className="skills-filter-bar">
                    <Input
                        allowClear
                        prefix={<SearchOutlined />}
                        value={filter}
                        onChange={(event) => setFilter(event.target.value)}
                        placeholder={listView === "installed" ? "Search name, description, or repository..." : "Search discovered skills..."}
                        disabled={isBusy}
                    />
                    {listView === "installed" && buckets.length > 0
                        ? <Select value={originFilter} options={originItems} onChange={setOriginFilter} className="skills-origin-select" />
                        : null}
                </Flex>
                <Tabs activeKey={listView} items={tabItems} onChange={(key) =>
                {
                    const next = key as SkillsListView;
                    setListView(next);
                    if (next === "installed") setOriginFilter("all");
                }} />
            </Card>

            <Drawer
                open={isImportOpen}
                title="Import user skills"
                width={520}
                onClose={() => setIsImportOpen(false)}
                extra={(
                    <Button
                        type="primary"
                        disabled={isBusy || selectedImport.length === 0}
                        onClick={() =>
                        {
                            const overlap = selectedImport.filter((id) => installed.some((skill) => skill.id.toLowerCase() === id.toLowerCase()));
                            if (overlap.length > 0) setIsOverwriteOpen(true);
                            else handleImportConfirm(false);
                        }}
                    >
                        Import
                    </Button>
                )}
            >
                <Typography.Paragraph type="secondary">Copy skills from ~/.agents/skills into this project.</Typography.Paragraph>
                {userSkills.length === 0 ? <Empty description="No skills were found in ~/.agents/skills" /> : (
                    <List
                        dataSource={userSkills}
                        renderItem={(skill) => (
                            <SelectableSkillRow
                                id={skill.id}
                                title={skill.id}
                                description={skill.description || skill.title}
                                checked={selectedImport.includes(skill.id)}
                                onToggle={toggleImport}
                            />
                        )}
                    />
                )}
            </Drawer>

            <Modal
                open={isOverwriteOpen}
                title="Overwrite existing skills?"
                okText="Overwrite"
                confirmLoading={isBusy}
                onCancel={() => setIsOverwriteOpen(false)}
                onOk={() => handleImportConfirm(true)}
            >
                One or more selected skills already exist in this project.
            </Modal>
            <Modal
                open={removeId !== undefined}
                title="Remove skill?"
                okText="Remove"
                okButtonProps={{ danger: true }}
                confirmLoading={isBusy}
                onCancel={() => setRemoveId(undefined)}
                onOk={() =>
                {
                    if (!removeId) return;
                    void runMutation(async () =>
                    {
                        await window.appApi.workspace.removeSkill(removeId);
                        setRemoveId(undefined);
                        await refreshWorkspace();
                    });
                }}
            >
                Remove {removeId ?? ""} from this project?
            </Modal>
        </div>
    );
}
