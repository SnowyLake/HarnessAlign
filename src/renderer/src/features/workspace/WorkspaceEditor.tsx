/**
 * Ant Design workspace editors that preserve native FormData drafts and Main-process path validation.
 */

import { ApiOutlined, AppstoreOutlined, CloseOutlined, DeleteOutlined, FileTextOutlined, HolderOutlined, PlusOutlined, ThunderboltOutlined } from "@ant-design/icons";
import type { HarnessConfig, LayerSelection, Workspace } from "@shared/models/Workspace";
import { Alert, Button, Card, Checkbox, Col, Empty, Flex, Form, Input, List, Modal, Row, Select, Space, Statistic, Tabs, Tag, Typography } from "antd";
import { useEffect, useLayoutEffect, useRef, useState, type FormEventHandler, type ReactNode, type RefObject } from "react";
import { showSuccess } from "@/components/common/Feedback";
import { SourceEditor } from "@/components/common/SourceEditor";
import { persistEditorSnapshot, refreshWorkspace, runMutation } from "@/features/workspace/WorkspaceTasks";
import { catalogLayerNames, defaultLayerOption, ruleDisplayName } from "@/lib/Utils";
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

/** Render a checkbox set for optional harness targets. */
function TargetBoxes({ selected }: { selected: string[] | undefined })
{
    const workspace = useAppStore((state) => state.workspace);
    return (
        <Form.Item label={<span>Targets <Typography.Text type="secondary">(none means all)</Typography.Text></span>}>
            <Flex vertical gap={8}>
                {(workspace?.config.harnesses ?? []).map((harness) => (
                    <Checkbox key={harness.name} name="targets" value={harness.name} defaultChecked={selected?.includes(harness.name) ?? false}>
                        {harness.name}
                    </Checkbox>
                ))}
            </Flex>
        </Form.Item>
    );
}

/** Render a full mutation error in an Ant Design Alert. */
function FormError({ message }: { message: string | undefined })
{
    if (!message) return null;
    return <Alert type="error" message="Error" description={<span className="pre-wrap">{message}</span>} showIcon />;
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

/** Render the project title editor backed by config.json. */
function ConfigForm({ workspace, showTitle = true }: { workspace: Workspace; showTitle?: boolean })
{
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
                {showTitle ? <Typography.Title level={4}>config.json</Typography.Title> : null}
                <FormError message={formError} />
                <EditorNameField
                    value={configName}
                    isBusy={false}
                    onChange={(value) =>
                    {
                        setConfigName(value);
                        editor.handleValueChange("name", value);
                    }}
                />
            </Form>
        </form>
    );
}

/** Render one harness editor as an official Ant Design Card. */
function HarnessCard({ workspace, harness }: { workspace: Workspace; harness?: HarnessConfig })
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
                <Card
                    size="small"
                    title={<Space><Typography.Text strong>{original ? `Harness: ${original}` : "New harness"}</Typography.Text><Tag>{agentFileFormat}</Tag></Space>}
                    extra={original ? <Button type="text" danger icon={<DeleteOutlined />} disabled={isBusy} onClick={() => setIsDeleteOpen(true)}>Delete</Button> : null}
                >
                    <Form component={false} layout="vertical" requiredMark={false}>
                        <FormError message={formError} />
                        <Form.Item label="Name">
                            <Input
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
                        <Form.Item label="Config path">
                            <Input name="configPath" defaultValue={draftText(editor.draft, "configPath", harness?.configPath ?? "")} />
                        </Form.Item>
                        <Form.Item label="Agent file format">
                            <input type="hidden" name="agentFileFormat" value={agentFileFormat} />
                            <Select
                                value={agentFileFormat}
                                options={[{ label: "md (YAML metadata)", value: "md" }, { label: "toml", value: "toml" }]}
                                onChange={(value: "toml" | "md") =>
                                {
                                    setAgentFileFormat(value);
                                    editor.handleValueChange("agentFileFormat", value);
                                }}
                            />
                        </Form.Item>
                        {agentFileFormat === "toml" ? (
                            <Form.Item label="Instructions field">
                                <Input name="instructionsField" defaultValue={draftText(editor.draft, "instructionsField", harness?.instructionsField ?? "")} />
                            </Form.Item>
                        ) : null}
                        {!original ? <Button type="primary" htmlType="submit" loading={isBusy}>Create harness</Button> : null}
                    </Form>
                </Card>
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
                    }).then((result) =>
                    {
                        if (!result.ok) setFormError(result.message);
                    });
                }}
            />
        </>
    );
}

/** Render the form for creating a layer and its first option. */
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
                <Typography.Title level={4}>New layer</Typography.Title>
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
                <Form.Item label="Initial option">
                    <Input name="initialOption" defaultValue={draftText(editor.draft, "initialOption", "")} />
                </Form.Item>
            </Form>
        </form>
    );
}

/** Render the form for renaming or deleting one catalog layer. */
function LayerForm({ workspace, name }: { workspace: Workspace; name: string })
{
    const isBusy = useAppStore((state) => state.isBusy);
    const [formError, setFormError] = useState<string>();
    const [isDeleteOpen, setIsDeleteOpen] = useState(false);
    const options = Object.hasOwn(workspace.layerOptions, name) ? workspace.layerOptions[name] ?? [] : [];
    const selection: Selection = { kind: "layer", name };
    const editorKey = selectionKey(selection);
    const editor = useEditorForm(selection, () => setIsDeleteOpen(true));
    const [layerName, setLayerName] = useState(draftText(editor.draft, "name", name));

    if (options.length === 0) return <MissingEditorEmpty title="No options" description="This layer has no option files." />;

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
                    <Typography.Title level={4}>Layer</Typography.Title>
                    <FormError message={formError} />
                    <EditorNameField
                        value={layerName}
                        isBusy={isBusy}
                        onChange={(value) =>
                        {
                            setLayerName(value);
                            editor.handleValueChange("name", value);
                        }}
                    />
                    <Typography.Text type="secondary">
                        {options.length === 1 ? "1 option" : `${options.length} options`}. Add this layer to the project from the Home page.
                    </Typography.Text>
                </Form>
            </form>
            <DeleteModal
                open={isDeleteOpen}
                title={`Delete layer ${name}?`}
                description={`This permanently removes .halign/layers/${name}/ and every option inside it.`}
                isBusy={isBusy}
                onCancel={() => setIsDeleteOpen(false)}
                onConfirm={() =>
                {
                    setFormError(undefined);
                    void runMutation(async () =>
                    {
                        await window.appApi.workspace.removeLayer(name);
                        const state = useAppStore.getState();
                        state.clearEditorDraft(editorKey);
                        state.setLayerSelection(state.layerSelection.filter((item) => item.name !== name));
                        await refreshWorkspace();
                        showSuccess(`Deleted layer ${name}`);
                    }).then((result) =>
                    {
                        if (!result.ok) setFormError(result.message);
                    });
                }}
            />
        </>
    );
}

/** Props for one ordered layer card on the Home page. */
interface LayerCardProps
{
    workspace: Workspace;
    selection: LayerSelection;
    isDragging: boolean;
    onDragStart: () => void;
    onDragEnd: () => void;
    onDrop: () => void;
}

/** Render the picker for adding an existing catalog layer to the project. */
function NewLayerCard({ workspace, onAdd, onCancel }: { workspace: Workspace; onAdd: (name: string) => void; onCancel: () => void })
{
    const isBusy = useAppStore((state) => state.isBusy);
    const layerSelection = useAppStore((state) => state.layerSelection);
    const available = catalogLayerNames(workspace).filter((name) => !layerSelection.some((item) => item.name === name));

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
function LayerCard({ workspace, selection, isDragging, onDragStart, onDragEnd, onDrop }: LayerCardProps)
{
    const isBusy = useAppStore((state) => state.isBusy);
    const setSelection = useAppStore((state) => state.setSelection);
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
                title={<Space><HolderOutlined /><span>{selection.name}</span></Space>}
                extra={<Button type="text" danger icon={<CloseOutlined />} aria-label={`Remove ${selection.name}`} onClick={() => setIsRemoveOpen(true)} />}
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
                onFocusCapture={() => setSelection({ kind: "config" })}
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
                <Typography.Paragraph>The files in .halign/layers/{selection.name}/ are kept.</Typography.Paragraph>
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
            ? ".halign/rules/new-rule.md"
            : ".halign/rules/shared/new-rule.md";
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
                    <Typography.Title level={4}>{isShared ? "Shared rule" : "Rule"}</Typography.Title>
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
                            className="source-editor-large"
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
                    title={`Delete ${existingPath}?`}
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
                            showSuccess(`Deleted ${existingPath}`);
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
    const canDelete = Boolean(existing && layerConfig?.selected !== existing.name && (workspace.layerOptions[existing.layer]?.length ?? 0) > 1);
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
                    <Typography.Title level={4}>Layer option</Typography.Title>
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
                            className="source-editor-large"
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
                            await refreshWorkspace();
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
                    <Typography.Title level={4}>Agent</Typography.Title>
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
                                        autoHeight
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
                            className="source-editor-large"
                            defaultValue={draftText(editor.draft, "body", existing?.body ?? "Instructions.\n")}
                        />
                    </Form.Item>
                </Form>
            </form>
            {existing ? (
                <DeleteModal
                    open={isDeleteOpen}
                    title={`Delete ${existing.path}?`}
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
                            showSuccess(`Deleted ${existing.path}`);
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
        <Space direction="vertical" size="middle" className="full-width">
            <div>
                <Typography.Title level={4}>{file.path}</Typography.Title>
                <Typography.Text type="secondary">.halign/generated/{file.path}</Typography.Text>
            </div>
            <SourceEditor
                aria-label={file.path}
                className="source-editor-generated"
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
    return <Empty description="Run Generate to populate .halign/generated" />;
}

/** Render an empty editor state for a selection that no longer exists. */
function MissingEditorEmpty({ title, description }: { title: string; description: string })
{
    return <Empty description={<Space direction="vertical" size={2}><Typography.Text strong>{title}</Typography.Text><Typography.Text type="secondary">{description}</Typography.Text></Space>} />;
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

/** Render the unified Home page for project identity, harnesses, layers, and skill sources. */
export function ProjectEditor()
{
    const workspace = useAppStore((state) => state.workspace);
    const selection = useAppStore((state) => state.selection);
    const setSelection = useAppStore((state) => state.setSelection);
    const isBusy = useAppStore((state) => state.isBusy);
    const layerSelection = useAppStore((state) => state.layerSelection);
    const setLayerSelection = useAppStore((state) => state.setLayerSelection);
    const [draggedLayer, setDraggedLayer] = useState<string>();
    const [isAddingLayer, setIsAddingLayer] = useState(false);

    if (!workspace) return <Empty description="The user workspace is not loaded yet" />;

    return (
        <div className="project-page">
            <Card className="project-overview-card">
                <Flex justify="space-between" align="center" gap={32} wrap>
                    <div className="project-overview-copy">
                        <Typography.Text className="section-eyebrow">Active workspace</Typography.Text>
                        <Typography.Title level={2}>{workspace.config.name}</Typography.Title>
                        <Typography.Text type="secondary" ellipsis title={`${workspace.root}\\.halign`}>{`${workspace.root}\\.halign`}</Typography.Text>
                    </div>
                    <div className="project-overview-metrics">
                        <Statistic title="Harnesses" value={workspace.config.harnesses.length} prefix={<ApiOutlined />} />
                        <Statistic title="Active layers" value={layerSelection.length} prefix={<AppstoreOutlined />} />
                        <Statistic title="Rules" value={workspace.rootRules.length + workspace.sharedRules.length} prefix={<FileTextOutlined />} />
                        <Statistic title="Skills" value={workspace.skills.length} prefix={<ThunderboltOutlined />} />
                    </div>
                </Flex>
            </Card>
            <Row gutter={[16, 16]} align="stretch">
                <Col xs={24} xl={8}>
                    <Card title="Project identity" extra={<Typography.Text type="secondary">config.json</Typography.Text>} className="project-section-card">
                        <Typography.Paragraph type="secondary">The name used in generated instruction headers.</Typography.Paragraph>
                        <ConfigForm workspace={workspace} showTitle={false} />
                    </Card>
                </Col>
                <Col xs={24} xl={16}>
                    <Card
                        title="Generation layers"
                        className="project-section-card"
                        extra={(
                            <Button
                                type="link"
                                icon={<PlusOutlined />}
                                disabled={isBusy || isAddingLayer || catalogLayerNames(workspace).every((name) => layerSelection.some((item) => item.name === name))}
                                onClick={() => setIsAddingLayer(true)}
                            >
                                Add layer
                            </Button>
                        )}
                    >
                        <Typography.Paragraph type="secondary">Choose one option per layer. Drag cards to control generation order.</Typography.Paragraph>
                        <div className="project-layer-grid">
                            {layerSelection.map((layer) => (
                                <LayerCard
                                    key={layer.name}
                                    workspace={workspace}
                                    selection={layer}
                                    isDragging={draggedLayer === layer.name}
                                    onDragStart={() =>
                                    {
                                        setSelection({ kind: "config" });
                                        setDraggedLayer(layer.name);
                                    }}
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
                            {catalogLayerNames(workspace).length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Create a layer on the Layers page, then add it here" /> : null}
                        </div>
                    </Card>
                </Col>
            </Row>
            <Card
                title="Harness targets"
                extra={<Button type="link" icon={<PlusOutlined />} disabled={isBusy} onClick={() => setSelection({ kind: "harness-new" })}>Add harness</Button>}
            >
                <Typography.Paragraph type="secondary">Each harness defines its output location and agent metadata format.</Typography.Paragraph>
                <div className="project-harness-grid">
                    {workspace.config.harnesses.map((harness) => <HarnessCard key={harness.name} workspace={workspace} harness={harness} />)}
                    {selection.kind === "harness-new" ? <HarnessCard workspace={workspace} /> : null}
                </div>
            </Card>
            <SkillsSourcesSection workspace={workspace} />
        </div>
    );
}

/** Render GitHub skill source registration on the Home page. */
function SkillsSourcesSection({ workspace }: { workspace: Workspace })
{
    const isBusy = useAppStore((state) => state.isBusy);
    const [isAdding, setIsAdding] = useState(false);
    const [formError, setFormError] = useState<string>();

    return (
        <Card
            title="Skill sources"
            extra={<Button type="text" icon={<PlusOutlined />} disabled={isBusy || isAdding} onClick={() => setIsAdding(true)}>Add source</Button>}
        >
            <Typography.Paragraph type="secondary">Register GitHub repositories used by the Skills page for discovery and download.</Typography.Paragraph>
            <FormError message={formError} />
            <List
                locale={{ emptyText: "No skill sources registered" }}
                dataSource={workspace.config.skillSources}
                renderItem={(source) => (
                    <List.Item
                        actions={[
                            <Button
                                key="remove"
                                type="text"
                                danger
                                icon={<DeleteOutlined />}
                                disabled={isBusy}
                                onClick={() =>
                                {
                                    setFormError(undefined);
                                    void runMutation(async () =>
                                    {
                                        await window.appApi.workspace.removeSkillSource(source.owner, source.name);
                                        await refreshWorkspace({ kind: "config" });
                                        showSuccess("Skill source removed");
                                    }).then((result) =>
                                    {
                                        if (!result.ok) setFormError(result.message);
                                    });
                                }}
                            >
                                Remove
                            </Button>,
                        ]}
                    >
                        <List.Item.Meta title={`https://github.com/${source.owner}/${source.name}`} description={`Branch: ${source.branch}`} />
                    </List.Item>
                )}
            />
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
            ) : null}
        </Card>
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
                    await window.appApi.workspace.addSkillSource(input);
                    await refreshWorkspace({ kind: "config" });
                    showSuccess("Skill source added");
                    onAdded();
                }).then((result) =>
                {
                    if (!result.ok) onError(result.message);
                });
            }}
        >
            <Card
                size="small"
                title="New skill source"
                extra={<Button type="text" icon={<CloseOutlined />} disabled={isBusy} aria-label="Cancel new skill source" onClick={onCancel} />}
            >
                <Form component={false} layout="vertical" requiredMark={false}>
                    <Form.Item label="Repository URL">
                        <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://github.com/owner/repo" disabled={isBusy} />
                    </Form.Item>
                    <Form.Item label="Branch (optional)">
                        <Input value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="main" disabled={isBusy} />
                    </Form.Item>
                    <Button type="primary" htmlType="submit" disabled={isBusy || !url.trim()}>Add source</Button>
                </Form>
            </Card>
        </form>
    );
}

/** Render the editor for the current workspace selection. */
export function WorkspaceEditor()
{
    const workspace = useAppStore((state) => state.workspace);
    const selection = useAppStore((state) => state.selection);

    if (!workspace) return <Empty description="The user workspace is not loaded yet" />;
    if (selection.kind === "config") return <ConfigForm workspace={workspace} />;
    if (selection.kind === "harness")
    {
        const harness = workspace.config.harnesses.find((item) => item.name === selection.name);
        return harness ? <HarnessCard workspace={workspace} harness={harness} /> : <MissingEditorEmpty title="Harness not found" description="This harness is no longer in the workspace." />;
    }
    if (selection.kind === "harness-new") return <HarnessCard workspace={workspace} />;
    if (selection.kind === "layer-new") return <LayerNewForm workspace={workspace} />;
    if (selection.kind === "layer") return <LayerForm workspace={workspace} name={selection.name} />;
    if (selection.kind === "layer-option" || selection.kind === "layer-option-new") return <LayerOptionForm workspace={workspace} selection={selection} />;
    if (selection.kind === "rule" || selection.kind === "rule-new") return <RuleForm workspace={workspace} selection={selection} />;
    if (selection.kind === "agent" || selection.kind === "agent-new") return <AgentForm workspace={workspace} selection={selection} />;
    if (selection.kind === "generated-file") return <GeneratedFileView workspace={workspace} path={selection.path} />;
    return <GeneratedEmpty />;
}
