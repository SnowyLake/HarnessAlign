/**
 * Ant Design workspace editors that preserve native FormData drafts and Main-process path validation.
 */

import { DeleteOutlined, EditOutlined, FolderOutlined, PlusOutlined, SaveOutlined, UndoOutlined } from "@ant-design/icons";
import type { HarnessConfig, Workspace } from "@shared/models/Workspace";
import { Alert, Button, Card, Checkbox, Drawer, Empty, Flex, Form, Input, Modal, Select, Space, Tabs, Tag, Typography } from "antd";
import { useEffect, useLayoutEffect, useRef, useState, type FormEventHandler, type ReactNode, type RefObject } from "react";
import { showError, showSuccess } from "@/components/common/Feedback";
import { SourceEditor } from "@/components/common/SourceEditor";
import { persistEditorSnapshot, refreshWorkspace, runMutation } from "@/features/workspace/WorkspaceTasks";
import { fileName, ruleDisplayName } from "@/lib/Utils";
import { selectionKey, useAppStore, type EditorDraft, type FormSnapshot, type Selection } from "@/stores/AppStore";

/** Form bindings that preserve drafts and respond to tree commands. */
interface EditorFormBinding
{
    draft: EditorDraft | undefined;
    formRef: RefObject<HTMLFormElement | null>;
    handleChange: FormEventHandler<HTMLFormElement>;
    handleValueChange: (name: string, value: string) => void;
    handleSubmit: FormEventHandler<HTMLFormElement>;
    formError: string | undefined;
    mutate: (work: () => Promise<void>) => void;
}

/** Props for a standard destructive confirmation modal. */
interface DeleteModalProps
{
    open: boolean;
    title: string;
    description: ReactNode;
    isBusy: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}

/** Capture text fields and checked checkbox values in deterministic key order. */
function formSnapshot(form: HTMLFormElement): FormSnapshot
{
    const values: Record<string, string[]> = {};
    for (const [name, value] of new FormData(form))
    {
        if (typeof value !== "string") continue;
        (values[name] ??= []).push(value);
    }
    return Object.fromEntries(Object.entries(values).sort(([left], [right]) => left.localeCompare(right)));
}

/** Compare normalized form snapshots without depending on object identity. */
function snapshotsEqual(left: FormSnapshot, right: FormSnapshot): boolean
{
    return JSON.stringify(left) === JSON.stringify(right);
}

/** Read one text field from a saved draft, falling back to the workspace value. */
function draftText(draft: EditorDraft | undefined, name: string, fallback: string): string
{
    return draft?.current[name]?.[0] ?? fallback;
}

/** Read one repeated field from a saved draft, falling back to workspace values. */
function draftValues(draft: EditorDraft | undefined, name: string, fallback: string[] | undefined): string[] | undefined
{
    return draft ? draft.current[name] : fallback;
}

/** Consume the next matching tree command with handlers owned by the mounted editor. */
function useEditorAction(editorKey: string, onSave: (() => void) | undefined, onDelete: (() => void) | undefined): void
{
    const pending = useAppStore((state) => state.pendingEditorAction);
    const consumeEditorAction = useAppStore((state) => state.consumeEditorAction);
    const saveRef = useRef(onSave);
    const deleteRef = useRef(onDelete);
    saveRef.current = onSave;
    deleteRef.current = onDelete;

    useEffect(() =>
    {
        if (!pending || pending.key !== editorKey) return;
        consumeEditorAction(pending.id);
        if (pending.action === "save") saveRef.current?.();
        else deleteRef.current?.();
    }, [consumeEditorAction, editorKey, pending]);
}

/** Bind an uncontrolled native form to persistent drafts and external editor commands. */
function useEditorForm(workspace: Workspace, selection: Selection, onDelete?: () => void, onDone?: () => void): EditorFormBinding
{
    const editorKey = selectionKey(selection);
    const draft = useAppStore((state) => state.editorDrafts[editorKey]);
    const setEditorDraft = useAppStore((state) => state.setEditorDraft);
    const formRef = useRef<HTMLFormElement>(null);
    const baselineRef = useRef<FormSnapshot | undefined>(draft?.baseline);
    const [formError, setFormError] = useState<string>();

    useLayoutEffect(() =>
    {
        if (!formRef.current) return;
        baselineRef.current = draft?.baseline ?? formSnapshot(formRef.current);
    }, [draft?.baseline, editorKey]);

    /** Store a new draft after a native form control changes. */
    const handleChange: FormEventHandler<HTMLFormElement> = (event) =>
    {
        const current = formSnapshot(event.currentTarget);
        const baseline = baselineRef.current ?? current;
        setEditorDraft(editorKey, snapshotsEqual(baseline, current) ? undefined : { selection, baseline, current });
    };

    /** Store a controlled Ant Design field that does not emit a native form change. */
    const handleValueChange = (name: string, value: string): void =>
    {
        if (!formRef.current) return;
        const current = formSnapshot(formRef.current);
        current[name] = [value];
        const baseline = baselineRef.current ?? current;
        setEditorDraft(editorKey, snapshotsEqual(baseline, current) ? undefined : { selection, baseline, current });
    };

    /** Run an editor mutation while sharing the busy guard and inline failure summary. */
    const mutate = (work: () => Promise<void>): void =>
    {
        setFormError(undefined);
        void runMutation(work).then((result) =>
        {
            if (!result.ok) setFormError(result.message);
        });
    };

    /** Capture the native form before asynchronous work and persist its source draft. */
    const handleSubmit: FormEventHandler<HTMLFormElement> = (event) =>
    {
        event.preventDefault();
        const snapshot = formSnapshot(event.currentTarget);
        mutate(async () =>
        {
            await persistEditorForm(workspace, selection, snapshot);
            onDone?.();
        });
    };

    useEditorAction(editorKey, () => formRef.current?.requestSubmit(), onDelete);
    return { draft, formRef, handleChange, handleValueChange, handleSubmit, formError, mutate };
}

/** Persist one mounted editor form and refresh it under the resulting selection. */
async function persistEditorForm(workspace: Workspace, selection: Selection, snapshot: FormSnapshot): Promise<void>
{
    const result = await persistEditorSnapshot(workspace, selection, snapshot);
    const state = useAppStore.getState();
    state.clearEditorDraft(selectionKey(selection));
    state.clearEditorDraft(selectionKey(result.selection));
    showSuccess("Saved", `${result.message}\n${selectionKey(result.selection)}`);
    await refreshWorkspace(result.selection);
}

/** Render the harness allowlist for a rule or layer option. */
function TargetBoxes({ selected }: { selected: string[] | undefined })
{
    const workspace = useAppStore((state) => state.workspace);
    const [targets, setTargets] = useState(selected ?? []);
    return (
        <Form.Item label="Targets" tooltip="Only selected harnesses receive this content."
                   extra={targets.length === 0 ? "No targets selected. This content will not be generated." : undefined}>
            <Checkbox.Group
                name="targets"
                aria-label="Targets"
                options={(workspace?.config.harnesses ?? []).map((harness) => harness.name)}
                value={targets}
                onChange={setTargets}
            />
        </Form.Item>
    );
}

/** Render the short failure summary while Console retains diagnostic details. */
function FormError({ message }: { message: string | undefined })
{
    if (!message) return null;
    return <Alert className="editor-alert" type="error" title={<span className="pre-wrap">{message}</span>} showIcon />;
}

/** Render the standard editor name field. */
function EditorNameField({ value, onChange }: {
    value: string;
    onChange: (value: string) => void;
})
{
    return (
        <Form.Item label="Name" htmlFor="editor-name">
            <Input id="editor-name" name="name" value={value} onChange={(event) => onChange(event.currentTarget.value)} />
        </Form.Item>
    );
}

/** Render a reusable Ant Design destructive confirmation. */
function DeleteModal({ open, title, description, isBusy, onCancel, onConfirm }: DeleteModalProps)
{
    return (
        <Modal
            open={open}
            title={title}
            okText="Delete"
            okButtonProps={{ danger: true }}
            cancelButtonProps={{ disabled: isBusy }}
            confirmLoading={isBusy}
            closable={!isBusy}
            mask={{ closable: !isBusy }}
            keyboard={!isBusy}
            onCancel={onCancel}
            onOk={onConfirm}
        >
            <Typography.Paragraph>{description}</Typography.Paragraph>
        </Modal>
    );
}

/** Render the generated AGENTS.md title setting backed by config.json. */
export function AgentDocumentTitleForm({ workspace }: { workspace: Workspace })
{
    const isBusy = useAppStore((state) => state.isBusy);
    const setSelection = useAppStore((state) => state.setSelection);
    const selection: Selection = { kind: "config" };
    const editor = useEditorForm(workspace, selection);
    const [configName, setConfigName] = useState(draftText(editor.draft, "name", workspace.config.name));

    return (
        <form
            ref={editor.formRef}
            className="editor-form"
            onFocusCapture={() => setSelection(selection)}
            onChange={editor.handleChange}
            onInput={editor.handleChange}
            onSubmit={editor.handleSubmit}
        >
            <Form component={false} layout="vertical" requiredMark={false}>
                <FormError message={editor.formError} />
                <Form.Item
                    label="AGENTS.md title"
                    htmlFor="document-title"
                    tooltip="The main heading in each generated AGENTS.md file."
                >
                    <Space.Compact block>
                        <Input
                            id="document-title"
                            aria-label="AGENTS.md title"
                            name="name"
                            value={configName}
                            disabled={isBusy}
                            onChange={(event) =>
                            {
                                const value = event.currentTarget.value;
                                setConfigName(value);
                                editor.handleValueChange("name", value);
                            }}
                        />
                        <Button htmlType="submit" loading={isBusy} disabled={!editor.draft}>Save title</Button>
                    </Space.Compact>
                </Form.Item>
            </Form>
        </form>
    );
}

/** Edit one harness while retaining unsaved values when its drawer closes. */
function HarnessForm({ workspace, harness, onDone }: { workspace: Workspace; harness?: HarnessConfig | undefined; onDone: () => void })
{
    const isBusy = useAppStore((state) => state.isBusy);
    const setSelection = useAppStore((state) => state.setSelection);
    const original = harness?.name;
    const selection: Selection = original ? { kind: "harness", name: original } : { kind: "harness-new" };
    const editorKey = selectionKey(selection);
    const [isDeleteOpen, setIsDeleteOpen] = useState(false);
    const editor = useEditorForm(workspace, selection, original ? () => setIsDeleteOpen(true) : undefined, onDone);
    const [harnessName, setHarnessName] = useState(draftText(editor.draft, "name", original ?? "new-harness"));
    const [agentFileFormat, setAgentFileFormat] = useState<"toml" | "md">(
        draftText(editor.draft, "agentFileFormat", harness?.agentFormat === "toml" ? "toml" : "md") === "toml" ? "toml" : "md",
    );

    return (
        <>
            <form
                ref={editor.formRef}
                className="editor-form"
                inert={isBusy}
                aria-busy={isBusy}
                onFocusCapture={() => setSelection(selection)}
                onChange={editor.handleChange}
                onInput={editor.handleChange}
                onSubmit={editor.handleSubmit}
            >
                <Form component={false} layout="vertical" requiredMark={false}>
                    <FormError message={editor.formError} />
                    <Form.Item label="Name" htmlFor="harness-name">
                        <Input
                            id="harness-name"
                            name="name"
                            value={harnessName}
                            onChange={(event) =>
                            {
                                const value = event.currentTarget.value;
                                setHarnessName(value);
                                editor.handleValueChange("name", value);
                            }}
                        />
                    </Form.Item>
                    <Form.Item label="Config path" htmlFor="harness-config-path" extra="Relative to your user home directory. Use / between folders.">
                        <Input id="harness-config-path" name="configPath" placeholder=".config/opencode" defaultValue={draftText(editor.draft, "configPath", harness?.configPath ?? "")} />
                    </Form.Item>
                    <Form.Item label="Agent file format" htmlFor="harness-agent-format">
                        <input type="hidden" name="agentFileFormat" value={agentFileFormat} />
                        <Select
                            id="harness-agent-format"
                            value={agentFileFormat}
                            options={[{ label: "Markdown (.md) with YAML metadata", value: "md" }, { label: "TOML (.toml)", value: "toml" }]}
                            onChange={(value: "toml" | "md") =>
                            {
                                setAgentFileFormat(value);
                                editor.handleValueChange("agentFileFormat", value);
                            }}
                        />
                    </Form.Item>
                    {agentFileFormat === "toml" ? (
                        <Form.Item label="Instructions field" htmlFor="harness-instructions" extra="TOML key that stores the shared agent instructions.">
                            <Input id="harness-instructions" name="instructionsField" defaultValue={draftText(editor.draft, "instructionsField", harness?.instructionsField ?? "")} />
                        </Form.Item>
                    ) : null}
                    <Flex justify="space-between" gap={12} wrap>
                        <Space>
                            {original ? <Button type="text" danger icon={<DeleteOutlined />} onClick={() => setIsDeleteOpen(true)}>Delete</Button> : null}
                            {editor.draft ? <Button type="text" onClick={() =>
                            {
                                useAppStore.getState().clearEditorDraft(editorKey);
                                onDone();
                            }}>Discard changes</Button> : null}
                        </Space>
                        <Button type="primary" htmlType="submit" loading={isBusy} disabled={Boolean(original) && !editor.draft}>{original ? "Save harness" : "Create harness"}</Button>
                    </Flex>
                </Form>
            </form>
            <DeleteModal
                open={isDeleteOpen}
                title={`Delete harness ${original}?`}
                description="This removes the harness declaration from config.json and updates related targets."
                isBusy={isBusy}
                onCancel={() => setIsDeleteOpen(false)}
                onConfirm={() =>
                {
                    if (!original) return;
                    editor.mutate(async () =>
                    {
                        await window.appApi.workspace.removeHarness(original);
                        useAppStore.getState().clearEditorDraft(editorKey);
                        await refreshWorkspace();
                        showSuccess("Harness deleted", `Deleted harness ${original}`);
                        onDone();
                    });
                }}
            />
        </>
    );
}

/** Render the form for creating an empty catalog layer. */
function LayerNewForm({ workspace }: { workspace: Workspace })
{
    const setSelection = useAppStore((state) => state.setSelection);
    const selection: Selection = { kind: "layer-new" };
    const editor = useEditorForm(workspace, selection);
    const [layerName, setLayerName] = useState(draftText(editor.draft, "name", "new-layer"));

    return (
        <form
            ref={editor.formRef}
            className="editor-form"
            onFocusCapture={() => setSelection(selection)}
            onChange={editor.handleChange}
            onInput={editor.handleChange}
            onSubmit={editor.handleSubmit}
        >
            <Form component={false} layout="vertical" requiredMark={false}>
                <FormError message={editor.formError} />
                <EditorNameField
                    value={layerName}
                    onChange={(value) =>
                    {
                        setLayerName(value);
                        editor.handleValueChange("name", value);
                    }}
                />
            </Form>
        </form>
    );
}

/** Render an editable root or shared rule. */
function RuleForm({ workspace, selection }: { workspace: Workspace; selection: Extract<Selection, { kind: "rule" } | { kind: "rule-new" }> })
{
    const isBusy = useAppStore((state) => state.isBusy);
    const [isDeleteOpen, setIsDeleteOpen] = useState(false);
    const isShared = (selection.kind === "rule-new" && selection.scope === "shared")
        || (selection.kind === "rule" && workspace.sharedRules.some((rule) => rule.path === selection.path));
    const defaultPath = selection.kind === "rule"
        ? selection.path
        : selection.scope === "root"
            ? ".harness-align/rules/new-rule.md"
            : ".harness-align/rules/shared/new-rule.md";
    const sharedExisting = workspace.sharedRules.find((rule) => selection.kind === "rule" && rule.path === selection.path);
    const existing = selection.kind === "rule" ? workspace.rootRules.find((rule) => rule.path === selection.path) : undefined;
    const existingPath = sharedExisting?.path ?? existing?.path;
    const editorKey = selectionKey(selection);
    const editor = useEditorForm(workspace, selection, existingPath ? () => setIsDeleteOpen(true) : undefined);
    const [ruleName, setRuleName] = useState(draftText(editor.draft, "name", ruleDisplayName(existingPath ?? defaultPath)));

    return (
        <>
            <form
                ref={editor.formRef}
                className="editor-form"
                onChange={editor.handleChange}
                onInput={editor.handleChange}
                onSubmit={editor.handleSubmit}
            >
                <Form component={false} layout="vertical" requiredMark={false}>
                    <FormError message={editor.formError} />
                    <EditorNameField
                        value={ruleName}
                        onChange={(value) =>
                        {
                            setRuleName(value);
                            editor.handleValueChange("name", value);
                        }}
                    />
                    {!isShared ? <TargetBoxes selected={draftValues(editor.draft, "targets", existing?.targets)} /> : null}
                    <Form.Item label="Body">
                        <SourceEditor
                            aria-label={isShared ? "Shared rule body" : "Rule body"}
                            name="body"
                            language="markdown"
                            defaultValue={draftText(editor.draft, "body", (sharedExisting ?? existing)?.body ?? "# Title\n\nbody\n")}
                        />
                    </Form.Item>
                </Form>
            </form>
            {existingPath ? (
                <DeleteModal
                    open={isDeleteOpen}
                    title={`Delete ${fileName(existingPath)}?`}
                    description="This permanently deletes the source file from the workspace."
                    isBusy={isBusy}
                    onCancel={() => setIsDeleteOpen(false)}
                    onConfirm={() =>
                    {
                        editor.mutate(async () =>
                        {
                            await window.appApi.workspace.deleteSource(existingPath);
                            useAppStore.getState().clearEditorDraft(editorKey);
                            await refreshWorkspace();
                            showSuccess("Rule deleted", `Deleted ${existingPath}`);
                        });
                    }}
                />
            ) : null}
        </>
    );
}

/** Render one selectable layer option editor. */
function LayerOptionForm({ workspace, selection }: { workspace: Workspace; selection: Extract<Selection, { kind: "layer-option" } | { kind: "layer-option-new" }> })
{
    const isBusy = useAppStore((state) => state.isBusy);
    const [isDeleteOpen, setIsDeleteOpen] = useState(false);
    const existing = selection.kind === "layer-option"
        ? Object.values(workspace.layerOptions).flat().find((option) => option.path === selection.path)
        : undefined;
    const layer = selection.kind === "layer-option-new" ? selection.layer : existing?.layer;
    const layerConfig = workspace.config.layers.find((candidate) => candidate.name === layer);
    const canDelete = Boolean(existing && layerConfig?.selected !== existing.name);
    const editorKey = selectionKey(selection);
    const editor = useEditorForm(workspace, selection, canDelete ? () => setIsDeleteOpen(true) : undefined);
    const [optionName, setOptionName] = useState(draftText(editor.draft, "name", existing?.name ?? "new-option"));

    if (selection.kind === "layer-option" && !existing) return <MissingEditorEmpty title="Option not found" description="This layer option is no longer in the workspace." />;
    if (!layer) return <MissingEditorEmpty title="Layer not found" description="This layer is no longer in the workspace." />;

    return (
        <>
            <form
                ref={editor.formRef}
                className="editor-form"
                onChange={editor.handleChange}
                onInput={editor.handleChange}
                onSubmit={editor.handleSubmit}
            >
                <Form component={false} layout="vertical" requiredMark={false}>
                    <FormError message={editor.formError} />
                    <EditorNameField
                        value={optionName}
                        onChange={(value) =>
                        {
                            setOptionName(value);
                            editor.handleValueChange("name", value);
                        }}
                    />
                    <TargetBoxes selected={draftValues(editor.draft, "targets", existing?.targets)} />
                    <Form.Item label="Body">
                        <SourceEditor
                            aria-label="Layer option body"
                            name="body"
                            language="markdown"
                            defaultValue={draftText(editor.draft, "body", existing?.body ?? "")}
                        />
                    </Form.Item>
                </Form>
            </form>
            {existing ? (
                <DeleteModal
                    open={isDeleteOpen}
                    title={`Delete ${existing.name}?`}
                    description="This permanently deletes the layer option file."
                    isBusy={isBusy}
                    onCancel={() => setIsDeleteOpen(false)}
                    onConfirm={() =>
                    {
                        editor.mutate(async () =>
                        {
                            await window.appApi.workspace.removeLayerOption(existing.layer, existing.name);
                            useAppStore.getState().clearEditorDraft(editorKey);
                            await refreshWorkspace({ kind: "layer", name: existing.layer });
                            showSuccess("Layer option deleted", `Deleted ${existing.path}`);
                        });
                    }}
                />
            ) : null}
        </>
    );
}

/** Render a subagent source and per-harness metadata editors. */
function AgentForm({ workspace, selection }: { workspace: Workspace; selection: Extract<Selection, { kind: "agent" } | { kind: "agent-new" }> })
{
    const isBusy = useAppStore((state) => state.isBusy);
    const existing = selection.kind === "agent" ? workspace.agents.find((agent) => agent.path === selection.path) : undefined;
    const [isDeleteOpen, setIsDeleteOpen] = useState(false);
    const editorKey = selectionKey(selection);
    const editor = useEditorForm(workspace, selection, existing ? () => setIsDeleteOpen(true) : undefined);
    const [agentName, setAgentName] = useState(draftText(editor.draft, "name", existing?.name ?? "new-agent"));
    const [activeMetadataName, setActiveMetadataName] = useState(workspace.config.harnesses[0]!.name);
    const selectedMetadataName = workspace.config.harnesses.some((harness) => harness.name === activeMetadataName)
        ? activeMetadataName
        : workspace.config.harnesses[0]!.name;

    return (
        <>
            <form
                ref={editor.formRef}
                className="editor-form"
                onChange={editor.handleChange}
                onInput={editor.handleChange}
                onSubmit={editor.handleSubmit}
            >
                <Form component={false} layout="vertical" requiredMark={false}>
                    <FormError message={editor.formError} />
                    <EditorNameField
                        value={agentName}
                        onChange={(value) =>
                        {
                            setAgentName(value);
                            editor.handleValueChange("name", value);
                        }}
                    />
                    <Form.Item label="Description" htmlFor="agent-description">
                        <Input id="agent-description" name="description" defaultValue={draftText(editor.draft, "description", existing?.description ?? "")} />
                    </Form.Item>
                    <Form.Item label="Metadata (JSON)">
                        <input type="hidden" name="enabledHarnesses" value="" />
                        <Tabs
                            activeKey={selectedMetadataName}
                            onChange={setActiveMetadataName}
                            items={workspace.config.harnesses.map((harness) => ({
                                key: harness.name,
                                label: harness.name,
                                forceRender: true,
                                children: (<Space orientation="vertical" size="middle" className="full-width">
                                    <Checkbox.Group name="enabledHarnesses" options={[{ label: `Enable for ${harness.name}`, value: harness.name }]}
                                        defaultValue={draftValues(editor.draft, "enabledHarnesses", existing ? Object.keys(existing.harnesses) : workspace.config.harnesses.map((item) => item.name)) ?? []} />
                                    <SourceEditor
                                        name={`meta-${harness.name}`}
                                        language="json"
                                        aria-label={`${harness.name} metadata JSON`}
                                        resizeKey={selectedMetadataName}
                                        defaultValue={draftText(editor.draft, `meta-${harness.name}`, JSON.stringify(existing?.harnesses[harness.name] ?? {}, null, 2))}
                                    />
                                </Space>),
                            }))}
                        />
                    </Form.Item>
                    <Form.Item label="Body">
                        <SourceEditor
                            name="body"
                            language="markdown"
                            aria-label="Agent instructions"
                            defaultValue={draftText(editor.draft, "body", existing?.body ?? "Instructions.\n")}
                        />
                    </Form.Item>
                </Form>
            </form>
            {existing ? (
                <DeleteModal
                    open={isDeleteOpen}
                    title={`Delete ${fileName(existing.path)}?`}
                    description="This permanently deletes the source file from the workspace."
                    isBusy={isBusy}
                    onCancel={() => setIsDeleteOpen(false)}
                    onConfirm={() =>
                    {
                        editor.mutate(async () =>
                        {
                            await window.appApi.workspace.deleteSource(existing.path);
                            useAppStore.getState().clearEditorDraft(editorKey);
                            await refreshWorkspace();
                            showSuccess("Agent deleted", `Deleted ${existing.path}`);
                        });
                    }}
                />
            ) : null}
        </>
    );
}

/** Render one generated output file in the read-only source editor. */
function GeneratedFileView({ workspace, path }: { workspace: Workspace; path: string })
{
    const file = workspace.generatedFiles.find((item) => item.path === path);
    if (!file) return <MissingEditorEmpty title="Generated file not found" description="Generate or reload the project to refresh output files." />;
    return (
        <SourceEditor
            key={file.content}
            aria-label={file.path}
            language={file.path.toLowerCase().endsWith(".md") ? "markdown" : "plain"}
            defaultValue={file.content}
            readOnly
        />
    );
}

/** Render the empty generated-output state. */
function GeneratedEmpty()
{
    return <Empty description="Run Generate to create output files" />;
}

/** Render an empty editor state for a selection that no longer exists. */
function MissingEditorEmpty({ title, description }: { title: string; description: string })
{
    return <Empty description={<Space orientation="vertical" size={2}><Typography.Text strong>{title}</Typography.Text><Typography.Text type="secondary">{description}</Typography.Text></Space>} />;
}

/** Render the Harnesses page without unrelated project configuration. */
export function HarnessesPanel()
{
    const workspace = useAppStore((state) => state.workspace);
    const selection = useAppStore((state) => state.selection);
    const setSelection = useAppStore((state) => state.setSelection);
    const isBusy = useAppStore((state) => state.isBusy);
    const drafts = useAppStore((state) => state.editorDrafts);
    const [isEditorOpen, setIsEditorOpen] = useState(false);

    if (!workspace) return <Empty description="The user workspace is not loaded yet" />;
    const selectedHarness = selection.kind === "harness" ? workspace.config.harnesses.find((harness) => harness.name === selection.name) : undefined;

    /** Open a single editor without discarding drafts belonging to other harnesses. */
    const openEditor = (next: Selection): void =>
    {
        setSelection(next);
        setIsEditorOpen(true);
    };

    return (
        <div className="project-page">
            <Flex align="center" justify="space-between" gap={16} wrap>
                <Typography.Title level={3} className="page-title">Harnesses</Typography.Title>
                <Button type="primary" icon={<PlusOutlined />} disabled={isBusy} onClick={() => openEditor({ kind: "harness-new" })}>
                    {drafts["harness-new"] ? "Continue new harness" : "Add harness"}
                </Button>
            </Flex>
            <div className="harnesses-grid">
                {workspace.config.harnesses.map((harness) => (
                    <Card key={harness.name} className="harness-card" classNames={{ body: "harness-card-body" }}>
                        <div className="harness-card-header">
                            <span className="harness-card-mark" aria-hidden="true">{harness.name.slice(0, 2).toUpperCase()}</span>
                            <div className="harness-card-heading">
                                <Typography.Title level={4} className="harness-card-name">{harness.name}</Typography.Title>
                                <Button
                                    type="link"
                                    size="small"
                                    className="harness-card-path"
                                    icon={<FolderOutlined aria-hidden="true" />}
                                    disabled={isBusy}
                                    autoInsertSpace={false}
                                    aria-label={`Open ${harness.name} folder`}
                                    onClick={() => void window.appApi.workspace.openHarnessRoot(harness.name).catch((error: unknown) => showError(error, "Open folder failed"))}
                                >
                                    <code>~/{harness.configPath}</code>
                                </Button>
                                {drafts[selectionKey({ kind: "harness", name: harness.name })] ? <Tag color="gold">Unsaved</Tag> : null}
                            </div>
                            <Button icon={<EditOutlined />} disabled={isBusy} aria-label={`Edit ${harness.name}`} onClick={() => openEditor({ kind: "harness", name: harness.name })}>
                                Edit
                            </Button>
                        </div>
                    </Card>
                ))}
            </div>
            <Drawer
                title={selectedHarness ? `Edit ${selectedHarness.name}` : "New harness"}
                open={isEditorOpen}
                size={480}
                destroyOnHidden
                closable={{ disabled: isBusy }}
                mask={{ closable: !isBusy }}
                keyboard={!isBusy}
                onClose={() => setIsEditorOpen(false)}
            >
                <HarnessForm key={`${selectionKey(selection)}:${JSON.stringify(selectedHarness)}`} workspace={workspace} harness={selectedHarness} onDone={() => setIsEditorOpen(false)} />
            </Drawer>
        </div>
    );
}

/** Render the editor for the current workspace selection. */
export function WorkspaceEditor()
{
    const workspace = useAppStore((state) => state.workspace);
    const selection = useAppStore((state) => state.selection);
    const isBusy = useAppStore((state) => state.isBusy);
    const editorKey = selectionKey(selection);
    const hasDraft = useAppStore((state) => Boolean(state.editorDrafts[editorKey]));
    const [revision, setRevision] = useState(0);

    if (!workspace) return <Empty description="The user workspace is not loaded yet" />;
    let editor: ReactNode = <GeneratedEmpty />;
    if (selection.kind === "layer-new") editor = <LayerNewForm workspace={workspace} />;
    else if (selection.kind === "layer") editor = (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Select an option to edit">
            <Button icon={<PlusOutlined />} disabled={isBusy} onClick={() => useAppStore.getState().setSelection({ kind: "layer-option-new", layer: selection.name })}>Add option</Button>
        </Empty>
    );
    else if (selection.kind === "layer-option" || selection.kind === "layer-option-new")
    {
        const source = selection.kind === "layer-option" ? Object.values(workspace.layerOptions).flat().find((item) => item.path === selection.path) : undefined;
        editor = <LayerOptionForm key={JSON.stringify(source)} workspace={workspace} selection={selection} />;
    }
    else if (selection.kind === "rule" || selection.kind === "rule-new")
    {
        const source = selection.kind === "rule" ? [...workspace.rootRules, ...workspace.sharedRules].find((item) => item.path === selection.path) : undefined;
        editor = <RuleForm key={JSON.stringify(source)} workspace={workspace} selection={selection} />;
    }
    else if (selection.kind === "agent" || selection.kind === "agent-new")
    {
        const source = selection.kind === "agent" ? workspace.agents.find((item) => item.path === selection.path) : undefined;
        editor = <AgentForm key={JSON.stringify(source)} workspace={workspace} selection={selection} />;
    }
    else if (selection.kind === "generated-file") editor = <GeneratedFileView workspace={workspace} path={selection.path} />;

    const isNew = selection.kind.endsWith("-new");
    const canSave = isNew || selection.kind === "rule" || selection.kind === "agent" || selection.kind === "layer-option";
    const title = "path" in selection ? selection.kind === "generated-file" ? selection.path : fileName(selection.path)
        : selection.kind === "layer" ? selection.name : isNew ? `New ${selection.kind.replace("-new", "").replace("-", " ")}` : "Generated files";
    return (
        <div className="workspace-editor">
            <Flex className="workspace-editor-toolbar" align="center" justify="space-between" gap={12}>
                <Typography.Text strong ellipsis={{ tooltip: title }} className="workspace-editor-title">{title}</Typography.Text>
                {canSave ? <Space size={8}>
                    {hasDraft ? <Button type="text" icon={<UndoOutlined />} disabled={isBusy} onClick={() =>
                    {
                        useAppStore.getState().clearEditorDraft(editorKey);
                        setRevision((current) => current + 1);
                    }}>Discard changes</Button> : null}
                    <Button icon={isNew ? <PlusOutlined /> : <SaveOutlined />} disabled={isBusy || !isNew && !hasDraft}
                            onClick={() => useAppStore.getState().requestEditorAction(selection, "save")}>{isNew ? "Create" : "Save file"}</Button>
                </Space> : selection.kind !== "layer" ? <Typography.Text type="secondary">Read only</Typography.Text> : null}
            </Flex>
            <div className="workspace-scroll">
                <div key={revision} className="workspace-editor-page">{editor}</div>
            </div>
        </div>
    );
}
