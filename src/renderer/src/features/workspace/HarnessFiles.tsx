/**
 * Additional harness-folder files edited as sync sources.
 * Setup copies these files; this panel never writes the harness folder or GitHub.
 */

import type { HarnessConfig, HarnessFileTargetState, SourceGuard, Workspace } from "@shared/models/Workspace";
import { DeleteOutlined, FileTextOutlined, PlusOutlined } from "@ant-design/icons";
import { Alert, Button, Drawer, Flex, Modal, Space, Tooltip, Typography } from "antd";
import { useState } from "react";
import { showSuccess } from "@/components/common/Feedback";
import { SourceEditor, type SourceLanguage } from "@/components/common/SourceEditor";
import { persistEditorSnapshot, refreshWorkspace, runMutation } from "@/features/workspace/WorkspaceTasks";
import { selectionKey, useAppStore, type Selection } from "@/stores/AppStore";

/** Confirmation shared by the file list, file editor, and deployment review. */
export interface AdoptHarnessFileRequest
{
    harness: string;
    path: string;
    targetLabel: string;
    targetMissing: boolean;
    dirty: boolean;
}

/** Explain one adopt confirmation, including an unsaved editor draft when one exists. */
function adoptHarnessFileCopy(request: AdoptHarnessFileRequest): string
{
    const unsaved = request.dirty ? " Unsaved edits in the editor will also be discarded." : "";
    if (request.targetMissing)
    {
        return `${request.targetLabel} is missing. Adopting it removes ${request.path} from the sync source. GitHub is not updated until you review sync.${unsaved}`;
    }
    return `This replaces the sync source for ${request.targetLabel} with the target file. The current source will be discarded. GitHub is not updated until you review sync.${unsaved}`;
}

/** Choose the source editor language without adding a TOML mode. */
function harnessFileLanguage(path: string): SourceLanguage
{
    const lower = path.toLowerCase();
    if (lower.endsWith(".json")) return "json";
    if (lower.endsWith(".md")) return "markdown";
    return "plain";
}

/** Keep a uniform CRLF or CR file intact. Mixed endings stay on the editor's LF join. */
function harnessFileLineSeparator(content: string): "\r\n" | "\r" | undefined
{
    const withoutPairs = content.replaceAll("\r\n", "");
    if (content.includes("\r\n") && !withoutPairs.includes("\n") && !withoutPairs.includes("\r")) return "\r\n";
    if (!content.includes("\n") && content.includes("\r")) return "\r";
    return undefined;
}

/** Label the comparison between a sync source and its harness-folder copy. */
function harnessFileStatusLabel(state: HarnessFileTargetState | undefined): string
{
    switch (state)
    {
        case "match": return "Matches target";
        case "changed": return "Target changed";
        case "missing": return "Missing on target";
        case "parent-missing": return "Parent folder missing";
        case "unsafe": return "Folder unsafe";
        default: return "Folder missing";
    }
}

/** Format the deployed path shown in confirmations. */
function harnessFileTargetLabel(configPath: string, path: string): string
{
    return `~/${configPath}/${path}`;
}

/** Return the managed source path used as a save guard. */
function harnessFileSourcePath(harness: string, path: string): string
{
    return `.harness-align/harness-files/${harness}/${path}`;
}

/** Keep the revision captured when the draft was opened. */
function harnessFileGuard(workspace: Workspace, harness: string, path: string): SourceGuard
{
    const sourcePath = harnessFileSourcePath(harness, path);
    const draft = useAppStore.getState().editorDrafts[selectionKey({ kind: "harness-file", harness, path })];
    const revisions = draft?.sourceRevisions ?? workspace.sourceRevisions;
    return { path: sourcePath, revision: revisions[sourcePath] ?? null };
}

/** Confirm replacing a sync source with the current harness-folder file. */
export function AdoptHarnessFileModal({ request, isBusy, onCancel, onConfirm }: {
    request: AdoptHarnessFileRequest | undefined;
    isBusy: boolean;
    onCancel: () => void;
    onConfirm: (request: AdoptHarnessFileRequest) => void;
})
{
    return (
        <Modal
            open={Boolean(request)}
            title="Adopt target content?"
            okText="Adopt target content"
            okButtonProps={{ danger: request?.targetMissing === true, disabled: isBusy }}
            confirmLoading={isBusy}
            onCancel={onCancel}
            onOk={() => { if (request) onConfirm(request); }}
        >
            {request ? <Typography.Paragraph>{adoptHarnessFileCopy(request)}</Typography.Paragraph> : null}
        </Modal>
    );
}

/** List, add, edit, and remove additional files for one saved harness. */
export function HarnessFiles({ workspace, harness }: { workspace: Workspace; harness: HarnessConfig })
{
    const isBusy = useAppStore((state) => state.isBusy);
    const drafts = useAppStore((state) => state.editorDrafts);
    const files = workspace.harnessFiles.filter((file) => file.harness === harness.name);
    const [removePath, setRemovePath] = useState<string>();
    const [editingPath, setEditingPath] = useState<string>();
    const [adoptRequest, setAdoptRequest] = useState<AdoptHarnessFileRequest>();
    const editing = files.find((file) => file.path === editingPath);
    const editingSelection: Selection | undefined = editing ? { kind: "harness-file", harness: harness.name, path: editing.path } : undefined;
    const editingKey = editingSelection ? selectionKey(editingSelection) : "";
    const editingDraft = editingKey ? drafts[editingKey] : undefined;
    const targetLabel = (path: string): string => harnessFileTargetLabel(harness.configPath, path);

    /** Store the sync-source draft without changing the open harness selection. */
    const rememberContent = (content: string): void =>
    {
        if (!editing || !editingSelection) return;
        const state = useAppStore.getState();
        if (content === editing.content)
        {
            state.clearEditorDraft(editingKey);
            return;
        }
        const existing = state.editorDrafts[editingKey];
        state.setEditorDraft(editingKey, {
            selection: editingSelection,
            baseline: { content: [editing.content] },
            current: { content: [content] },
            sourceRevisions: existing?.sourceRevisions ?? workspace.sourceRevisions,
        });
    };

    /** Choose an existing harness-folder file in Main and import its current content. */
    const addFile = (): void =>
    {
        void runMutation(async () =>
        {
            const path = await window.appApi.workspace.addHarnessFile(harness.name);
            if (path === null) return;
            await refreshWorkspace();
            showSuccess("Imported", `Imported ${path}`);
        });
    };

    /** Write the editor text to the sync source and leave deployment unchanged. */
    const saveFile = (): void =>
    {
        if (!editing || !editingSelection || !editingDraft) return;
        const content = editingDraft.current.content?.[0] ?? "";
        void runMutation(async () =>
        {
            await persistEditorSnapshot(workspace, editingSelection, { content: [content] });
            useAppStore.getState().clearEditorDraft(editingKey);
            await refreshWorkspace();
            showSuccess("Saved", `Saved ${editing.path}`);
        });
    };

    /** Delete the sync source. Setup later deletes only the deployed file. */
    const removeFile = (): void =>
    {
        if (!removePath) return;
        const path = removePath;
        void runMutation(async () =>
        {
            await window.appApi.workspace.removeHarnessFile(harness.name, path);
            useAppStore.getState().clearEditorDraft(selectionKey({ kind: "harness-file", harness: harness.name, path }));
            if (editingPath === path) setEditingPath(undefined);
            setRemovePath(undefined);
            await refreshWorkspace();
            showSuccess("Removed", `Removed ${path} from ${harness.name}`);
        });
    };

    /** Copy the harness-folder file back into the sync source. */
    const adoptFile = (request: AdoptHarnessFileRequest): void =>
    {
        void runMutation(async () =>
        {
            await window.appApi.workspace.adoptHarnessFile(request.harness, request.path, harnessFileGuard(workspace, request.harness, request.path));
            useAppStore.getState().clearEditorDraft(selectionKey({ kind: "harness-file", harness: request.harness, path: request.path }));
            if (request.targetMissing) setEditingPath(undefined);
            setAdoptRequest(undefined);
            await refreshWorkspace();
            showSuccess(`Adopted ${request.targetLabel} into the sync source.`, "Review sync to upload it.");
        });
    };

    /** Open the shared adopt confirmation for one listed or edited file. */
    const requestAdopt = (path: string, state: HarnessFileTargetState | undefined): void =>
    {
        setAdoptRequest({
            harness: harness.name,
            path,
            targetLabel: targetLabel(path),
            targetMissing: state === "missing",
            dirty: Boolean(drafts[selectionKey({ kind: "harness-file", harness: harness.name, path })]),
        });
    };

    const editorContent = editingDraft?.current.content?.[0] ?? editing?.content ?? "";
    const editorLineSeparator = harnessFileLineSeparator(editorContent);
    const canAdopt = editing?.targetState === "changed" || editing?.targetState === "missing";
    return (
        <section className="harness-files" aria-label="Additional files">
            <Flex justify="space-between" align="center" gap={12} className="workspace-list-toolbar">
                <Typography.Title level={5} style={{ margin: 0 }}>Additional files</Typography.Title>
                <Button size="small" icon={<PlusOutlined aria-hidden="true" />} disabled={isBusy} onClick={addFile}>Add file...</Button>
            </Flex>
            {files.length === 0 ? <Typography.Paragraph type="secondary" className="harness-files-empty">No files added.</Typography.Paragraph> : (
                <ul className="harness-files-list">
                    {files.map((file) => (
                        <li key={file.path} className="app-list-row harness-file-row">
                            <Button type="text" className="harness-file-open" icon={<FileTextOutlined />} disabled={isBusy}
                                    aria-label={`Edit ${file.path}`} onClick={() => setEditingPath(file.path)}>{file.path}</Button>
                            {file.targetState !== "match" ? <Typography.Text type="secondary" className="harness-file-status">
                                {harnessFileStatusLabel(file.targetState)}
                            </Typography.Text> : null}
                            <Tooltip title="Remove file" trigger={["hover", "focus"]}>
                                <Button type="text" size="small" danger icon={<DeleteOutlined />} disabled={isBusy}
                                        aria-label={`Remove ${file.path}`} onClick={() => setRemovePath(file.path)} />
                            </Tooltip>
                        </li>
                    ))}
                </ul>
            )}
            <Typography.Paragraph type="secondary" className="harness-files-note">Synced to GitHub as-is. Keep secrets in environment variables.</Typography.Paragraph>
            <Modal
                open={Boolean(removePath)}
                title={removePath ? `Remove ${removePath} from ${harness.name}?` : "Remove file?"}
                okText="Remove"
                okButtonProps={{ danger: true, disabled: isBusy }}
                confirmLoading={isBusy}
                onCancel={() => setRemovePath(undefined)}
                onOk={removeFile}
            >
                <Typography.Paragraph>
                    {removePath ? `This deletes the sync source. Setup will then delete ${targetLabel(removePath)}. The target stays until Setup runs.` : null}
                </Typography.Paragraph>
            </Modal>
            <AdoptHarnessFileModal request={adoptRequest} isBusy={isBusy} onCancel={() => setAdoptRequest(undefined)} onConfirm={adoptFile} />
            <Drawer
                title={editing ? targetLabel(editing.path) : "Additional file"}
                styles={{ title: { overflowWrap: "anywhere" } }}
                open={Boolean(editing)}
                size={900}
                destroyOnHidden
                footer={editing ? (
                    <Flex justify="space-between" gap={12} wrap>
                        <Button type="text" danger disabled={isBusy} onClick={() => setRemovePath(editing.path)}>Remove</Button>
                        <Space>
                            {canAdopt ? <Button disabled={isBusy} onClick={() => requestAdopt(editing.path, editing.targetState)}>Adopt target content</Button> : null}
                            <Button type="primary" disabled={isBusy || !editingDraft} onClick={saveFile}>Save source</Button>
                        </Space>
                    </Flex>
                ) : null}
                onClose={() => setEditingPath(undefined)}
            >
                {editing ? (
                    <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
                        {editing.targetState === "changed" ? (
                            <Alert type="warning" showIcon title="Target changed. Setup will replace it with this source." />
                        ) : null}
                        {editing.targetState === "missing" ? (
                            <Alert type="info" showIcon title="Missing on target. Setup will create it from this source." />
                        ) : null}
                        {editing.targetState === "parent-missing" ? (
                            <Alert type="warning" showIcon title="Parent folder missing or unavailable. Setup will not create it." />
                        ) : null}
                        {editing.targetState === "unsafe" ? (
                            <Alert type="error" showIcon title="Harness folder unsafe. Setup is blocked." />
                        ) : null}
                        {editing.targetState === "folder-missing" || editing.targetState === undefined ? (
                            <Alert type="warning" showIcon title="Harness folder missing. Setup will skip this harness." />
                        ) : null}
                        <form inert={isBusy} aria-busy={isBusy}
                              onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); saveFile(); }}
                              onInput={(event) => rememberContent(String(new FormData(event.currentTarget).get("content") ?? ""))}>
                            <SourceEditor
                                key={`${editing.path}:${editing.content}`}
                                name="content"
                                defaultValue={editorContent}
                                language={harnessFileLanguage(editing.path)}
                                {...(editorLineSeparator ? { lineSeparator: editorLineSeparator } : {})}
                                aria-label={`Sync source for ${targetLabel(editing.path)}`}
                            />
                        </form>
                    </Space>
                ) : null}
            </Drawer>
        </section>
    );
}
