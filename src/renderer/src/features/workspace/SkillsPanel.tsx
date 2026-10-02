/**
 * Ant Design Skills page for discovery, updates, import, and removal.
 */

import {
    CloudDownloadOutlined,
    CloseOutlined,
    DeleteOutlined,
    EllipsisOutlined,
    ExportOutlined,
    GithubOutlined,
    ImportOutlined,
    PlusOutlined,
    ReloadOutlined,
    SaveOutlined,
    SearchOutlined,
    UndoOutlined,
    WarningOutlined,
} from "@ant-design/icons";
import type { ProjectSkill, RemoteSkill, SkillOrigin, SkillUpdate, SkillUpdatePreview, UserSkill, Workspace } from "@shared/models/Workspace";
import { Alert, Avatar, Button, Card, Checkbox, Col, Drawer, Dropdown, Empty, Flex, Form, Input, Listy, Modal, Row, Segmented, Select, Space, Splitter, Table, Tooltip, Typography, type MenuProps } from "antd";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { showError, showSuccess } from "@/components/common/Feedback";
import { SourceEditor } from "@/components/common/SourceEditor";
import { DiffText } from "@/components/common/DiffText";
import { diffLines } from "@/lib/TextDiff";
import { persistEditorSnapshot, refreshWorkspace, runCommand, runMutation } from "@/features/workspace/WorkspaceTasks";
import { TreeButton } from "@/features/workspace/WorkspaceTree";
import { selectableRemoteSkillIds } from "@/lib/Utils";
import { selectionKey, useAppStore } from "@/stores/AppStore";

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

/** Identify a discovered row by its complete source identity. */
function remoteIdentity(skill: RemoteSkill): string
{
    return JSON.stringify([skill.owner, skill.name, skill.branch, skill.sourcePath]);
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

/** Show one installed SKILL.md and save edits only for local or unknown origins. */
function SkillContentPane({ workspace, skill }: { workspace: Workspace; skill: ProjectSkill | undefined })
{
    const isBusy = useAppStore((state) => state.isBusy);
    const draft = useAppStore((state) => skill ? state.editorDrafts[selectionKey({ kind: "skill", id: skill.id })] : undefined);
    const [source, setSource] = useState<{ id: string; content: string }>();
    const [loadError, setLoadError] = useState<string>();
    const [saveError, setSaveError] = useState<string>();
    const [revision, setRevision] = useState(0);
    const formRef = useRef<HTMLFormElement>(null);

    useEffect(() =>
    {
        let cancelled = false;
        setSource(undefined);
        setLoadError(undefined);
        setSaveError(undefined);
        if (!skill) return;
        void window.appApi.workspace.readSkillContent(skill.id).then((content) =>
        {
            if (!cancelled) setSource({ id: skill.id, content });
        }).catch((error: unknown) =>
        {
            if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
        });
        return () => { cancelled = true; };
    }, [skill?.id, workspace]);

    if (!skill) return <div className="workspace-editor"><div className="workspace-load-state"><Empty description="Select an installed skill to view SKILL.md" /></div></div>;
    const isReadOnly = skill.origin.kind === "github";
    const selection = { kind: "skill" as const, id: skill.id };
    const editorKey = selectionKey(selection);
    const currentSource = source?.id === skill.id ? source.content : undefined;
    const expectedContent = draft?.baseline.content?.[0] ?? currentSource;

    return (
        <div className="workspace-editor">
            <Flex className="workspace-editor-toolbar" align="center" justify="space-between" gap={12}>
                <Typography.Text strong ellipsis={{ tooltip: `${skill.id}/SKILL.md` }} className="workspace-editor-title">{skill.id}/SKILL.md</Typography.Text>
                {isReadOnly ? <Typography.Text type="secondary">Read only</Typography.Text> : <Space size={8}>
                    {draft ? <Button type="text" icon={<UndoOutlined />} disabled={isBusy} onClick={() =>
                    {
                        useAppStore.getState().clearEditorDraft(editorKey);
                        setRevision((current) => current + 1);
                    }}>Discard changes</Button> : null}
                    <Button icon={<SaveOutlined />} disabled={isBusy || !draft || currentSource === undefined} onClick={() => formRef.current?.requestSubmit()}>Save file</Button>
                </Space>}
            </Flex>
            <div className="workspace-scroll">
                <div className="workspace-editor-page">
                    {loadError ? <Alert className="editor-alert" type="error" title={loadError} showIcon /> : null}
                    {saveError ? <Alert className="editor-alert" type="error" title={saveError} showIcon /> : null}
                    {currentSource === undefined ? loadError ? null : <Empty description="Loading SKILL.md" /> : isReadOnly
                        ? <Form component={false} layout="vertical" requiredMark={false}>
                            <Form.Item><SourceEditor key={`${skill.id}:${currentSource}`} aria-label={`${skill.id} SKILL.md`} language="markdown" defaultValue={currentSource} readOnly /></Form.Item>
                        </Form>
                        : <form key={`${skill.id}:${currentSource}:${revision}`} ref={formRef} className="editor-form" onInput={(event) =>
                        {
                            const current = String(new FormData(event.currentTarget).get("content") ?? "");
                            useAppStore.getState().setEditorDraft(editorKey, current === expectedContent && expectedContent === currentSource ? undefined : {
                                selection,
                                baseline: { content: [expectedContent ?? ""], expectedContent: [expectedContent ?? ""] },
                                current: { content: [current], expectedContent: [expectedContent ?? ""] },
                            });
                        }} onSubmit={(event) =>
                        {
                            event.preventDefault();
                            const content = String(new FormData(event.currentTarget).get("content") ?? "");
                            setSaveError(undefined);
                            void runMutation(async () =>
                            {
                                await persistEditorSnapshot(workspace, selection, { content: [content], expectedContent: [expectedContent ?? ""] });
                                useAppStore.getState().clearEditorDraft(editorKey);
                                showSuccess("Skill saved", `Saved ${skill.id}/SKILL.md`);
                                await refreshWorkspace(selection);
                            }).then((result) => { if (!result.ok) setSaveError(result.message); });
                        }}>
                            <Form component={false} layout="vertical" requiredMark={false}>
                                <Form.Item><SourceEditor aria-label={`${skill.id} SKILL.md`} name="content" language="markdown" defaultValue={draft?.current.content?.[0] ?? currentSource} /></Form.Item>
                            </Form>
                        </form>}
                </div>
            </div>
        </div>
    );
}

/** Preview one discovered SKILL.md from the Main cache and install only that skill. */
function DiscoveredSkillPane({ skill, isInstalled, canInstall, isBusy, onInstall }: {
    skill: RemoteSkill | undefined;
    isInstalled: boolean;
    canInstall: boolean;
    isBusy: boolean;
    onInstall: (skill: RemoteSkill) => void;
})
{
    const [source, setSource] = useState<{ previewId: string; content: string }>();
    const [loadError, setLoadError] = useState<{ previewId: string; message: string }>();

    useEffect(() =>
    {
        let cancelled = false;
        setSource(undefined);
        setLoadError(undefined);
        if (!skill) return;
        void Promise.resolve().then(() => window.appApi.workspace.readDiscoveredSkillContent(skill.previewId)).then((content) =>
        {
            if (!cancelled)
            {
                setSource({ previewId: skill.previewId, content });
                setLoadError(undefined);
            }
        }).catch((error: unknown) =>
        {
            if (!cancelled) setLoadError({ previewId: skill.previewId, message: error instanceof Error ? error.message : String(error) });
        });
        return () => { cancelled = true; };
    }, [skill?.previewId]);

    if (!skill) return <div className="workspace-editor"><div className="workspace-load-state"><Empty description="Select a discovered skill to view SKILL.md" /></div></div>;
    const content = source?.previewId === skill.previewId ? source.content : undefined;
    const error = loadError?.previewId === skill.previewId ? loadError.message : undefined;
    return (
        <div className="workspace-editor">
            <Flex className="workspace-editor-toolbar" align="center" justify="space-between" gap={12}>
                <Flex align="center" gap={12} className="workspace-editor-title">
                    <Typography.Text strong ellipsis={{ tooltip: `${skill.id}/SKILL.md` }}>{skill.id}/SKILL.md</Typography.Text>
                    <Button type="link" size="small" icon={<ExportOutlined />} styles={{ root: { paddingInline: 0 } }}
                        onClick={() => void window.appApi.app.openExternal(`https://github.com/${skill.owner}/${skill.name}`).catch((linkError: unknown) => showError(linkError, "Open link failed"))}>
                        {skill.owner}/{skill.name}
                    </Button>
                </Flex>
                <Tooltip title={skill.conflict ? "This skill id appears in multiple sources." : undefined}>
                    <span><Button icon={<CloudDownloadOutlined />} disabled={isBusy || !canInstall || content === undefined || Boolean(error)} onClick={() => onInstall(skill)}>
                        {isInstalled ? "Installed" : "Install"}
                    </Button></span>
                </Tooltip>
            </Flex>
            <div className="workspace-scroll">
                <div className="workspace-editor-page">
                    {error ? <Alert className="editor-alert" type="error" title="Preview failed" description={error} showIcon /> : null}
                    <Form component={false} layout="vertical" requiredMark={false}>
                        <Form.Item>
                            {content === undefined ? error ? null : <Empty description="Loading SKILL.md" />
                                : <SourceEditor key={skill.previewId} aria-label={`${skill.id} SKILL.md`} language="markdown" defaultValue={content} readOnly />}
                        </Form.Item>
                    </Form>
                </div>
            </div>
        </div>
    );
}

/** Render the complete Ant Design Skills management page. */
export function SkillsPanel()
{
    const workspace = useAppStore((state) => state.workspace);
    const isBusy = useAppStore((state) => state.isBusy);
    const selection = useAppStore((state) => state.selection);
    const setSelection = useAppStore((state) => state.setSelection);
    const [listView, setListView] = useState<SkillsListView>("installed");
    const [originFilter, setOriginFilter] = useState<OriginFilter>("all");
    const [discovered, setDiscovered] = useState<RemoteSkill[]>([]);
    const [hasDiscovered, setHasDiscovered] = useState(false);
    const [updates, setUpdates] = useState<SkillUpdate[]>([]);
    const [updateDetails, setUpdateDetails] = useState<SkillUpdatePreview[]>([]);
    const [userSkills, setUserSkills] = useState<UserSkill[]>([]);
    const [selectedRemoteIdentity, setSelectedRemoteIdentity] = useState<string>();
    const [selectedImport, setSelectedImport] = useState<string[]>([]);
    const [isImportOpen, setIsImportOpen] = useState(false);
    const [isRegistrationOpen, setIsRegistrationOpen] = useState(false);
    const [isOverwriteOpen, setIsOverwriteOpen] = useState(false);
    const [removeId, setRemoveId] = useState<string>();
    const [filter, setFilter] = useState("");
    const sourceKey = JSON.stringify(workspace?.config.skillSources ?? []);

    useEffect(() =>
    {
        setDiscovered([]);
        setHasDiscovered(false);
        setSelectedRemoteIdentity(undefined);
        setUpdates([]);
        setUpdateDetails([]);
    }, [sourceKey]);

    if (!workspace) return <Empty description="The user workspace is not loaded yet" />;

    const installed = workspace.skills;
    const selectableRemoteIds = selectableRemoteSkillIds(discovered, installed);
    const selectedRemoteSkill = discovered.find((skill) => remoteIdentity(skill) === selectedRemoteIdentity) ?? discovered[0];
    const isSelectedRemoteInstalled = Boolean(selectedRemoteSkill && installed.some((skill) => skill.id.toLowerCase() === selectedRemoteSkill.id.toLowerCase()));
    const selectedSkill = selection.kind === "skill" ? installed.find((skill) => skill.id === selection.id) : installed[0];
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
            setUpdates([]);
            setUpdateDetails([]);
            const skills = await window.appApi.workspace.discoverSkills();
            setDiscovered(skills);
            setHasDiscovered(true);
            setSelectedRemoteIdentity(skills[0] ? remoteIdentity(skills[0]) : undefined);
            setFilter("");
            setOriginFilter("all");
            setListView("discover");
            showSuccess("Discover completed", `Discovered ${skills.length} skill(s).`);
        }, "Discover");
    };

    /** Install the one discovered skill shown in the editor. */
    const handleDownload = (skill: RemoteSkill): void =>
    {
        if (!selectableRemoteIds.has(skill.id)) return;
        void runCommand(async () =>
        {
            const report = await window.appApi.workspace.installDiscoveredSkill(skill.previewId);
            showSuccess("Install completed", report);
            await refreshWorkspace();
        }, "Install");
    };

    /** Compare installed GitHub skills with remote content hashes. */
    const handleCheckUpdates = (): void =>
    {
        void runCommand(async () =>
        {
            setUpdates([]);
            setUpdateDetails([]);
            const next = await window.appApi.workspace.checkSkillUpdates();
            setUpdates(next);
            setDiscovered([]);
            setHasDiscovered(false);
            setSelectedRemoteIdentity(undefined);
            setListView("installed");
            const report = `Checked ${next.length} GitHub skill(s).\n${JSON.stringify(next, null, 2)}`;
            if (next.some((update) => update.error)) showError(report, "Update check completed with errors");
            else showSuccess("Update check completed", report);
        }, "Update check");
    };

    /** Review the exact selected versions before applying any Skill replacement. */
    const handleApplyUpdates = (ids: string[]): void =>
    {
        if (ids.length === 0) return;
        void runCommand(async () =>
        {
            const previewIds = ids.map((id) => updates.find((update) => update.id === id)?.previewId);
            if (previewIds.some((id) => !id)) throw new Error("Skill update preview expired; check updates again.");
            const details: SkillUpdatePreview[] = [];
            for (const previewId of previewIds) details.push(await window.appApi.workspace.readSkillUpdatePreview(previewId!));
            setUpdateDetails(details);
        }, "Review updates");
    };

    /** Apply only the fixed versions displayed in the review dialog. */
    const handleConfirmUpdates = (): void =>
    {
        void runCommand(async () =>
        {
            const ids = updateDetails.map((detail) => detail.id);
            const report = await window.appApi.workspace.applySkillUpdates(updateDetails.map((detail) => detail.previewId));
            showSuccess("Updates applied", report);
            setUpdates((current) => current.filter((item) => !ids.includes(item.id)));
            setDiscovered([]);
            setHasDiscovered(false);
            setSelectedRemoteIdentity(undefined);
            setUpdateDetails([]);
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
            for (const id of selectedImport) useAppStore.getState().clearEditorDraft(selectionKey({ kind: "skill", id }));
            setIsImportOpen(false);
            setIsOverwriteOpen(false);
            await refreshWorkspace();
        }, "Import");
    };

    const topActions: NonNullable<MenuProps["items"]> = [
        { key: "sources", icon: <GithubOutlined />, label: "Sources" },
        { key: "import", icon: <ImportOutlined />, label: "Import" },
        { type: "divider" },
        { key: "discover", icon: <SearchOutlined />, label: hasDiscovered ? "Refresh discovery" : "Discover skills", disabled: workspace.config.skillSources.length === 0 },
        { key: "check", icon: <ReloadOutlined />, label: "Check updates", disabled: !installed.some((skill) => skill.origin.kind === "github") },
    ];
    if (outdated.length > 0) topActions.push({ key: "update", icon: <CloudDownloadOutlined />, label: `Update ${outdated.length}` });

    /** Dispatch one page-level skill action. */
    const handleTopAction: MenuProps["onClick"] = ({ key }) =>
    {
        if (key === "sources") setIsRegistrationOpen(true);
        else if (key === "import") handleImport();
        else if (key === "discover") handleDiscover();
        else if (key === "check") handleCheckUpdates();
        else if (key === "update") handleApplyUpdates(outdated.map((item) => item.id));
    };

    const installedContent = filteredInstalled.length === 0
        ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={installed.length === 0 ? "No installed skills yet" : "No matching skills"} />
        : (
            filteredInstalled.map((skill) =>
            {
                const update = updateById.get(skill.id);
                const actions: NonNullable<MenuProps["items"]> = [];
                if (skill.origin.kind === "github") actions.push({ key: "open", icon: <ExportOutlined />, label: "Open repository", disabled: isBusy });
                if (update?.error) actions.push({ key: "error", icon: <WarningOutlined />, label: "Update check failed. See Console for details.", disabled: true });
                else if (update && isOutdated(update)) actions.push({ key: "update", icon: <CloudDownloadOutlined />, label: "Apply update", disabled: isBusy });
                actions.push({ type: "divider" }, { key: "remove", icon: <DeleteOutlined />, label: "Remove", danger: true, disabled: isBusy });
                return <TreeButton key={skill.id} label={skill.id} active={selectedSkill?.id === skill.id} disabled={isBusy}
                    selection={{ kind: "skill", id: skill.id }} onClick={() => setSelection({ kind: "skill", id: skill.id })}
                    actions={actions} onAction={({ key }) =>
                    {
                        if (key === "open" && skill.origin.kind === "github")
                        {
                            void window.appApi.app.openExternal(`https://github.com/${skill.origin.owner}/${skill.origin.name}`).catch((error: unknown) => showError(error, "Open link failed"));
                        }
                        else if (key === "update") handleApplyUpdates([skill.id]);
                        else if (key === "remove") setRemoveId(skill.id);
                    }} />;
            })
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
            filteredDiscovered.map((skill) => (
                <TreeButton key={remoteIdentity(skill)} label={skill.id} active={selectedRemoteSkill ? remoteIdentity(selectedRemoteSkill) === remoteIdentity(skill) : false}
                    muted={installed.some((item) => item.id.toLowerCase() === skill.id.toLowerCase())}
                    disabled={isBusy} onClick={() => setSelectedRemoteIdentity(remoteIdentity(skill))} />
            ))
        );
    return (
        <>
            <Splitter className="workspace-splitter">
                <Splitter.Panel defaultSize="28%" min="20%" max="45%" collapsible>
                    <div className="workspace-tree">
                        <Flex className="workspace-tree-header">
                            <Flex align="center" gap={8}>
                                <Typography.Text strong>Skills</Typography.Text>
                                <Segmented<SkillsListView> size="small" name="skill-list" aria-label="Skill list" value={listView}
                                    options={[{ value: "installed", label: "Installed" }, { value: "discover", label: "Discover" }]}
                                    onChange={(next) =>
                                    {
                                        setListView(next);
                                        setFilter("");
                                        setOriginFilter("all");
                                    }} disabled={isBusy} />
                            </Flex>
                            <Dropdown trigger={["click"]} menu={{ items: topActions, onClick: handleTopAction }}>
                                <Button type="text" size="small" icon={<EllipsisOutlined />} disabled={isBusy}>More</Button>
                            </Dropdown>
                        </Flex>
                        <div className="workspace-tree-content">
                            <Flex align="center" gap={8} className="workspace-list-toolbar">
                                <Input
                                    className="workspace-list-search"
                                    size="small"
                                    aria-label="Search skills"
                                    allowClear
                                    prefix={<SearchOutlined />}
                                    value={filter}
                                    onChange={(event) => setFilter(event.target.value)}
                                    disabled={isBusy}
                                />
                                {listView === "installed" && buckets.length > 0
                                    ? <Select size="small" aria-label="Filter by origin" value={originFilter} options={originItems} onChange={setOriginFilter} className="workspace-list-filter" />
                                    : null}
                            </Flex>
                            {listView === "installed" ? installedContent : discoverContent}
                        </div>
                    </div>
                </Splitter.Panel>
                <Splitter.Panel min="55%">
                    {listView === "installed" ? <SkillContentPane workspace={workspace} skill={selectedSkill} />
                        : <DiscoveredSkillPane skill={selectedRemoteSkill} isInstalled={isSelectedRemoteInstalled}
                            canInstall={Boolean(selectedRemoteSkill && selectableRemoteIds.has(selectedRemoteSkill.id))} isBusy={isBusy} onInstall={handleDownload} />}
                </Splitter.Panel>
            </Splitter>

            <Modal open={updateDetails.length > 0} title="Review Skill updates" width={1000} okText="Apply reviewed versions" confirmLoading={isBusy}
                onOk={handleConfirmUpdates} onCancel={() => setUpdateDetails([])} destroyOnHidden>
                <Space orientation="vertical" style={{ width: "100%" }}>
                    {updateDetails.map((detail) =>
                    {
                        const diff = diffLines(detail.oldText, detail.newText);
                        return <Card key={detail.previewId} title={detail.id} size="small" style={{ width: "100%" }}>
                            <Typography.Paragraph>Commit: <Typography.Text code>{detail.oldCommit ?? "Legacy source (no pinned commit)"}</Typography.Text> → <Typography.Text code>{detail.newCommit}</Typography.Text></Typography.Paragraph>
                            <Table size="small" rowKey="path" dataSource={detail.files} pagination={{ pageSize: 8, showSizeChanger: false }} columns={[{ title: "File", dataIndex: "path" }, { title: "Change", dataIndex: "status" }]} />
                            <Row gutter={[12, 12]}>
                                <Col xs={24} md={12}><Typography.Text strong>Installed SKILL.md</Typography.Text><DiffText lines={diff.local} label="Installed SKILL.md differences" /></Col>
                                <Col xs={24} md={12}><Typography.Text strong>Reviewed SKILL.md</Typography.Text><DiffText lines={diff.remote} label="Reviewed SKILL.md differences" /></Col>
                            </Row>
                            {detail.truncated || diff.limited ? <Alert type="info" title="Text preview is bounded; file changes and the selected commit apply to the entire Skill." /> : null}
                        </Card>;
                    })}
                </Space>
            </Modal>

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
                {userSkills.length === 0 ? <Empty description={<>No importable skills found in <code>%USERPROFILE%\.agents\skills</code></>} /> : (
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
                        useAppStore.getState().clearEditorDraft(selectionKey({ kind: "skill", id: removeId }));
                        showSuccess("Skill removed", `Removed ${removeId}`);
                        setRemoveId(undefined);
                        await refreshWorkspace();
                    });
                }}
            >
                Remove {removeId ?? ""} from this project?
            </Modal>
        </>
    );
}
