/**
 * Ant Design Skills page for discovery, updates, import, and removal.
 */

import {
    CloudDownloadOutlined,
    CloseOutlined,
    DeleteOutlined,
    ExportOutlined,
    GithubOutlined,
    ImportOutlined,
    PlusOutlined,
    ReloadOutlined,
    SearchOutlined,
    ThunderboltOutlined,
    WarningOutlined,
} from "@ant-design/icons";
import type { ProjectSkill, RemoteSkill, SkillOrigin, SkillUpdate, UserSkill, Workspace } from "@shared/models/Workspace";
import { Alert, Avatar, Button, Card, Checkbox, Drawer, Empty, Flex, Form, Input, Listy, Modal, Select, Space, Tabs, Tag, Tooltip, Typography, type TabsProps } from "antd";
import { useEffect, useState, type ReactNode } from "react";
import { showError, showSuccess, writeLog } from "@/components/common/Feedback";
import { refreshWorkspace, runCommand, runMutation } from "@/features/workspace/WorkspaceTasks";
import { selectableRemoteSkillIds } from "@/lib/Utils";
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
    if (origin.kind === "github") return `github:${origin.owner.toLowerCase()}/${origin.name.toLowerCase()}`;
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
    const sources = new Map([...skillSources, ...installed.flatMap((skill) => skill.origin.kind === "github" ? [skill.origin] : [])]
        .map((source) => [`${source.owner.toLowerCase()}/${source.name.toLowerCase()}`, source]));
    const buckets: OriginBucket[] = [...sources.values()].map((source) => ({
        key: `github:${source.owner.toLowerCase()}/${source.name.toLowerCase()}`,
        label: `${source.owner}/${source.name}`,
        count: installed.filter((skill) => skill.origin.kind === "github"
            && skill.origin.owner.toLowerCase() === source.owner.toLowerCase()
            && skill.origin.name.toLowerCase() === source.name.toLowerCase()).length,
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
                onClick={() => void window.appApi.app.openExternal(`https://github.com/${repo}`).catch((error: unknown) => showError(error, "Open link failed"))}
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
        actions.push(<Tooltip key="error" title="Update check failed. See Console for details."><Typography.Text type="danger" tabIndex={0} aria-label="Update check failed"><WarningOutlined /></Typography.Text></Tooltip>);
    }
    else if (update && isOutdated(update))
    {
        actions.push(<IconAction key="update" label="Apply update" disabled={isBusy} onClick={() => onUpdate(skill.id)} icon={<CloudDownloadOutlined />} />);
    }
    actions.push(<IconAction key="remove" label="Remove" danger disabled={isBusy} onClick={() => onRemove(skill.id)} icon={<DeleteOutlined />} />);

    return (
        <div className="app-list-row">
            <Avatar className="skill-avatar" shape="square" icon={<ThunderboltOutlined />} />
            <div className="app-list-copy">
                <Space size={8} wrap><Typography.Text strong>{skill.id}</Typography.Text><OriginMeta origin={skill.origin} /></Space>
                {skill.description ? <Typography.Text type="secondary">{skill.description}</Typography.Text> : null}
            </div>
            <Space size={4}>{actions}</Space>
        </div>
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
        <Checkbox className="skills-selectable-row" checked={checked} disabled={Boolean(disabled)} onChange={() => onToggle(id)}>
            <Space orientation="vertical" size={2}>
                <Space size={8} wrap><Typography.Text strong>{title || id}</Typography.Text>{detail}</Space>
                {description ? <Typography.Text type="secondary">{description}</Typography.Text> : null}
            </Space>
        </Checkbox>
    );
}

/** Render the compact form for registering one GitHub skill source. */
function NewSkillSourceForm({ onAdded, onCancel, onError }: {
    onAdded: () => void;
    onCancel: () => void;
    onError: (message: string | undefined) => void;
})
{
    const isBusy = useAppStore((state) => state.isBusy);
    const [url, setUrl] = useState("");
    const [branch, setBranch] = useState("");

    return (
        <form
            onSubmit={(event) =>
            {
                event.preventDefault();
                onError(undefined);
                void runMutation(async () =>
                {
                    const input = branch.trim() ? { url: url.trim(), branch: branch.trim() } : { url: url.trim() };
                    const config = await window.appApi.workspace.addSkillSource(input);
                    showSuccess("Skill source added", config.skillSources.map((source) => `${source.owner}/${source.name} (${source.branch ?? "default branch"})`).join("\n"));
                    await refreshWorkspace();
                    onAdded();
                }).then((result) =>
                {
                    if (!result.ok) onError(result.message);
                });
            }}
        >
            <Card
                size="small"
                title="New GitHub source"
                extra={<Button type="text" icon={<CloseOutlined />} disabled={isBusy} aria-label="Cancel new skill source" onClick={onCancel} />}
            >
                <Form component={false} layout="vertical" requiredMark={false}>
                    <Form.Item label="Repository URL" htmlFor="skill-source-url">
                        <Input id="skill-source-url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://github.com/owner/repo" disabled={isBusy} />
                    </Form.Item>
                    <Form.Item label="Branch" htmlFor="skill-source-branch">
                        <Input id="skill-source-branch" value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="Default branch" disabled={isBusy} />
                    </Form.Item>
                    <Button type="primary" htmlType="submit" disabled={isBusy || !url.trim()}>Add source</Button>
                </Form>
            </Card>
        </form>
    );
}

/** Render registered GitHub sources alongside the skill library they feed. */
function SkillSourcesSection({ workspace }: { workspace: Workspace })
{
    const isBusy = useAppStore((state) => state.isBusy);
    const [isAdding, setIsAdding] = useState(false);
    const [formError, setFormError] = useState<string>();
    const [removeSource, setRemoveSource] = useState<Workspace["config"]["skillSources"][number]>();

    return (
        <section className="skills-section">
            {!isAdding ? <header className="skills-section-header">
                <Button icon={<PlusOutlined />} disabled={isBusy} onClick={() => setIsAdding(true)}>Add source</Button>
            </header> : null}
            <div className="skills-section-body">
                {formError ? <Alert type="error" title="Source update failed" description={<span className="pre-wrap">{formError}</span>} showIcon /> : null}
                {isAdding ? (
                    <NewSkillSourceForm
                        onCancel={() => setIsAdding(false)}
                        onError={setFormError}
                        onAdded={() =>
                        {
                            setFormError(undefined);
                            setIsAdding(false);
                        }}
                    />
                ) : workspace.config.skillSources.length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No GitHub sources registered" />
                ) : (
                    <Listy
                        items={workspace.config.skillSources}
                        rowKey={(source) => `${source.owner}/${source.name}`}
                        itemRender={(source) => (
                            <div className="app-list-row">
                                <Avatar shape="square" icon={<GithubOutlined />} />
                                <div className="app-list-copy">
                                    <Typography.Text strong>{source.owner}/{source.name}</Typography.Text>
                                    <Typography.Text type="secondary">Branch: {source.branch}</Typography.Text>
                                </div>
                                <Space size={4}>
                                    <Tooltip title="Open repository">
                                        <Button
                                            type="text"
                                            icon={<ExportOutlined />}
                                            aria-label={`Open ${source.owner}/${source.name}`}
                                            onClick={() => void window.appApi.app.openExternal(`https://github.com/${source.owner}/${source.name}`).catch((error: unknown) => showError(error, "Open link failed"))}
                                        />
                                    </Tooltip>
                                    <Tooltip title="Remove source">
                                        <Button
                                            type="text"
                                            danger
                                            icon={<DeleteOutlined />}
                                            disabled={isBusy}
                                            aria-label={`Remove ${source.owner}/${source.name}`}
                                            onClick={() => setRemoveSource(source)}
                                        />
                                    </Tooltip>
                                </Space>
                            </div>
                        )}
                    />
                )}
            </div>
            <Modal open={Boolean(removeSource)} title="Remove skill source?" okText="Remove" okButtonProps={{ danger: true }} confirmLoading={isBusy}
                   closable={!isBusy} cancelButtonProps={{ disabled: isBusy }} mask={{ closable: !isBusy }} keyboard={!isBusy}
                   onCancel={() => setRemoveSource(undefined)} onOk={() =>
                   {
                       if (!removeSource) return;
                       setFormError(undefined);
                       void runMutation(async () =>
                       {
                           await window.appApi.workspace.removeSkillSource(removeSource.owner, removeSource.name);
                           showSuccess("Skill source removed", `${removeSource.owner}/${removeSource.name}`);
                           setRemoveSource(undefined);
                           await refreshWorkspace();
                       }).then((result) =>
                       {
                           if (!result.ok) setFormError(result.message);
                       });
                   }}>
                Remove {removeSource?.owner}/{removeSource?.name} from discovery? Installed skills are kept.
            </Modal>
        </section>
    );
}

/** Render the complete Ant Design Skills management page. */
export function SkillsPanel()
{
    const workspace = useAppStore((state) => state.workspace);
    const isBusy = useAppStore((state) => state.isBusy);
    const [listView, setListView] = useState<SkillsListView>("installed");
    const [originFilter, setOriginFilter] = useState<OriginFilter>("all");
    const [discovered, setDiscovered] = useState<RemoteSkill[]>([]);
    const [hasDiscovered, setHasDiscovered] = useState(false);
    const [updates, setUpdates] = useState<SkillUpdate[]>([]);
    const [userSkills, setUserSkills] = useState<UserSkill[]>([]);
    const [selectedRemote, setSelectedRemote] = useState<string[]>([]);
    const [selectedImport, setSelectedImport] = useState<string[]>([]);
    const [isImportOpen, setIsImportOpen] = useState(false);
    const [isRegistrationOpen, setIsRegistrationOpen] = useState(false);
    const [isOverwriteOpen, setIsOverwriteOpen] = useState(false);
    const [removeId, setRemoveId] = useState<string>();
    const [filter, setFilter] = useState("");

    const selectableRemoteIds = selectableRemoteSkillIds(discovered, workspace?.skills ?? []);
    const selectedRemoteIds = selectedRemote.filter((id) => selectableRemoteIds.has(id));

    useEffect(() =>
    {
        const selectableIds = selectableRemoteSkillIds(discovered, workspace?.skills ?? []);
        setSelectedRemote((current) => current.filter((id) => selectableIds.has(id)));
    }, [discovered, workspace]);

    if (!workspace) return <Empty description="The user workspace is not loaded yet" />;

    const installed = workspace.skills;
    const buckets = originBuckets(workspace.config.skillSources, installed);
    const updateById = new Map(updates.map((item) => [item.id, item]));
    const outdated = updates.filter((update) => isOutdated(update) && installed.some((skill) => skill.id === update.id));
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
        if (isBusy || !selectableRemoteIds.has(id)) return;
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
            setHasDiscovered(true);
            setSelectedRemote([]);
            setFilter("");
            setOriginFilter("all");
            setListView("discover");
            showSuccess("Discover completed", `Discovered ${skills.length} skill(s).\n${JSON.stringify(skills, null, 2)}`);
        }, "Discover");
    };

    /** Download the selected discovered skills into this project. */
    const handleDownload = (): void =>
    {
        if (selectedRemoteIds.length === 0) return;
        void runCommand(async () =>
        {
            const report = await window.appApi.workspace.installSkills(selectedRemoteIds);
            showSuccess("Install completed", report);
            setSelectedRemote([]);
            setListView("installed");
            await refreshWorkspace();
        }, "Install");
    };

    /** Compare installed GitHub skills with remote content hashes. */
    const handleCheckUpdates = (): void =>
    {
        void runCommand(async () =>
        {
            const next = await window.appApi.workspace.checkSkillUpdates();
            setUpdates(next);
            setListView("installed");
            const report = `Checked ${next.length} GitHub skill(s).\n${JSON.stringify(next, null, 2)}`;
            if (next.some((update) => update.error)) showError(report, "Update check completed with errors");
            else showSuccess("Update check completed", report);
        }, "Update check");
    };

    /** Apply selected updates and refresh the workspace. */
    const handleApplyUpdates = (ids: string[]): void =>
    {
        if (ids.length === 0) return;
        void runCommand(async () =>
        {
            const report = await window.appApi.workspace.applySkillUpdates(ids);
            showSuccess("Updates applied", report);
            setUpdates((current) => current.filter((item) => !ids.includes(item.id)));
            await refreshWorkspace();
        }, "Apply updates");
    };

    /** Open the user-skill import drawer after loading its contents. */
    const handleImport = (): void =>
    {
        void runCommand(async () =>
        {
            const skills = await window.appApi.workspace.listUserSkills();
            setUserSkills(skills);
            writeLog("info", "User skills listed", JSON.stringify(skills, null, 2));
            setSelectedImport([]);
            setIsImportOpen(true);
        }, "List user skills");
    };

    /** Import selected user skills and optionally overwrite matching ids. */
    const handleImportConfirm = (overwrite: boolean): void =>
    {
        void runCommand(async () =>
        {
            const report = await window.appApi.workspace.importUserSkills(selectedImport, overwrite);
            showSuccess("Import completed", report);
            setIsImportOpen(false);
            setIsOverwriteOpen(false);
            await refreshWorkspace();
        }, "Import");
    };

    const installedContent = filteredInstalled.length === 0
        ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={installed.length === 0 ? "No installed skills yet" : "No matching skills"} />
        : (
            <Listy
                items={filteredInstalled}
                rowKey="id"
                itemRender={(skill) => (
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
        ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={!hasDiscovered
            ? workspace.config.skillSources.length === 0 ? "Add a GitHub source to discover skills" : "Browse skills from your GitHub sources"
            : discovered.length === 0 ? "No skills found in registered sources" : "No matching skills"}>
            {!hasDiscovered ? <Button type="primary" disabled={isBusy} icon={workspace.config.skillSources.length === 0 ? <PlusOutlined /> : <SearchOutlined />}
                onClick={workspace.config.skillSources.length === 0 ? () => setIsRegistrationOpen(true) : handleDiscover}>
                {workspace.config.skillSources.length === 0 ? "Add source" : "Discover skills"}
            </Button> : null}
        </Empty>
        : (
            <Listy
                items={filteredDiscovered}
                rowKey={(skill) => `${skill.owner}/${skill.name}@${skill.branch}/${skill.sourcePath}`}
                itemRender={(skill) => (
                    <SelectableSkillRow
                        id={skill.id}
                        title={skill.id}
                        description={skill.description}
                        disabled={isBusy || !selectableRemoteIds.has(skill.id)}
                        checked={selectedRemoteIds.includes(skill.id)}
                        onToggle={toggleRemote}
                        detail={skill.conflict
                            ? <Tag color="error">Conflict</Tag>
                            : <Space size={8}><Tag>{skill.owner}/{skill.name}@{skill.branch}</Tag>
                                {!selectableRemoteIds.has(skill.id) ? <Tag>Installed</Tag> : null}</Space>}
                    />
                )}
            />
        );
    const tabItems: TabsProps["items"] = [
        { key: "installed", label: <Space>Installed<Tag>{installed.length}</Tag></Space>, children: installedContent },
        { key: "discover", label: <Space>Discover{hasDiscovered ? <Tag>{discovered.length}</Tag> : null}</Space>, children: discoverContent },
    ];
    return (
        <div className="skills-page">
            <Flex align="center" justify="space-between" gap={16} wrap>
                <Typography.Title level={3} className="page-title">Skills</Typography.Title>
                <Space size={8}>
                    <Button icon={<GithubOutlined />} disabled={isBusy} onClick={() => setIsRegistrationOpen(true)}>Sources</Button>
                    <Button icon={<ImportOutlined />} disabled={isBusy} onClick={handleImport}>Import</Button>
                </Space>
            </Flex>
            <section className="skills-library">
                <div className="skills-section-body skills-library-body">
                    <Flex align="center" gap={12} wrap className="skills-toolbar">
                        <Input
                            className="skills-filter-input"
                            aria-label="Search skills"
                            allowClear
                            prefix={<SearchOutlined />}
                            value={filter}
                            onChange={(event) => setFilter(event.target.value)}
                            placeholder="Search skills..."
                            disabled={isBusy}
                        />
                        {listView === "installed" && buckets.length > 0
                            ? <Select aria-label="Filter by origin" value={originFilter} options={originItems} onChange={setOriginFilter} className="skills-origin-select" />
                            : null}
                        <Space wrap className="skills-toolbar-actions">
                            {listView === "installed" ? <>
                                <Tooltip title={installed.some((skill) => skill.origin.kind === "github") ? "Check GitHub skills for updates" : "No GitHub skills installed"}>
                                    <Button icon={<ReloadOutlined />} disabled={isBusy || !installed.some((skill) => skill.origin.kind === "github")}
                                            onClick={handleCheckUpdates}>Check updates</Button>
                                </Tooltip>
                                {outdated.length > 0 ? <Button type="primary" disabled={isBusy}
                                    onClick={() => handleApplyUpdates(outdated.map((item) => item.id))}>Update {outdated.length}</Button> : null}
                            </> : hasDiscovered ? <>
                                <Button icon={<ReloadOutlined />} disabled={isBusy || workspace.config.skillSources.length === 0} onClick={handleDiscover}>Refresh</Button>
                                <Button type="primary" icon={<CloudDownloadOutlined />} disabled={isBusy || selectedRemoteIds.length === 0}
                                        onClick={handleDownload}>Install selected ({selectedRemoteIds.length})</Button>
                            </> : null}
                        </Space>
                    </Flex>
                    <Tabs activeKey={listView} items={tabItems} onChange={(key) =>
                    {
                        const next = key as SkillsListView;
                        setListView(next);
                        setFilter("");
                        setOriginFilter("all");
                    }} />
                </div>
            </section>

            <Modal
                open={isRegistrationOpen}
                title="Skill sources"
                width={720}
                styles={{ body: { maxHeight: "65vh", overflowY: "auto" } }}
                footer={null}
                destroyOnHidden
                closable={{ disabled: isBusy }}
                mask={{ closable: false }}
                keyboard={!isBusy}
                onCancel={() => setIsRegistrationOpen(false)}
            >
                <SkillSourcesSection workspace={workspace} />
            </Modal>

            <Drawer
                open={isImportOpen}
                title="Import user skills"
                size={520}
                closable={{ disabled: isBusy }}
                mask={{ closable: !isBusy }}
                keyboard={!isBusy}
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
                {userSkills.length === 0 ? <Empty description={<>No skills found in <code>%USERPROFILE%\.agents\skills</code></>} /> : (
                    <Listy
                        items={userSkills}
                        rowKey="id"
                        itemRender={(skill) => (
                            <SelectableSkillRow
                                id={skill.id}
                                title={skill.id}
                                description={skill.description || skill.title}
                                checked={selectedImport.includes(skill.id)}
                                disabled={isBusy}
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
                okButtonProps={{ danger: true }}
                confirmLoading={isBusy}
                closable={!isBusy}
                cancelButtonProps={{ disabled: isBusy }}
                mask={{ closable: !isBusy }}
                keyboard={!isBusy}
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
                closable={!isBusy}
                cancelButtonProps={{ disabled: isBusy }}
                mask={{ closable: !isBusy }}
                keyboard={!isBusy}
                onCancel={() => setRemoveId(undefined)}
                onOk={() =>
                {
                    if (!removeId) return;
                    void runMutation(async () =>
                    {
                        await window.appApi.workspace.removeSkill(removeId);
                        showSuccess("Skill removed", `Removed ${removeId}`);
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
