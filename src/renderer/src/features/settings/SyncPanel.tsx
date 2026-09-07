/** Manual private-repository sync with reviewed first-use adoption and explicit conflict choices. */

import { GithubOutlined, SyncOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Col, Form, Input, Modal, Row, Select, Space, Table, Typography } from "antd";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import type { SyncApplyInput, SyncChange, SyncChoice, SyncConnectionInput, SyncDetail, SyncFileView, SyncStatus } from "@shared/models/Sync";
import { useAppStore, workspaceChangeCount } from "@/stores/AppStore";

/** Render bounded text and binary metadata without interpreting remote content as HTML. */
function SyncFileContent({ label, value }: { label: string; value: SyncFileView | null })
{
    return (
        <Card size="small" title={label}>
            {!value ? <Typography.Text type="secondary">Absent / deleted</Typography.Text> : (
                <Space orientation="vertical" size="small" style={{ width: "100%" }}>
                    <Typography.Text type="secondary">{value.bytes.toLocaleString()} bytes</Typography.Text>
                    {value.text === null ? <Typography.Text>Binary file. SHA: {value.hash}</Typography.Text> : (
                        <pre style={{ margin: 0, maxHeight: 320, overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{value.text || "(empty file)"}</pre>
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

/** Configure GitHub sync and review changes through the typed Main capability. */
export function SyncPanel()
{
    const [form] = Form.useForm<SyncConnectionInput>();
    const [status, setStatus] = useState<SyncStatus>();
    const preview = useAppStore((state) => state.syncPreview);
    const setPreview = useAppStore((state) => state.setSyncPreview);
    const [choices, setChoices] = useState<Record<string, SyncChoice>>({});
    const [mode, setMode] = useState<SyncApplyInput["mode"]>("merge");
    const [detail, setDetail] = useState<{ key: string; content: SyncDetail }>();
    const [error, setError] = useState("");
    const [isConnecting, setIsConnecting] = useState(false);
    const isBusy = useAppStore((state) => state.isBusy);
    const dirtyCount = useAppStore(workspaceChangeCount);
    const unresolved = preview?.changes.filter((change) => change.direction === "conflict" && !choices[change.key]).length ?? 0;

    useEffect(() =>
    {
        void window.appApi.sync.status().then((next) =>
        {
            setStatus(next);
            if (next.connected) form.setFieldsValue({ owner: next.owner, repository: next.repository, branch: next.branch });
        }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
    }, [form]);

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
            const message = cause instanceof Error ? cause.message : String(cause);
            setError(message);
            state.setOutput(message, "error", "GitHub Sync failed");
        }
        finally
        {
            await window.appApi.sync.status().then(setStatus).catch(() => undefined);
            state.setIsBusy(false);
        }
    }

    /** Preview exact saved source versions, recovering an interrupted upload when necessary. */
    async function handlePreview(): Promise<void>
    {
        if (workspaceChangeCount(useAppStore.getState())) throw new Error("Save or discard workspace drafts before syncing.");
        setPreview(undefined);
        const next = await window.appApi.sync.preview();
        if (next.notice) await reloadSyncedWorkspace();
        setPreview(next);
        setChoices({});
        setMode("merge");
    }

    /** Apply only the reviewed preview and refresh the local editor's saved baseline. */
    async function handleApply(): Promise<void>
    {
        if (!preview) return;
        if (workspaceChangeCount(useAppStore.getState())) throw new Error("Save or discard workspace drafts, then preview again.");
        try
        {
            const result = await window.appApi.sync.apply({ previewId: preview.id, mode, choices });
            await reloadSyncedWorkspace();
            setStatus(result.status);
            useAppStore.getState().setOutput(result.message, "success", "GitHub Sync complete");
        }
        finally
        {
            setPreview(undefined);
        }
    }

    return (
        <Card title="GitHub Sync" extra={<GithubOutlined />} className="settings-card">
            <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
                <Typography.Paragraph style={{ marginBottom: 0 }}>
                    Sync saved configuration and installed Skills between devices using a private GitHub repository. Each device runs Setup separately.
                </Typography.Paragraph>
                {error ? <Alert type="error" showIcon title={error} /> : null}
                {status?.connected ? (
                    <Space orientation="vertical" size="small" style={{ width: "100%" }}>
                        <Typography.Text strong>{status.owner}/{status.repository} · {status.branch}</Typography.Text>
                        <Typography.Text type="secondary">Last synced: {status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString() : "Not yet synced"}</Typography.Text>
                        <Space wrap>
                            <Button icon={<SyncOutlined />} disabled={isBusy || dirtyCount > 0} onClick={() => void run(handlePreview)}>Preview changes</Button>
                            <Button disabled={isBusy} onClick={() => setIsConnecting(!isConnecting)}>Update connection</Button>
                            <Button disabled={isBusy} onClick={() => void run(async () =>
                            {
                                setStatus(await window.appApi.sync.disconnect());
                                setPreview(undefined);
                                setIsConnecting(false);
                                form.setFieldValue("token", "");
                            })}>Disconnect</Button>
                        </Space>
                    </Space>
                ) : null}
                {!status?.connected || isConnecting ? (
                    <Form form={form} layout="vertical" initialValues={{ branch: "main" }} requiredMark={false} disabled={isBusy} onFinish={(values) => void run(async () =>
                    {
                        try
                        {
                            setStatus(await window.appApi.sync.connect(values));
                            setPreview(undefined);
                            setIsConnecting(false);
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
                        <Typography.Paragraph type="secondary">
                            Create a private repository with a README first. Sync uses its harness-align/ directory and preserves other repository files.
                        </Typography.Paragraph>
                        <Button type="primary" htmlType="submit" loading={isBusy}>{status?.connected ? "Save connection" : "Connect"}</Button>
                    </Form>
                ) : null}
                {dirtyCount > 0 ? <Alert type="warning" showIcon title="Save or discard workspace drafts before previewing or applying sync." /> : null}
                {status?.hasPendingUpload ? <Alert type="warning" showIcon title="An earlier sync needs recovery. Preview changes to check its remote result before retrying." /> : null}
                {preview ? (
                    <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
                        {preview.notice ? <Alert type="info" showIcon title={preview.notice} /> : null}
                        {preview.firstSync && !preview.remoteEmpty ? (
                            <Form layout="vertical" requiredMark={false}>
                                <Form.Item label="First sync" extra="Merge combines independent changes. Adopting one side also applies its deletions after you click Sync now.">
                                    <Select value={mode} onChange={setMode} aria-label="First sync strategy" options={[
                                        { value: "merge", label: "Merge local and remote" },
                                        { value: "local", label: "Use this device's complete configuration" },
                                        { value: "remote", label: "Use the remote's complete configuration" },
                                    ]} />
                                </Form.Item>
                            </Form>
                        ) : null}
                        <Typography.Text>{preview.uploadCount} pending upload groups · {preview.downloadCount} pending download groups · {unresolved} unresolved conflicts</Typography.Text>
                        {mode !== "merge" ? <Alert type="warning" showIcon title={mode === "local"
                            ? "The remote configuration will be replaced by this device's configuration."
                            : "This device's configuration will be replaced by the remote configuration. A local backup is kept."} /> : null}
                        <Table<SyncChange> size="small" rowKey="key" dataSource={preview.changes} pagination={{ pageSize: 10, showSizeChanger: false }} scroll={{ x: 620 }} columns={[
                            { title: "Source", dataIndex: "key", render: (value: string) => <Typography.Text code>{value}</Typography.Text> },
                            { title: "Change", dataIndex: "direction" },
                            { title: "Decision", render: (_, change) => change.direction === "conflict" ? (
                                <Select<SyncChoice> aria-label={`Resolve ${change.key}`} placeholder="Choose a version" value={choices[change.key] ?? null} disabled={mode !== "merge"}
                                                    style={{ minWidth: 170 }} onChange={(value) => setChoices((current) => ({ ...current, [change.key]: value }))}
                                                    options={[{ value: "local", label: "Keep local" }, { value: "remote", label: "Keep remote" }]} />
                            ) : <Typography.Text type="secondary">Automatic</Typography.Text> },
                            { title: "Compare", render: (_, change) => (
                                <Button type="link" onClick={() => void run(async () => setDetail({ key: change.key, content: await window.appApi.sync.inspect(preview.id, change.key) }))}>
                                    View versions
                                </Button>
                            ) },
                        ]} />
                        <Space wrap>
                            <Button type="primary" icon={<SyncOutlined />} disabled={isBusy || dirtyCount > 0 || mode === "merge" && unresolved > 0} onClick={() => void run(handleApply)}>
                                Sync now
                            </Button>
                            <Button disabled={isBusy} onClick={() => setPreview(undefined)}>Cancel preview</Button>
                        </Space>
                    </Space>
                ) : null}
            </Space>
            <Modal open={Boolean(detail)} title={`Compare: ${detail?.key ?? ""}`} width={1000} footer={null} onCancel={() => setDetail(undefined)} destroyOnHidden>
                <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
                    {detail?.content.files.length === 0 ? <Typography.Text>This change adds or removes an empty directory.</Typography.Text> : null}
                    {detail?.content.files.map((file) => (
                        <div key={file.path} style={{ width: "100%" }}>
                            <Typography.Paragraph code>{file.path}</Typography.Paragraph>
                            <Row gutter={[12, 12]}>
                                <Col xs={24} md={12}><SyncFileContent label="Local" value={file.local} /></Col>
                                <Col xs={24} md={12}><SyncFileContent label="Remote" value={file.remote} /></Col>
                            </Row>
                        </div>
                    ))}
                    {detail?.content.omittedFiles ? (
                        <Alert type="info" title={`${detail.content.omittedFiles} additional files omitted from this preview. The decision applies to the entire source group.`} />
                    ) : null}
                </Space>
            </Modal>
        </Card>
    );
}
