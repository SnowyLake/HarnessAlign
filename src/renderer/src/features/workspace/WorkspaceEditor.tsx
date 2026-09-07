/**
 * Ant Design workspace editors that preserve native FormData drafts and Main-process path validation.
 */

import { ArrowDownOutlined, ArrowUpOutlined, CloseOutlined, DeleteOutlined, EditOutlined, HolderOutlined, PlusOutlined } from "@ant-design/icons";
import type { HarnessConfig, LayerSelection, Workspace } from "@shared/models/Workspace";
import { Alert, Button, Card, Checkbox, Drawer, Empty, Flex, Form, Input, Modal, Select, Space, Table, Tabs, Tag, Typography } from "antd";
import { useEffect, useLayoutEffect, useRef, useState, type FormEventHandler, type ReactNode, type RefObject } from "react";
import { showSuccess } from "@/components/common/Feedback";
import { SourceEditor } from "@/components/common/SourceEditor";
import { persistEditorSnapshot, refreshWorkspace, runMutation } from "@/features/workspace/WorkspaceTasks";
import { catalogLayerNames, defaultLayerOption, fileName, ruleDisplayName, selectableLayerNames } from "@/lib/Utils";
import { selectionKey, useAppStore, type EditorDraft, type FormSnapshot, type Selection } from "@/stores/AppStore";

/** Form bindings that preserve drafts and respond to tree commands. */
interface EditorFormBinding
{
    draft: EditorDraft | undefined;
    formRef: RefObject<HTMLFormElement | null>;
    handleChange: FormEventHandler<HTMLFormElement>;
    handleValueChange: (name: string, value: string) => void;
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
function useEditorForm(selection: Selection, onDelete?: () => void): EditorFormBinding
{
    const editorKey = selectionKey(selection);
    const draft = useAppStore((state) => state.editorDrafts[editorKey]);
    const setEditorDraft = useAppStore((state) => state.setEditorDraft);
    const formRef = useRef<HTMLFormElement>(null);
    const baselineRef = useRef<FormSnapshot | undefined>(draft?.baseline);

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

    useEditorAction(editorKey, () => formRef.current?.requestSubmit(), onDelete);
    return { draft, formRef, handleChange, handleValueChange };
}

/** Persist one mounted editor form and refresh it under the resulting selection. */
async function persistEditorForm(workspace: Workspace, selection: Selection, snapshot: FormSnapshot): Promise<void>
{
    const result = await persistEditorSnapshot(workspace, selection, snapshot);
    const state = useAppStore.getState();
    state.clearEditorDraft(selectionKey(selection));
    state.clearEditorDraft(selectionKey(result.selection));
    await refreshWorkspace(result.selection);
    showSuccess(result.message);
}

/** Render the harness allowlist for a rule or layer option. */
function TargetBoxes({ selected }: { selected: string[] | undefined })
{
    const workspace = useAppStore((state) => state.workspace);
    return (
        <Form.Item label="Targets">
            <Checkbox.Group
                name="targets"
                options={(workspace?.config.harnesses ?? []).map((harness) => harness.name)}
                {...(selected ? { defaultValue: selected } : {})}
            />
        </Form.Item>
    );
}

/** Render a full mutation error in an Ant Design Alert. */
function FormError({ message }: { message: string | undefined })
{
    if (!message) return null;
    return <Alert className="editor-alert" type="error" title="Error" description={<span className="pre-wrap">{message}</span>} showIcon />;
}

/** Render the standard editor name field and optional create button. */
function EditorNameField({ value, isBusy, submitLabel, onChange }: {
    value: string;
    isBusy: boolean;
    submitLabel?: string | undefined;
    onChange: (value: string) => void;
})
{
    return (
        <Form.Item label="Name">
            <Flex gap={8}>
                <Input name="name" value={value} onChange={(event) => onChange(event.currentTarget.value)} />
                {submitLabel ? <Button type="primary" htmlType="submit" loading={isBusy}>{submitLabel}</Button> : null}
            </Flex>
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
    const [formError, setFormError] = useState<string>();
    const selection: Selection = { kind: "config" };
    const editor = useEditorForm(selection);
    const [configName, setConfigName] = useState(draftText(editor.draft, "name", workspace.config.name));

    return (
        <form
            ref={editor.formRef}
            className="editor-form"
            onFocusCapture={() => setSelection(selection)}
            onChange={editor.handleChange}
            onSubmit={(event) =>
            {
                event.preventDefault();
                setFormError(undefined);
                void runMutation(() => persistEditorForm(workspace, selection, formSnapshot(event.currentTarget))).then((result) =>
                {
                    if (!result.ok) setFormError(result.message);
                });
            }}
        >
            <Form component={false} layout="vertical" requiredMark={false}>
                <FormError message={formError} />
                <Form.Item
                    label="AGENTS.md title"
                    extra="Used only as the level-one heading in every generated AGENTS.md file."
                >
                    <Space.Compact block>
                        <Input
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
                        <Button type="primary" htmlType="submit" loading={isBusy}>Save title</Button>
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
    const [formError, setFormError] = useState<string>();
    const [isDeleteOpen, setIsDeleteOpen] = useState(false);
    const editor = useEditorForm(selection, original ? () => setIsDeleteOpen(true) : undefined);
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
                onSubmit={(event) =>
                {
                    event.preventDefault();
                    if (isBusy) return;
                    setFormError(undefined);
                    void runMutation(() => persistEditorForm(workspace, selection, formSnapshot(event.currentTarget))).then((result) =>
                    {
                        if (!result.ok) setFormError(result.message);
                        else onDone();
                    });
                }}
            >
                <Form component={false} layout="vertical" requiredMark={false}>
                    <FormError message={formError} />
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
                    <Typography.Paragraph type="secondary">
                        {editor.draft ? "Unsaved changes. Closing keeps this draft until you save or discard it." : "Save this harness before running Generate or Setup."}
                    </Typography.Paragraph>
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
                    setFormError(undefined);
                    void runMutation(async () =>
                    {
                        await window.appApi.workspace.removeHarness(original);
                        useAppStore.getState().clearEditorDraft(editorKey);
                        await refreshWorkspace();
                        showSuccess(`Deleted harness ${original}`);
                        onDone();
                    }).then((result) =>
                    {
                        if (!result.ok) setFormError(result.message);
                    });
                }}
            />
        </>
    );
}

/** Render the form for creating an empty catalog layer. */
function LayerNewForm({ workspace }: { workspace: Workspace })
{
    const isBusy = useAppStore((state) => state.isBusy);
    const setSelection = useAppStore((state) => state.setSelection);
    const [formError, setFormError] = useState<string>();
    const selection: Selection = { kind: "layer-new" };
    const editor = useEditorForm(selection);
    const [layerName, setLayerName] = useState(draftText(editor.draft, "name", "new-layer"));

    return (
        <form
            ref={editor.formRef}
            className="editor-form"
            onFocusCapture={() => setSelection(selection)}
            onChange={editor.handleChange}
            onSubmit={(event) =>
            {
                event.preventDefault();
                setFormError(undefined);
                void runMutation(() => persistEditorForm(workspace, selection, formSnapshot(event.currentTarget))).then((result) =>
                {
                    if (!result.ok) setFormError(result.message);
                });
            }}
        >
            <Form component={false} layout="vertical" requiredMark={false}>
                <FormError message={formError} />
                <EditorNameField
                    value={layerName}
                    isBusy={isBusy}
                    submitLabel="Create layer"
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

/** Props for one ordered layer card in the Layers generation panel. */
interface LayerCardProps
{
    workspace: Workspace;
    selection: LayerSelection;
    order: number;
    canMoveUp: boolean;
    canMoveDown: boolean;
    isDragging: boolean;
    onMove: (offset: -1 | 1) => void;
    onDragStart: () => void;
    onDragEnd: () => void;
    onDrop: () => void;
}

/** Render the picker for adding an existing catalog layer to the project. */
function NewLayerCard({ workspace, onAdd, onCancel }: { workspace: Workspace; onAdd: (name: string) => void; onCancel: () => void })
{
    const isBusy = useAppStore((state) => state.isBusy);
    const layerSelection = useAppStore((state) => state.layerSelection);
    const available = selectableLayerNames(workspace).filter((name) => !layerSelection.some((item) => item.name === name));

    return (
        <Card size="small" title="Add layer" extra={<Button type="text" icon={<CloseOutlined />} aria-label="Cancel new layer" onClick={onCancel} />}>
            {available.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Every catalog layer is already in this project" /> : (
                <Select
                    autoFocus
                    placeholder="Choose a layer"
                    disabled={isBusy}
                    options={available.map((name) => ({ label: name, value: name }))}
                    onChange={onAdd}
                    className="full-width"
                />
            )}
        </Card>
    );
}

/** Render one draggable project layer card with its selected option. */
function LayerCard({ workspace, selection, order, canMoveUp, canMoveDown, isDragging, onMove, onDragStart, onDragEnd, onDrop }: LayerCardProps)
{
    const isBusy = useAppStore((state) => state.isBusy);
    const setLayerSelection = useAppStore((state) => state.setLayerSelection);
    const [isRemoveOpen, setIsRemoveOpen] = useState(false);
    const options = Object.hasOwn(workspace.layerOptions, selection.name) ? workspace.layerOptions[selection.name] ?? [] : [];

    return (
        <>
            <Card
                size="small"
                className="draggable-card"
                data-dragging={isDragging || undefined}
                draggable={!isBusy}
                title={<Space><HolderOutlined title="Drag to reorder" /><Tag color="blue">{order}</Tag><span>{selection.name}</span></Space>}
                extra={(
                    <Space.Compact>
                        <Button type="text" icon={<ArrowUpOutlined />} disabled={isBusy || !canMoveUp} aria-label={`Move ${selection.name} earlier`} onClick={() => onMove(-1)} />
                        <Button type="text" icon={<ArrowDownOutlined />} disabled={isBusy || !canMoveDown} aria-label={`Move ${selection.name} later`} onClick={() => onMove(1)} />
                        <Button type="text" danger icon={<CloseOutlined />} disabled={isBusy} aria-label={`Remove ${selection.name}`} onClick={() => setIsRemoveOpen(true)} />
                    </Space.Compact>
                )}
                onDragStart={(event) =>
                {
                    event.dataTransfer.effectAllowed = "move";
                    onDragStart();
                }}
                onDragEnd={onDragEnd}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) =>
                {
                    event.preventDefault();
                    onDrop();
                }}
            >
                <Form layout="vertical" requiredMark={false}>
                    <Form.Item label="Selected option">
                        <Select
                            value={selection.option}
                            options={options.map((option) => ({ label: option.name, value: option.name }))}
                            onChange={(value: string) =>
                            {
                                setLayerSelection(useAppStore.getState().layerSelection.map((item) => item.name === selection.name ? { ...item, option: value } : item));
                            }}
                        />
                    </Form.Item>
                </Form>
            </Card>
            <Modal
                open={isRemoveOpen}
                title={`Remove ${selection.name} from this project?`}
                okText="Remove"
                confirmLoading={isBusy}
                onCancel={() => setIsRemoveOpen(false)}
                onOk={() =>
                {
                    setLayerSelection(useAppStore.getState().layerSelection.filter((item) => item.name !== selection.name));
                    setIsRemoveOpen(false);
                    showSuccess(`Removed layer ${selection.name}`);
                }}
            >
                <Typography.Paragraph>The files in layer {selection.name} are kept.</Typography.Paragraph>
            </Modal>
        </>
    );
}

/** Render an editable root or shared rule. */
function RuleForm({ workspace, selection }: { workspace: Workspace; selection: Extract<Selection, { kind: "rule" } | { kind: "rule-new" }> })
{
    const isBusy = useAppStore((state) => state.isBusy);
    const [formError, setFormError] = useState<string>();
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
    const editor = useEditorForm(selection, existingPath ? () => setIsDeleteOpen(true) : undefined);
    const [ruleName, setRuleName] = useState(draftText(editor.draft, "name", ruleDisplayName(existingPath ?? defaultPath)));

    return (
        <>
            <form
                ref={editor.formRef}
                className="editor-form"
                onChange={editor.handleChange}
                onSubmit={(event) =>
                {
                    event.preventDefault();
                    setFormError(undefined);
                    void runMutation(() => persistEditorForm(workspace, selection, formSnapshot(event.currentTarget))).then((result) =>
                    {
                        if (!result.ok) setFormError(result.message);
                    });
                }}
            >
                <Form component={false} layout="vertical" requiredMark={false}>
                    <FormError message={formError} />
                    <EditorNameField
                        value={ruleName}
                        isBusy={isBusy}
                        submitLabel={selection.kind === "rule-new" ? "Create rule" : undefined}
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
                        setFormError(undefined);
                        void runMutation(async () =>
                        {
                            await window.appApi.workspace.deleteSource(existingPath);
                            useAppStore.getState().clearEditorDraft(editorKey);
                            await refreshWorkspace();
                            showSuccess(`Deleted ${fileName(existingPath)}`);
                        }).then((result) =>
                        {
                            if (!result.ok) setFormError(result.message);
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
    const [formError, setFormError] = useState<string>();
    const [isDeleteOpen, setIsDeleteOpen] = useState(false);
    const existing = selection.kind === "layer-option"
        ? Object.values(workspace.layerOptions).flat().find((option) => option.path === selection.path)
        : undefined;
    const layer = selection.kind === "layer-option-new" ? selection.layer : existing?.layer;
    const layerConfig = workspace.config.layers.find((candidate) => candidate.name === layer);
    const canDelete = Boolean(existing && layerConfig?.selected !== existing.name);
    const editorKey = selectionKey(selection);
    const editor = useEditorForm(selection, canDelete ? () => setIsDeleteOpen(true) : undefined);
    const [optionName, setOptionName] = useState(draftText(editor.draft, "name", existing?.name ?? "new-option"));

    if (selection.kind === "layer-option" && !existing) return <MissingEditorEmpty title="Option not found" description="This layer option is no longer in the workspace." />;
    if (!layer) return <MissingEditorEmpty title="Layer not found" description="This layer is no longer in the workspace." />;

    return (
        <>
            <form
                ref={editor.formRef}
                className="editor-form"
                onChange={editor.handleChange}
                onSubmit={(event) =>
                {
                    event.preventDefault();
                    setFormError(undefined);
                    void runMutation(() => persistEditorForm(workspace, selection, formSnapshot(event.currentTarget))).then((result) =>
                    {
                        if (!result.ok) setFormError(result.message);
                    });
                }}
            >
                <Form component={false} layout="vertical" requiredMark={false}>
                    <FormError message={formError} />
                    <EditorNameField
                        value={optionName}
                        isBusy={isBusy}
                        submitLabel={selection.kind === "layer-option-new" ? "Create option" : undefined}
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
                        setFormError(undefined);
                        void runMutation(async () =>
                        {
                            await window.appApi.workspace.removeLayerOption(existing.layer, existing.name);
                            useAppStore.getState().clearEditorDraft(editorKey);
                            await refreshWorkspace({ kind: "layer", name: existing.layer });
                            showSuccess(`Deleted ${existing.name}`);
                        }).then((result) =>
                        {
                            if (!result.ok) setFormError(result.message);
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
    const [formError, setFormError] = useState<string>();
    const [isDeleteOpen, setIsDeleteOpen] = useState(false);
    const editorKey = selectionKey(selection);
    const editor = useEditorForm(selection, existing ? () => setIsDeleteOpen(true) : undefined);
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
                onSubmit={(event) =>
                {
                    event.preventDefault();
                    setFormError(undefined);
                    void runMutation(() => persistEditorForm(workspace, selection, formSnapshot(event.currentTarget))).then((result) =>
                    {
                        if (!result.ok) setFormError(result.message);
                    });
                }}
            >
                <Form component={false} layout="vertical" requiredMark={false}>
                    <FormError message={formError} />
                    <EditorNameField
                        value={agentName}
                        isBusy={isBusy}
                        submitLabel={selection.kind === "agent-new" ? "Create agent" : undefined}
                        onChange={(value) =>
                        {
                            setAgentName(value);
                            editor.handleValueChange("name", value);
                        }}
                    />
                    <Form.Item label="Description">
                        <Input name="description" defaultValue={draftText(editor.draft, "description", existing?.description ?? "")} />
                    </Form.Item>
                    <Form.Item label="Metadata (JSON)">
                        <Tabs
                            activeKey={selectedMetadataName}
                            onChange={setActiveMetadataName}
                            items={workspace.config.harnesses.map((harness) => ({
                                key: harness.name,
                                label: harness.name,
                                forceRender: true,
                                children: (
                                    <SourceEditor
                                        name={`meta-${harness.name}`}
                                        language="json"
                                        aria-label={`${harness.name} metadata JSON`}
                                        resizeKey={selectedMetadataName}
                                        defaultValue={draftText(editor.draft, `meta-${harness.name}`, JSON.stringify(existing?.harnesses[harness.name] ?? {}, null, 2))}
                                    />
                                ),
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
                        setFormError(undefined);
                        void runMutation(async () =>
                        {
                            await window.appApi.workspace.deleteSource(existing.path);
                            useAppStore.getState().clearEditorDraft(editorKey);
                            await refreshWorkspace();
                            showSuccess(`Deleted ${fileName(existing.path)}`);
                        }).then((result) =>
                        {
                            if (!result.ok) setFormError(result.message);
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
        <Space orientation="vertical" size="middle" className="full-width">
            <Typography.Text type="secondary">{file.path}</Typography.Text>
            <SourceEditor
                aria-label={file.path}
                language={file.path.toLowerCase().endsWith(".md") ? "markdown" : "plain"}
                defaultValue={file.content}
                readOnly
            />
        </Space>
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

/** Move one layer around the ordered generation selection. */
function moveLayerSelection(selection: readonly LayerSelection[], sourceName: string, targetName: string): LayerSelection[]
{
    const sourceIndex = selection.findIndex((item) => item.name === sourceName);
    const targetIndex = selection.findIndex((item) => item.name === targetName);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return [...selection];
    const next = [...selection];
    const [source] = next.splice(sourceIndex, 1);
    if (!source) return [...selection];
    const nextTargetIndex = next.findIndex((item) => item.name === targetName);
    next.splice(sourceIndex < targetIndex ? nextTargetIndex + 1 : nextTargetIndex, 0, source);
    return next;
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
                <div>
                    <Typography.Title level={3} className="harnesses-title">Harnesses <Typography.Text type="secondary">({workspace.config.harnesses.length})</Typography.Text></Typography.Title>
                    <Typography.Text type="secondary">Manage where each coding assistant receives its rules and agents.</Typography.Text>
                </div>
                <Button type="primary" icon={<PlusOutlined />} disabled={isBusy} onClick={() => openEditor({ kind: "harness-new" })}>
                    {drafts["harness-new"] ? "Continue new harness" : "Add harness"}
                </Button>
            </Flex>
            <div className="harnesses-table">
                <Table<HarnessConfig>
                    rowKey="name"
                    size="middle"
                    pagination={false}
                    dataSource={workspace.config.harnesses}
                    scroll={{ x: 640 }}
                    columns={[
                        {
                            title: "Harness",
                            key: "name",
                            width: "24%",
                            render: (_, harness) => (
                                <Space wrap>
                                    <Typography.Text strong className="break-anywhere">{harness.name}</Typography.Text>
                                    {drafts[selectionKey({ kind: "harness", name: harness.name })] ? <Tag color="gold">Unsaved</Tag> : null}
                                </Space>
                            ),
                        },
                        {
                            title: "Config path",
                            key: "path",
                            render: (_, harness) => <Typography.Text className="break-anywhere">{harness.configPath}</Typography.Text>,
                        },
                        {
                            title: "Agent files",
                            key: "format",
                            width: 230,
                            render: (_, harness) => (
                                <Space><Tag>.{harness.agentExtension}</Tag><Typography.Text type="secondary">{harness.agentFormat === "toml" ? "TOML" : "YAML metadata"}</Typography.Text></Space>
                            ),
                        },
                        {
                            title: "Action",
                            key: "edit",
                            width: 100,
                            fixed: "right",
                            render: (_, harness) => (
                                <Button
                                    type="text"
                                    icon={<EditOutlined />}
                                    disabled={isBusy}
                                    aria-label={`Edit ${harness.name}`}
                                    onClick={() => openEditor({ kind: "harness", name: harness.name })}
                                >Edit</Button>
                            ),
                        },
                    ]}
                />
            </div>
            <Typography.Paragraph type="secondary" className="break-anywhere">
                Paths are relative to your user home directory. Setup updates existing directories and skips missing ones.
            </Typography.Paragraph>
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

/** Render the ordered generation selection on the dedicated registration page. */
export function LayerRegistrationPanel()
{
    const workspace = useAppStore((state) => state.workspace);
    const isBusy = useAppStore((state) => state.isBusy);
    const layerSelection = useAppStore((state) => state.layerSelection);
    const setLayerSelection = useAppStore((state) => state.setLayerSelection);
    const [draggedLayer, setDraggedLayer] = useState<string>();
    const [isAddingLayer, setIsAddingLayer] = useState(false);

    if (!workspace) return <Empty description="The user workspace is not loaded yet" />;
    const selectableLayers = selectableLayerNames(workspace);

    return (
        <section className="layer-selection-panel">
            <div className="layer-selection-header">
                <div>
                    <Typography.Title level={5}>Layer sequence</Typography.Title>
                    <Typography.Text type="secondary">Applied from top to bottom.</Typography.Text>
                </div>
                <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    disabled={isBusy || isAddingLayer || selectableLayers.every((name) => layerSelection.some((item) => item.name === name))}
                    onClick={() => setIsAddingLayer(true)}
                >
                    Add
                </Button>
            </div>
            <div className="layer-selection-content">
                <div className="project-layer-grid">
                    {layerSelection.map((layer, index) => (
                        <LayerCard
                            key={layer.name}
                            workspace={workspace}
                            selection={layer}
                            order={index + 1}
                            canMoveUp={index > 0}
                            canMoveDown={index < layerSelection.length - 1}
                            isDragging={draggedLayer === layer.name}
                            onMove={(offset) =>
                            {
                                const current = useAppStore.getState().layerSelection;
                                const currentIndex = current.findIndex((item) => item.name === layer.name);
                                const target = current[currentIndex + offset];
                                if (target) setLayerSelection(moveLayerSelection(current, layer.name, target.name));
                            }}
                            onDragStart={() => setDraggedLayer(layer.name)}
                            onDragEnd={() => setDraggedLayer(undefined)}
                            onDrop={() =>
                            {
                                if (!draggedLayer || draggedLayer === layer.name) return;
                                setLayerSelection(moveLayerSelection(useAppStore.getState().layerSelection, draggedLayer, layer.name));
                                setDraggedLayer(undefined);
                            }}
                        />
                    ))}
                    {isAddingLayer ? (
                        <NewLayerCard
                            workspace={workspace}
                            onCancel={() => setIsAddingLayer(false)}
                            onAdd={(name) =>
                            {
                                const option = defaultLayerOption(workspace, name);
                                if (!option) return;
                                setLayerSelection([...useAppStore.getState().layerSelection, { name, option }]);
                                setIsAddingLayer(false);
                            }}
                        />
                    ) : null}
                    {!isAddingLayer && layerSelection.length === 0 ? (
                        <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description={catalogLayerNames(workspace).length === 0
                                ? "Create a catalog layer first"
                                : selectableLayers.length === 0 ? "Add an option before using a layer" : "No layers selected"}
                        />
                    ) : null}
                </div>
            </div>
        </section>
    );
}

/** Render the editor for the current workspace selection. */
export function WorkspaceEditor()
{
    const workspace = useAppStore((state) => state.workspace);
    const selection = useAppStore((state) => state.selection);

    if (!workspace) return <Empty description="The user workspace is not loaded yet" />;
    if (selection.kind === "layer-new") return <LayerNewForm workspace={workspace} />;
    if (selection.kind === "layer") return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Choose an option to edit, or use the Layer edit menu." />;
    if (selection.kind === "layer-option" || selection.kind === "layer-option-new") return <LayerOptionForm workspace={workspace} selection={selection} />;
    if (selection.kind === "rule" || selection.kind === "rule-new") return <RuleForm workspace={workspace} selection={selection} />;
    if (selection.kind === "agent" || selection.kind === "agent-new") return <AgentForm workspace={workspace} selection={selection} />;
    if (selection.kind === "generated-file") return <GeneratedFileView workspace={workspace} path={selection.path} />;
    return <GeneratedEmpty />;
}
