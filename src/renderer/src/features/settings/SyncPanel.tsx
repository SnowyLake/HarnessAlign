/** Manual private-repository sync with reviewed first-use adoption and explicit conflict choices. */

import { FileTextOutlined, ReloadOutlined, SyncOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Col, Empty, Flex, Form, Input, Modal, Popconfirm, Row, Select, Space, Spin, Tabs, Typography } from "antd";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import type { SyncApplyInput, SyncChoice, SyncConnectionInput, SyncDetail, SyncFileChange, SyncFileChoice, SyncFileView } from "@shared/models/Sync";
import { noteSyncPreview } from "@/features/workspace/WorkspaceTasks";
import { useAppStore, workspaceChangeCount } from "@/stores/AppStore";
import { showError, showSuccess } from "@/components/common/Feedback";
import { DiffText } from "@/components/common/DiffText";
import { diffLines, type DiffLine } from "@/lib/TextDiff";

const CREATE_TOKEN_URL = "https://github.com/settings/personal-access-tokens/new?name=HarnessAlign-Sync&expires_in=90&contents=write";
const MANAGE_TOKENS_URL = "https://github.com/settings/personal-access-tokens";
const FILE_ACTION_LABELS: Record<SyncFileChange["action"], string> = {
    unchanged: "Unchanged", upload: "Local → Remote", apply: "Remote → Local", "upload-apply": "Update both",
    stop: "Stop syncing", conflict: "Resolve conflict", unavailable: "Pending",
};

/** Render bounded text and binary metadata without interpreting remote content as HTML. */
function SyncFileContent({ label, value, lines }: { label: string; value: SyncFileView | null; lines?: DiffLine[] })
{
    return (
        <Card size="small" title={label} className="sync-content-pane">
            {!value ? <Typography.Text type="secondary">Absent / deleted</Typography.Text> : (
                <Space orientation="vertical" size="small" style={{ width: "100%" }}>
                    {value.text === null ? <Typography.Text>Binary file. SHA: {value.hash}</Typography.Text> : (
                        lines ? <DiffText lines={lines} label={`${label} differences`} /> : <pre style={{ margin: 0, maxHeight: "none", overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{value.text || "(empty file)"}</pre>
                    )}
                    {value.truncated ? <Typography.Text type="warning">Preview limited to 16,000 characters.</Typography.Text> : null}
                </Space>
            )}
        </Card>
    );
}

/** Replace renderer baselines after sync so incoming Layer choices are not retained as local drafts. */
async function reloadSyncedWorkspace(): Promise<void>
{
    const workspace = await window.appApi.workspace.load();
    const state = useAppStore.getState();
    flushSync(() => state.setWorkspace(undefined));
    state.setWorkspace(workspace);
}

/** Keep one sync controller mounted across navigation and workspace refreshes. */
export function SyncPanel()
{
    const [form] = Form.useForm<SyncConnectionInput>();
    const workspace = useAppStore((state) => state.workspace);
    const status = useAppStore((state) => state.syncStatus);
    const setStatus = useAppStore((state) => state.setSyncStatus);
    const dialog = useAppStore((state) => state.syncDialog);
    const setDialog = useAppStore((state) => state.setSyncDialog);
    const preview = useAppStore((state) => state.syncPreview);
    const setPreview = useAppStore((state) => state.setSyncPreview);
    const [choices, setChoices] = useState<Record<string, SyncChoice>>({});
    const [fileChoices, setFileChoices] = useState<Record<string, SyncFileChoice>>({});
    const [mode, setMode] = useState<SyncApplyInput["mode"]>("merge");
    const [detail, setDetail] = useState<{ key: string; content: SyncDetail }>();
    const [error, setError] = useState("");
    const [selectedKey, setSelectedKey] = useState<string>();
    const [showUnchanged, setShowUnchanged] = useState(false);
    const [detailError, setDetailError] = useState("");
    const [isConnecting, setIsConnecting] = useState(false);
    const isBusy = useAppStore((state) => state.isBusy);
    const dirtyCount = useAppStore(workspaceChangeCount);
    const unresolved = preview?.unresolvedCount ?? 0;
    const isConnection = dialog === "connection" || !status?.connected;
    const sourceChanges = preview?.changes.filter((change) => change.direction !== "same" && (!change.key.startsWith("harness-files/") || change.key.endsWith("/"))) ?? [];
    const visibleFiles = preview?.fileChanges.filter((file) => showUnchanged || file.action !== "unchanged" || file.key === selectedKey) ?? [];
    const unchangedCount = preview?.fileChanges.filter((file) => file.action === "unchanged").length ?? 0;
    const reviewKeys = [...visibleFiles.map((file) => file.key), ...sourceChanges.map((change) => change.key)];
    const activeKey = selectedKey && reviewKeys.includes(selectedKey) ? selectedKey : reviewKeys[0];
    const activeFile = preview?.fileChanges.find((file) => file.key === activeKey);
    const activeSource = sourceChanges.find((change) => change.key === activeKey);

    useEffect(() =>
    {
        let cancelled = false;
        setDetail(undefined);
        setDetailError("");
        if (dialog !== "review" || !preview || !activeKey) return;
        void window.appApi.sync.inspect(preview.id, activeKey).then((content) =>
        {
            if (!cancelled) setDetail({ key: activeKey, content });
        }).catch((cause: unknown) =>
        {
            if (cancelled) return;
            setDetailError("Unable to load comparison. Refresh to try again.");
            showError(cause, "Comparison unavailable");
        });
        return () => { cancelled = true; };
    }, [dialog, preview?.id, activeKey]);


    useEffect(() =>
    {
        let cancelled = false;
        void window.appApi.sync.status().then((next) =>
        {
            if (cancelled) return;
            setStatus(next);
            if (next.connected) form.setFieldsValue({ owner: next.owner, repository: next.repository, branch: next.branch });
        }).catch((cause: unknown) =>
        {
            if (cancelled) return;
            const previous = useAppStore.getState().syncStatus;
            if (previous) setStatus({ ...previous, localState: "unknown" });
            setError("Sync status unavailable. See Console for details.");
            showError(cause, "Sync status unavailable");
        });
        return () => { cancelled = true; };
    }, [form, setStatus, workspace]);

    useEffect(() =>
    {
        if (dialog === "review" && status?.connected) void run(handlePreview);
    }, [dialog, status?.connected]);

    /** Close the dialog without retaining a credential typed into an unfinished form. */
    function handleClose(): void
    {
        if (useAppStore.getState().isBusy) return;
        form.setFieldValue("token", "");
        setIsConnecting(false);
        setDetail(undefined);
        setError("");
        setDialog(undefined);
    }

    /** Share the existing busy boundary so editors cannot mutate files during a sync operation. */
    async function run(work: () => Promise<void>): Promise<void>
    {
        const state = useAppStore.getState();
        if (state.isBusy) return;
        state.setIsBusy(true);
        setError("");
        try
        {
            await work();
        }
        catch (cause)
        {
            setError("Sync failed. See Console for details.");
            showError(cause, "Sync failed");
        }
        finally
        {
            await window.appApi.sync.status().then(setStatus).catch((cause: unknown) =>
            {
                const previous = useAppStore.getState().syncStatus;
                if (previous) setStatus({ ...previous, localState: "unknown" });
                showError(cause, "Sync status refresh failed");
            });
            state.setIsBusy(false);
        }
    }

    /** Read current actual files and saved versions without recovering or writing sources. */
    async function handlePreview(): Promise<void>
    {
        if (workspaceChangeCount(useAppStore.getState())) throw new Error("Save or discard workspace drafts before syncing.");
        setPreview(undefined);
        const next = await window.appApi.sync.preview();
        noteSyncPreview(next);
        setPreview(next);
        setChoices({});
        setFileChoices({});
        setMode(next.remoteEmpty ? "initialize" : "merge");
    }

    /** Ask Main to show the new final effects before allowing the changed decisions to execute. */
    async function handlePlan(nextMode = mode, nextChoices = choices, nextFileChoices = fileChoices): Promise<void>
    {
        if (!preview) return;
        const next = await window.appApi.sync.plan({ previewId: preview.id, mode: nextMode, choices: nextChoices, fileChoices: nextFileChoices });
        setSelectedKey(activeKey);
        setMode(nextMode);
        setChoices(nextChoices);
        setFileChoices(nextFileChoices);
        setPreview(next);
        noteSyncPreview(next);
        setDetail(undefined);
    }

    /** Resume only previously confirmed work; the next preview remains a read-only operation. */
    async function handleResume(): Promise<void>
    {
        const result = await window.appApi.sync.resume();
        await reloadSyncedWorkspace();
        setStatus(result.status);
        if (result.applicationPending) setError(result.message);
        else showSuccess("Confirmed sync resumed", result.message);
        await handlePreview();
    }

    /** Apply only the reviewed preview and refresh the local editor's saved baseline. */
    async function handleApply(): Promise<void>
    {
        if (!preview) return;
        if (workspaceChangeCount(useAppStore.getState())) throw new Error("Save or discard workspace drafts, then preview again.");
        try
        {
            const result = await window.appApi.sync.apply({ previewId: preview.id });
            noteSyncPreview(undefined);
            await reloadSyncedWorkspace();
            setStatus(result.status);
            if (result.applicationPending)
            {
                setError(result.message);
                await handlePreview();
            }
            else
            {
                showSuccess("Sync complete", result.message);
                setPreview(undefined);
                setDialog(undefined);
            }
        }
        catch (cause)
        {
            setPreview(undefined);
            throw cause;
        }
    }

    /** Restore only the selected source and refresh both the editor and sync preview immediately. */
    async function handleDiscard(key: string): Promise<void>
    {
        if (!preview) return;
        if (workspaceChangeCount(useAppStore.getState())) throw new Error("Save or discard workspace drafts, then preview again.");
        const result = await window.appApi.sync.discard({ previewId: preview.id, key });
        setPreview(undefined);
        setDetail(undefined);
        await reloadSyncedWorkspace();
        showSuccess("Local changes discarded", result.message);
        await handlePreview();
    }

    return (
        <>
            <Modal open={dialog !== undefined} title={isConnection ? "Remote connection" : `Sync · ${status?.owner}/${status?.repository} · ${status?.branch}`} width={isConnection ? 680 : 1280} centered
                   forceRender onCancel={handleClose} closable={!isBusy} styles={{ body: { maxHeight: "78vh", overflowY: "auto" } }}
                   footer={!isConnection && status?.connected ? (
                       <Flex justify="space-between" align="center" gap={12} wrap>
                           <Typography.Text type={unresolved ? "warning" : "secondary"}>{preview ? `${preview.uploadCount} uploads · ${preview.downloadCount} downloads${preview.applyCount ? ` · ${preview.applyCount} Local updates` : ""}${unresolved ? ` · ${unresolved} unresolved` : ""}` : ""}</Typography.Text>
                           <Space wrap>
                               <Button disabled={isBusy || dirtyCount > 0} icon={<ReloadOutlined />} loading={isBusy} onClick={() => void run(handlePreview)}>Refresh</Button>
                               {status.hasPendingUpload || status.hasPendingApplication ? <Button disabled={isBusy || dirtyCount > 0} onClick={() => void run(handleResume)}>Resume sync</Button> : null}
                               <Button type="primary" icon={<SyncOutlined />} disabled={!preview || isBusy || dirtyCount > 0 || unresolved > 0 || preview.recoveryRequired}
                                   onClick={() => void run(handleApply)}>{preview?.remoteEmpty ? "Initialize archive" : "Sync now"}</Button>
                           </Space>
                       </Flex>
                   ) : null}>
                <div inert={isBusy} aria-busy={isBusy}>
                    <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
                        {error ? <Alert type="error" showIcon title={error} /> : null}
                        {status?.connected && isConnection ? (
                            <Space orientation="vertical" size="small" style={{ width: "100%" }}>
                                <Typography.Text strong>{status.owner}/{status.repository} · {status.branch}</Typography.Text>
                                <Typography.Text type="secondary">Last synced: {status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString() : "Not yet synced"}</Typography.Text>
                                {isConnection ? <Space wrap>
                                    <Button disabled={isBusy} onClick={() => setIsConnecting(!isConnecting)}>Update connection</Button>
                                    <Button danger disabled={isBusy} onClick={() => void run(async () =>
                                    {
                                        setStatus(await window.appApi.sync.disconnect());
                                        noteSyncPreview(undefined);
                                        showSuccess("Remote disconnected");
                                        setPreview(undefined);
                                        setIsConnecting(false);
                                        form.setFieldValue("token", "");
                                    })}>Disconnect</Button>
                                </Space> : null}
                            </Space>
                        ) : null}
                        {isConnection && (!status?.connected || isConnecting) ? (
                            <Form form={form} layout="vertical" initialValues={{ branch: "main" }} requiredMark={false} disabled={isBusy} onFinish={(values) => void run(async () =>
                            {
                                try
                                {
                                    setStatus(await window.appApi.sync.connect(values));
                                    noteSyncPreview(undefined);
                                    showSuccess("Remote connected", `${values.owner}/${values.repository} (${values.branch})`);
                                    setPreview(undefined);
                                    setIsConnecting(false);
                                    setDialog(undefined);
                                }
                                finally
                                {
                                    form.setFieldValue("token", "");
                                }
                            })}>
                                <Row gutter={16}>
                                    <Col xs={24} md={8}><Form.Item name="owner" label="Owner" rules={[{ required: true }]}><Input autoComplete="off" placeholder="GitHub username" /></Form.Item></Col>
                                    <Col xs={24} md={8}>
                                        <Form.Item name="repository" label="Private repository" rules={[{ required: true }]}><Input autoComplete="off" placeholder="harness-align-config" /></Form.Item>
                                    </Col>
                                    <Col xs={24} md={8}><Form.Item name="branch" label="Existing branch" rules={[{ required: true }]}><Input autoComplete="off" /></Form.Item></Col>
                                </Row>
                                <Form.Item name="token" label="Fine-grained personal access token" rules={[{ required: true }]}
                                           extra="Select only this repository with Contents: Read and write. The token is encrypted on this device and is never synced.">
                                    <Input.Password autoComplete="new-password" />
                                </Form.Item>
                                <Form.Item extra="The template prefills the name, a 90-day expiry and Contents permission. Select only your sync repository, then paste the generated token above.">
                                    <Space wrap>
                                        <Button onClick={() => void run(() => window.appApi.app.openExternal(CREATE_TOKEN_URL))}>Create token on GitHub</Button>
                                        <Button type="link" onClick={() => void run(() => window.appApi.app.openExternal(MANAGE_TOKENS_URL))}>Manage tokens</Button>
                                    </Space>
                                </Form.Item>
                                <Typography.Paragraph type="secondary">
                                    Use a private repository with an existing branch, such as one initialized with a README.
                                </Typography.Paragraph>
                                <Button type="primary" htmlType="submit" loading={isBusy}>{status?.connected ? "Save connection" : "Connect"}</Button>
                            </Form>
                        ) : null}
                        {dirtyCount > 0 ? <Alert type="warning" showIcon title="Save or discard workspace drafts before previewing or applying sync." /> : null}
                        {status?.hasPendingUpload ? <Alert type="warning" showIcon title="An earlier confirmed sync needs recovery. Resume it before starting another sync." /> : null}
                        {!isConnection && preview ? (
                            <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
                                {preview.notice ? <Typography.Paragraph type="secondary" className="sync-notice">{preview.notice}</Typography.Paragraph> : null}
                                {preview.planError ? <Alert type="error" showIcon title="The selected result is not a valid configuration" description={preview.planError} /> : null}
                                {preview.remoteEmpty ? <Alert type="warning" showIcon title="No Harness Align archive exists in this repository."
                                    description="Initialize archive uploads this device's saved configuration to the selected repository. Other repository files are kept. Normal sync and local restoration are unavailable until initialization completes." /> : null}
                                {preview.firstSync && !preview.remoteEmpty ? (
                                    <Form layout="vertical" requiredMark={false}>
                                        <Form.Item label="First sync" extra="Merge combines independent changes. Adopting one side also applies its deletions after you click Sync now.">
                                            <Select value={mode} onChange={(value) => void run(() => handlePlan(value, choices, {}))} aria-label="First sync strategy" options={[
                                                { value: "merge", label: "Merge local and remote" },
                                                { value: "local", label: "Use Local configuration" },
                                                { value: "remote", label: "Use Remote configuration" },
                                            ]} />
                                        </Form.Item>
                                    </Form>
                                ) : null}
                                {mode === "local" || mode === "remote" ? <Alert type="warning" showIcon title={mode === "local"
                                    ? "Remote will be replaced with Local, including deletions."
                                    : "Local will be replaced with Remote, including deletions. A backup is kept."} /> : null}
                                <div className="sync-review">
                                    <nav className="file-browser-list" aria-label="Sync changes">
                                        {visibleFiles.length ? <div className="file-browser-group">Files</div> : null}
                                        {visibleFiles.map((file) => <Button key={file.key} type="text" className={`file-browser-item${activeKey === file.key ? " is-selected" : ""}`}
                                            aria-pressed={activeKey === file.key} onClick={() => setSelectedKey(file.key)} icon={<FileTextOutlined />}>
                                            <span className="file-browser-item-text"><span>{file.target}</span>
                                                <span className={`file-browser-item-status${file.needsChoice ? " needs-choice" : ""}`}>{FILE_ACTION_LABELS[file.action]}</span>
                                            </span>
                                        </Button>)}
                                        {sourceChanges.length ? <div className="file-browser-group">Configuration</div> : null}
                                        {sourceChanges.map((change) => <Button key={change.key} type="text" className={`file-browser-item${activeKey === change.key ? " is-selected" : ""}`}
                                            aria-pressed={activeKey === change.key} onClick={() => setSelectedKey(change.key)} icon={<FileTextOutlined />}>
                                            <span className="file-browser-item-text"><span>{change.key}</span><span className="file-browser-item-status">
                                                {change.direction === "conflict" ? choices[change.key] ? `Use ${choices[change.key] === "local" ? "Local" : "Remote"}` : "Resolve conflict"
                                                    : change.direction === "upload" ? "Local → Remote" : "Remote → Local"}
                                            </span></span>
                                        </Button>)}
                                        {unchangedCount ? <Button type="link" className="file-browser-show" onClick={() =>
                                        {
                                            if (showUnchanged && activeFile?.action === "unchanged") setSelectedKey(undefined);
                                            setShowUnchanged(!showUnchanged);
                                        }}>
                                            {showUnchanged ? "Hide unchanged" : `Show ${unchangedCount} unchanged`}
                                        </Button> : null}
                                    </nav>
                                    <div className="sync-review-detail">
                                        {activeKey ? <>
                                            <Flex align="center" justify="space-between" gap={12} wrap className="file-browser-detail-header">
                                                <Typography.Text strong className="file-browser-path">{activeFile?.target ?? activeKey}</Typography.Text>
                                                {activeFile ? <Select<SyncFileChoice | "auto"> aria-label={`Version for ${activeKey}`} style={{ width: 180 }}
                                                    value={fileChoices[activeKey.toLowerCase()] ?? "auto"} status={activeFile.needsChoice ? "error" : ""} onChange={(value) =>
                                                    {
                                                        const next = { ...fileChoices };
                                                        if (value === "auto") delete next[activeKey.toLowerCase()]; else next[activeKey.toLowerCase()] = value;
                                                        void run(() => handlePlan(mode, choices, next));
                                                    }} options={[
                                                        { value: "auto", label: activeFile.needsChoice ? "Choose a version" : "Automatic" },
                                                        { value: "target", label: "Use Local", disabled: !activeFile.canUseTarget || mode === "remote" },
                                                        { value: "remote", label: "Use Remote", disabled: !activeFile.canUseSource || activeFile.state === "unsafe" },
                                                        ...(activeFile.hasLegacy ? [{ value: "legacy", label: "Restore legacy change" }] : []),
                                                        { value: "stop", label: "Stop syncing" },
                                                    ]} /> : activeSource?.direction === "conflict" ? <Select<SyncChoice> aria-label={`Version for ${activeKey}`} placeholder="Choose a version"
                                                        value={choices[activeKey] ?? null} disabled={mode !== "merge"} style={{ width: 180 }}
                                                        onChange={(value) => void run(() => handlePlan(mode, { ...choices, [activeKey]: value }))}
                                                        options={[{ value: "local", label: "Use Local" }, { value: "remote", label: "Use Remote" }]} /> : null}
                                            </Flex>
                                            {activeFile?.error ? <Alert type="warning" showIcon title={activeFile.error} /> : null}
                                            {activeFile?.action === "stop" ? <Typography.Paragraph type="secondary">Local files are kept on every device.</Typography.Paragraph> : null}
                                            {detailError ? <Alert type="error" showIcon title={detailError} /> : detail?.key === activeKey ? <SyncComparison detail={detail} />
                                                : <div className="sync-loading" role="status"><Spin /><span>Loading comparison...</span></div>}
                                            {!preview.remoteEmpty && activeSource && !activeKey.startsWith("harness-files/") && (activeSource.direction === "upload" || activeSource.direction === "conflict")
                                                && (!activeKey.endsWith("/") || activeSource.paths.length > 0) ? <Popconfirm title="Discard Local changes?"
                                                    description="Restore Remote now. If absent remotely, the Local source is removed. This applies to the entire source group."
                                                    okText="Discard" okButtonProps={{ danger: true }} onConfirm={() => run(() => handleDiscard(activeKey))}>
                                                    <Button type="text" danger disabled={isBusy || dirtyCount > 0 || mode !== "merge"}>Discard Local changes</Button>
                                                </Popconfirm> : null}
                                        </> : <Empty className="file-browser-empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description={preview.remoteEmpty ? "Ready to initialize" : "No changes"} />}
                                    </div>
                                </div>
                            </Space>
                        ) : null}
                    </Space>
                </div>
                {!isConnection && isBusy && !preview ? (
                    <div className="sync-loading" role="status"><Spin /><Typography.Text type="secondary">Loading preview...</Typography.Text></div>
                ) : null}
            </Modal>
        </>
    );
}

/** Show both sync endpoints in place without opening another dialog. */
function SyncComparison({ detail }: { detail: { key: string; content: SyncDetail } })
{
    return <div className="sync-comparison">
        {detail.content.files.length === 0 ? <Typography.Text type="secondary">Empty directory</Typography.Text> : null}
        {detail.content.files.map((file) =>
        {
            const additional = file.path.startsWith("harness-files/");
            const local = additional ? file.actual : file.local;
            const diff = (!local || local.text !== null) && (!file.remote || file.remote.text !== null)
                ? diffLines(local?.text ?? null, file.remote?.text ?? null) : undefined;
            const comparison = <div className="sync-comparison-panes">
                <SyncFileContent label="Local" value={local ?? null} {...diff ? { lines: diff.local } : {}} />
                <SyncFileContent label="Remote" value={file.remote} {...diff ? { lines: diff.remote } : {}} />
            </div>;
            return <div key={file.path}>
                {file.path !== detail.key ? <Typography.Paragraph code>{file.path}</Typography.Paragraph> : null}
                {file.saved ? <Tabs items={[
                    { key: "compare", label: "Local / Remote", children: comparison },
                    { key: "legacy", label: "Legacy change", children: <SyncFileContent label="Legacy change" value={file.saved} /> },
                ]} /> : comparison}
                {diff?.limited ? <Typography.Text type="secondary">Large diff: changed sections are highlighted as a whole.</Typography.Text> : null}
            </div>;
        })}
        {detail.content.omittedFiles ? <Alert type="info" title={`${detail.content.omittedFiles} files omitted. The choice applies to the entire group.`} /> : null}
    </div>;
}
