/** Register local files and inspect them in one list-and-content view. */

import type { HarnessConfig, Workspace } from "@shared/models/Workspace";
import { DisconnectOutlined, FileTextOutlined, PlusOutlined, ReloadOutlined, SyncOutlined } from "@ant-design/icons";
import { Alert, Button, Empty, Flex, Modal, Space, Tooltip, Typography } from "antd";
import { useState } from "react";
import { showSuccess } from "@/components/common/Feedback";
import { SourceEditor, type SourceLanguage } from "@/components/common/SourceEditor";
import { fileSyncStateLabel } from "@/lib/Utils";
import { refreshWorkspace, runMutation } from "@/features/workspace/WorkspaceTasks";
import { useAppStore } from "@/stores/AppStore";

/** Choose the source editor language without adding a TOML mode. */
function harnessFileLanguage(path: string): SourceLanguage
{
    const lower = path.toLowerCase();
    if (lower.endsWith(".json")) return "json";
    if (lower.endsWith(".md")) return "markdown";
    return "plain";
}

/** Keep file selection and content together; hand off to sync without stacking dialogs. */
export function HarnessFiles({ workspace, harness, onReviewSync }: { workspace: Workspace; harness: HarnessConfig; onReviewSync: () => void })
{
    const isBusy = useAppStore((state) => state.isBusy);
    const files = workspace.harnessFiles.filter((file) => file.harness === harness.name);
    const [removePath, setRemovePath] = useState<string>();
    const [selectedPath, setSelectedPath] = useState<string>();
    const selected = files.find((file) => file.path === selectedPath) ?? files[0];
    /** Register the selected local path and reveal its content. */
    const addFile = (): void =>
    {
        void runMutation(async () =>
        {
            const path = await window.appApi.workspace.addHarnessFile(harness.name);
            if (path === null) return;
            await refreshWorkspace();
            setSelectedPath(path);
            showSuccess("File added", path);
        });
    };
    /** Stop synchronization while retaining each device's local file. */
    const removeFile = (): void =>
    {
        if (!removePath) return;
        const path = removePath;
        void runMutation(async () =>
        {
            await window.appApi.workspace.removeHarnessFile(harness.name, path);
            setRemovePath(undefined);
            await refreshWorkspace();
            showSuccess("Sync stopped locally", "Sync to update other devices. Local files are kept.");
        });
    };

    return (
        <section className="harness-files" aria-label="Additional files">
            <Flex justify="space-between" align="center" gap={12} wrap className="file-browser-toolbar">
                <Typography.Text type="secondary" code>~/{harness.configPath}</Typography.Text>
                <Space>
                    <Tooltip title="Refresh" trigger={["hover", "focus"]}>
                        <Button icon={<ReloadOutlined />} aria-label="Refresh files" disabled={isBusy} onClick={() => void runMutation(() => refreshWorkspace())} />
                    </Tooltip>
                    <Button icon={<PlusOutlined />} disabled={isBusy} onClick={addFile}>Add file</Button>
                    <Button type="primary" icon={<SyncOutlined />} disabled={isBusy} onClick={onReviewSync}>Review sync</Button>
                </Space>
            </Flex>
            {files.length === 0 ? <Empty className="file-browser-empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description="No additional files" /> : <div className="file-browser">
                <nav className="file-browser-list" aria-label="Files">
                    {files.map((file) => <Button key={file.path} type="text" className={`file-browser-item${selected?.path === file.path ? " is-selected" : ""}`}
                        aria-pressed={selected?.path === file.path} onClick={() => setSelectedPath(file.path)} icon={<FileTextOutlined />}>
                        <span className="file-browser-item-text"><span>{file.path}</span>
                            {file.targetState !== "match" || file.syncState === "migration" ? <span className="file-browser-item-status">{fileSyncStateLabel(file.syncState)}</span> : null}
                        </span>
                    </Button>)}
                </nav>
                <div className="file-browser-detail">
                    {selected ? <>
                        <Flex justify="space-between" align="center" gap={12} wrap className="file-browser-detail-header">
                            <Typography.Text strong className="file-browser-path">{selected.path}</Typography.Text>
                            <Button type="text" icon={<DisconnectOutlined />} disabled={isBusy} aria-label={`Stop syncing ${selected.path}`}
                                    onClick={() => setRemovePath(selected.path)}>Stop syncing</Button>
                        </Flex>
                        {selected.syncState === "migration" ? <Alert type="warning" showIcon title="An unapplied legacy change needs review." /> : null}
                        {selected.targetContent == null ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={fileSyncStateLabel(selected.syncState)} />
                            : <SourceEditor key={`${selected.path}:${selected.targetContent}`} defaultValue={selected.targetContent} language={harnessFileLanguage(selected.path)} readOnly aria-label={`Local ${selected.path}`} />}
                    </> : null}
                </div>
            </div>}
            <Modal open={Boolean(removePath)} title="Stop syncing?" okText="Stop syncing" okButtonProps={{ disabled: isBusy }} confirmLoading={isBusy}
                cancelButtonProps={{ disabled: isBusy }} closable={!isBusy} mask={{ closable: !isBusy }} keyboard={!isBusy} onCancel={() => setRemovePath(undefined)} onOk={removeFile}>
                <Typography.Paragraph code>{removePath}</Typography.Paragraph>
                <Typography.Paragraph>Local files are kept on every device. This takes effect on other devices after syncing.</Typography.Paragraph>
            </Modal>
        </section>
    );
}
