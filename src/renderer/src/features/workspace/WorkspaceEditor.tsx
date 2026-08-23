/**
 * Workspace editors that call `window.appApi`.
 * Saves go through Main path checks; this module never imports Node or Electron.
 */

import type { HarnessConfig, LayerSelection, Workspace } from "@shared/models/Workspace";
import { useEffect, useLayoutEffect, useRef, useState, type FormEventHandler, type RefObject } from "react";
import { ChevronRightIcon, GripVerticalIcon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SourceEditor } from "@/components/ui/source-editor";
import { toast } from "@/components/ui/toast";
import { persistEditorSnapshot, refreshWorkspace, runMutation } from "@/features/workspace/WorkspaceTasks";
import { catalogLayerNames, cn, defaultLayerOption, ruleDisplayName } from "@/lib/Utils";
import { selectionKey, useAppStore, type EditorDraft, type FormSnapshot, type Selection } from "@/stores/AppStore";

/** Form bindings that preserve drafts and respond to tree commands. */
interface EditorFormBinding
{
    draft: EditorDraft | undefined;
    formRef: RefObject<HTMLFormElement | null>;
    handleChange: FormEventHandler<HTMLFormElement>;
    handleValueChange: (name: string, value: string) => void;
}

/** Capture text form fields and checked checkbox values in deterministic key order. */
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

/** Consume the next matching tree command with the handlers owned by the mounted editor. */
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

/** Bind an uncontrolled form to persistent drafts and external save or delete commands. */
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

    const handleChange: FormEventHandler<HTMLFormElement> = (event) =>
    {
        const current = formSnapshot(event.currentTarget);
        const baseline = baselineRef.current ?? current;
        setEditorDraft(editorKey, snapshotsEqual(baseline, current) ? undefined : { selection, baseline, current });
    };

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

/** Persist one mounted editor form and refresh it under any resulting selection. */
async function persistEditorForm(workspace: Workspace, selection: Selection, snapshot: FormSnapshot): Promise<void>
{
    const result = await persistEditorSnapshot(workspace, selection, snapshot);
    const state = useAppStore.getState();
    state.clearEditorDraft(selectionKey(selection));
    state.clearEditorDraft(selectionKey(result.selection));
    await refreshWorkspace(result.selection);
    toast.add({ title: result.message, type: "success" });
}

/** Checkbox list of harness targets; empty means all harnesses. */
function TargetBoxes({ selected }: { selected: string[] | undefined })
{
    const workspace = useAppStore((state) => state.workspace);
    return (
        <FieldSet>
            <FieldLegend variant="label">Targets <span className="font-normal text-muted-foreground">(none means all)</span></FieldLegend>
            <FieldGroup className="gap-2">
            {(workspace?.config.harnesses ?? []).map((harness) => (
                <Field key={harness.name} orientation="horizontal">
                    <Checkbox id={`target-${harness.name}`} name="targets" value={harness.name} defaultChecked={selected?.includes(harness.name) ?? false} />
                    <FieldLabel htmlFor={`target-${harness.name}`}>{harness.name}</FieldLabel>
                </Field>
            ))}
            </FieldGroup>
        </FieldSet>
    );
}

/** Inline form error banner. */
function FormError({ message }: { message: string | undefined })
{
    if (!message) return null;
    return (
        <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription className="whitespace-pre-wrap">{message}</AlertDescription>
        </Alert>
    );
}

/** Props for a click-to-edit heading bound to a named form field. */
interface EditableHeadingProps
{
    name: string;
    value: string;
    onChange: (value: string) => void;
}

/** Click-to-edit heading that writes a named field into the surrounding form. */
function EditableHeading({ name, value, onChange }: EditableHeadingProps)
{
    const [isEditing, setIsEditing] = useState(false);
    const startRef = useRef(value);

    /** Switch the heading into an inline text field. */
    const startEdit = (): void =>
    {
        startRef.current = value;
        setIsEditing(true);
    };

    if (isEditing)
    {
        return (
            <input
                autoFocus
                type="text"
                name={name}
                aria-label={name}
                value={value}
                onChange={(event) => onChange(event.currentTarget.value)}
                onBlur={() => setIsEditing(false)}
                onKeyDown={(event) =>
                {
                    if (event.key === "Enter")
                    {
                        event.preventDefault();
                        setIsEditing(false);
                    }
                    if (event.key === "Escape")
                    {
                        event.preventDefault();
                        onChange(startRef.current);
                        setIsEditing(false);
                    }
                }}
                className="h-9 min-w-0 flex-1 rounded-md bg-background px-1 text-lg font-semibold outline-none ring-2 ring-ring/50"
            />
        );
    }

    return (
        <>
            <input type="hidden" name={name} value={value} />
            <h1
                tabIndex={0}
                className="min-w-0 flex-1 cursor-text break-all px-1 text-lg font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                onClick={startEdit}
                onKeyDown={(event) =>
                {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    startEdit();
                }}
            >
                {value || <span className="text-muted-foreground">{name}</span>}
            </h1>
        </>
    );
}

/** Title row with a click-to-edit heading and an optional creation action. */
function EditorNameHeader({ name, value, onChange, isBusy, submitLabel }: { name: string; value: string; onChange: (value: string) => void; isBusy: boolean; submitLabel?: string | undefined })
{
    return (
        <div className="flex items-center justify-between gap-3">
            <EditableHeading name={name} value={value} onChange={onChange} />
            {submitLabel ? <Button type="submit" size="sm" disabled={isBusy} onMouseDown={(event) => event.preventDefault()}>{submitLabel}</Button> : null}
        </div>
    );
}

/** Editor for `config.json` title and saved ordered layer selection. */
function ConfigForm({ workspace, showTitle = true }: { workspace: Workspace; showTitle?: boolean })
{
    const setSelection = useAppStore((state) => state.setSelection);
    const [formError, setFormError] = useState<string | undefined>();
    const selection: Selection = { kind: "config" };
    const editor = useEditorForm(selection);
    const [configName, setConfigName] = useState(draftText(editor.draft, "name", workspace.config.name));

    return (
        <form
            ref={editor.formRef}
            className="flex h-full min-h-0 w-full min-w-0 flex-col gap-3"
            onFocusCapture={() => setSelection({ kind: "config" })}
            onChange={editor.handleChange}
            onSubmit={(event) =>
            {
                event.preventDefault();
                const snapshot = formSnapshot(event.currentTarget);
                setFormError(undefined);
                void runMutation(async () =>
                {
                    await persistEditorForm(workspace, selection, snapshot);
                }).then((result) =>
                {
                    if (!result.ok) setFormError(result.message);
                });
            }}
        >
            {showTitle ? (
                <>
                    <h2 className="text-base font-semibold">config.json</h2>
                    <FormError message={formError} />
                    <Field><FieldLabel htmlFor="config-name">Name</FieldLabel><Input id="config-name" name="name" defaultValue={draftText(editor.draft, "name", workspace.config.name)} /></Field>
                </>
            ) : (
                <>
                    <div className="flex items-center justify-between gap-3">
                        <EditableHeading
                            name="name"
                            value={configName}
                            onChange={(value) =>
                            {
                                setConfigName(value);
                                editor.handleValueChange("name", value);
                            }}
                        />
                    </div>
                    <FormError message={formError} />
                </>
            )}
        </form>
    );
}

/** Collapsible editor card for one existing or newly created harness. */
function HarnessCard({ workspace, harness, isInitiallyOpen = false }: { workspace: Workspace; harness?: HarnessConfig; isInitiallyOpen?: boolean })
{
    const isBusy = useAppStore((state) => state.isBusy);
    const setSelection = useAppStore((state) => state.setSelection);
    const original = harness?.name;
    const [formError, setFormError] = useState<string | undefined>();
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [isOpen, setIsOpen] = useState(isInitiallyOpen);
    const [isRenaming, setIsRenaming] = useState(false);
    const renameStartRef = useRef(original ?? "");
    const selection: Selection = original ? { kind: "harness", name: original } : { kind: "harness-new" };
    const editorKey = selectionKey(selection);
    const editor = useEditorForm(selection, original ? () => setDeleteOpen(true) : undefined);
    const [harnessName, setHarnessName] = useState(draftText(editor.draft, "name", original ?? ""));
    const [agentFileFormat, setAgentFileFormat] = useState<"toml" | "md">(
        draftText(editor.draft, "agentFileFormat", harness?.agentFormat === "toml" ? "toml" : "md") === "toml" ? "toml" : "md",
    );

    const card = (
        <form
                ref={editor.formRef}
                className="w-full min-w-0"
                onFocusCapture={() => setSelection(original ? { kind: "harness", name: original } : { kind: "harness-new" })}
                onChange={editor.handleChange}
                onSubmit={(event) =>
                {
                    event.preventDefault();
                    const snapshot = formSnapshot(event.currentTarget);
                    setFormError(undefined);
                    void runMutation(async () =>
                    {
                        await persistEditorForm(workspace, selection, snapshot);
                    }).then((result) =>
                    {
                        if (!result.ok) setFormError(result.message);
                    });
                }}
            >
                <Card size="sm">
                <Collapsible
                    open={isOpen}
                    onOpenChange={setIsOpen}
                >
                    {isRenaming ? (
                        <CardHeader className="flex flex-row items-center gap-2">
                            <ChevronRightIcon className={cn("shrink-0 transition-transform", isOpen && "rotate-90")} />
                            <input
                                autoFocus
                                type="text"
                                name="name"
                                aria-label="Harness name"
                                value={harnessName}
                                onClick={(event) => event.stopPropagation()}
                                onBlur={() => setIsRenaming(false)}
                                onChange={(event) => setHarnessName(event.currentTarget.value)}
                                onKeyDown={(event) =>
                                {
                                    if (event.key === "Enter")
                                    {
                                        event.preventDefault();
                                        setIsRenaming(false);
                                    }
                                    if (event.key === "Escape")
                                    {
                                        event.preventDefault();
                                        setHarnessName(renameStartRef.current);
                                        editor.handleValueChange("name", renameStartRef.current);
                                        setIsRenaming(false);
                                    }
                                }}
                                className="h-6 min-w-20 max-w-64 rounded-md bg-background px-1 font-medium outline-none ring-2 ring-ring/50"
                                style={{ width: `${Math.max(harnessName.length + 1, 5)}ch` }}
                            />
                        </CardHeader>
                    ) : (
                        <CollapsibleTrigger render={<button type="button" className="w-full text-left" />}>
                            <CardHeader className="flex flex-row items-center gap-2">
                                <ChevronRightIcon className={cn("shrink-0 transition-transform", isOpen && "rotate-90")} />
                                <input type="hidden" name="name" value={harnessName} />
                                <CardTitle className="flex-1 break-all">{harnessName || "New harness"}</CardTitle>
                            </CardHeader>
                        </CollapsibleTrigger>
                    )}
                    <CollapsibleContent>
                    <CardContent><FieldGroup>
                        <FormError message={formError} />
                        <Field><FieldLabel htmlFor={`${editorKey}-config-path`}>Config path</FieldLabel><Input id={`${editorKey}-config-path`} name="configPath" defaultValue={draftText(editor.draft, "configPath", harness?.configPath ?? "")} /></Field>
                        <Field>
                            <FieldLabel htmlFor={`${editorKey}-format`}>Agent file format</FieldLabel>
                            <Select
                                items={[{ label: "md (YAML metadata)", value: "md" }, { label: "toml", value: "toml" }]}
                                name="agentFileFormat"
                                value={agentFileFormat}
                                onValueChange={(value) =>
                                {
                                    if (value === null) return;
                                    const nextFormat = value === "toml" ? "toml" : "md";
                                    setAgentFileFormat(nextFormat);
                                    editor.handleValueChange("agentFileFormat", nextFormat);
                                }}
                            >
                                <SelectTrigger id={`${editorKey}-format`} className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup><SelectItem value="md">md (YAML metadata)</SelectItem><SelectItem value="toml">toml</SelectItem></SelectGroup>
                                </SelectContent>
                            </Select>
                        </Field>
                        {agentFileFormat === "toml" ? (
                            <Field><FieldLabel htmlFor={`${editorKey}-instructions-field`}>Instructions field</FieldLabel><Input id={`${editorKey}-instructions-field`} name="instructionsField" defaultValue={draftText(editor.draft, "instructionsField", harness?.instructionsField ?? "")} /></Field>
                        ) : null}
                        {!original ? (
                            <div className="flex justify-end">
                                <Button type="submit" disabled={isBusy} onMouseDown={(event) => event.preventDefault()}>Create harness</Button>
                            </div>
                        ) : null}
                    </FieldGroup></CardContent>
                    </CollapsibleContent>
                </Collapsible>
                </Card>
        </form>
    );

    return (
        <>
            <ContextMenu>
                <ContextMenuTrigger render={card} />
                <ContextMenuContent>
                            <ContextMenuGroup>
                            <ContextMenuItem
                                disabled={isBusy}
                                onClick={() =>
                                {
                                    renameStartRef.current = harnessName;
                                    setSelection(original ? { kind: "harness", name: original } : { kind: "harness-new" });
                                    setIsRenaming(true);
                                }}
                            >
                                <PencilIcon />
                                <span>Rename</span>
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem
                                variant="destructive"
                                disabled={isBusy || !original}
                                onClick={() => setDeleteOpen(true)}
                            >
                                <Trash2Icon />
                                <span>Delete</span>
                            </ContextMenuItem>
                            </ContextMenuGroup>
                </ContextMenuContent>
            </ContextMenu>
            <ConfirmDialog
                open={deleteOpen}
                onOpenChange={setDeleteOpen}
                title={`Delete harness ${original}?`}
                description="This removes the harness declaration from config.json and updates related targets."
                confirmLabel="Delete"
                destructive
                confirmDisabled={isBusy}
                onConfirm={() =>
                {
                    if (!original) return;
                    setFormError(undefined);
                    void runMutation(async () =>
                    {
                        await window.appApi.workspace.removeHarness(original);
                        useAppStore.getState().clearEditorDraft(editorKey);
                        await refreshWorkspace();
                        toast.add({ title: `Deleted harness ${original}`, type: "success" });
                    }).then((result) =>
                    {
                        if (!result.ok) setFormError(result.message);
                    });
                }}
            />
        </>
    );
}

/** Editor for creating a layer with its first empty option. */
function LayerNewForm({ workspace }: { workspace: Workspace })
{
    const isBusy = useAppStore((state) => state.isBusy);
    const setSelection = useAppStore((state) => state.setSelection);
    const [formError, setFormError] = useState<string | undefined>();
    const selection: Selection = { kind: "layer-new" };
    const editor = useEditorForm(selection);
    const [layerName, setLayerName] = useState(draftText(editor.draft, "name", "new-layer"));

    return (
        <form
            ref={editor.formRef}
            className="flex h-full min-h-0 w-full min-w-0 flex-col gap-3"
            onFocusCapture={() => setSelection({ kind: "layer-new" })}
            onChange={editor.handleChange}
            onSubmit={(event) =>
            {
                event.preventDefault();
                const snapshot = formSnapshot(event.currentTarget);
                setFormError(undefined);
                void runMutation(async () =>
                {
                    await persistEditorForm(workspace, selection, snapshot);
                }).then((result) =>
                {
                    if (!result.ok) setFormError(result.message);
                });
            }}
        >
            <EditorNameHeader
                name="name"
                value={layerName}
                isBusy={isBusy}
                submitLabel="Create layer"
                onChange={(value) =>
                {
                    setLayerName(value);
                    editor.handleValueChange("name", value);
                }}
            />
            <FormError message={formError} />
            <Field><FieldLabel htmlFor="initial-option">Initial option</FieldLabel><Input id="initial-option" name="initialOption" defaultValue={draftText(editor.draft, "initialOption", "")} /></Field>
        </form>
    );
}

/** Editor for renaming or deleting one catalog Layer. */
function LayerForm({ workspace, name }: { workspace: Workspace; name: string })
{
    const isBusy = useAppStore((state) => state.isBusy);
    const [formError, setFormError] = useState<string | undefined>();
    const [deleteOpen, setDeleteOpen] = useState(false);
    const options = Object.hasOwn(workspace.layerOptions, name) ? workspace.layerOptions[name] ?? [] : [];
    const selection: Selection = { kind: "layer", name };
    const editorKey = selectionKey(selection);
    const editor = useEditorForm(selection, () => setDeleteOpen(true));
    const [layerName, setLayerName] = useState(draftText(editor.draft, "name", name));

    if (options.length === 0)
    {
        return <MissingEditorEmpty title="No options" description="This layer has no option files." />;
    }

    return (
        <>
            <form
                ref={editor.formRef}
                className="flex h-full min-h-0 w-full min-w-0 flex-col gap-3"
                onChange={editor.handleChange}
                onSubmit={(event) =>
                {
                    event.preventDefault();
                    const snapshot = formSnapshot(event.currentTarget);
                    setFormError(undefined);
                    void runMutation(async () =>
                    {
                        await persistEditorForm(workspace, selection, snapshot);
                    }).then((result) =>
                    {
                        if (!result.ok) setFormError(result.message);
                    });
                }}
            >
                <EditorNameHeader
                    name="name"
                    value={layerName}
                    isBusy={isBusy}
                    onChange={(value) =>
                    {
                        setLayerName(value);
                        editor.handleValueChange("name", value);
                    }}
                />
                <FormError message={formError} />
                <p className="text-sm text-muted-foreground">
                    {options.length === 1 ? "1 option" : `${options.length} options`}. Add this layer to the project from the Home page.
                </p>
            </form>
            <ConfirmDialog
                open={deleteOpen}
                onOpenChange={setDeleteOpen}
                title={`Delete layer ${name}?`}
                description={`This permanently removes .halign/layers/${name}/ and every option inside it.`}
                confirmLabel="Delete"
                destructive
                confirmDisabled={isBusy}
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
                        toast.add({ title: `Deleted layer ${name}`, type: "success" });
                    }).then((result) =>
                    {
                        if (!result.ok) setFormError(result.message);
                    });
                }}
            />
        </>
    );
}

/** Props for one ordered Layer card on the Home page. */
interface LayerCardProps
{
    workspace: Workspace;
    selection: LayerSelection;
    isDragging: boolean;
    onDragStart: () => void;
    onDragEnd: () => void;
    onDrop: () => void;
}

/** Dashed card that picks a catalog Layer and adds it to the project selection. */
function NewLayerCard({ workspace, onAdd, onCancel }: { workspace: Workspace; onAdd: (name: string) => void; onCancel: () => void })
{
    const isBusy = useAppStore((state) => state.isBusy);
    const layerSelection = useAppStore((state) => state.layerSelection);
    const available = catalogLayerNames(workspace).filter((name) => !layerSelection.some((item) => item.name === name));

    return (
        <Card size="sm">
            <CardHeader>
                <CardTitle>New layer</CardTitle>
                <CardAction><Button type="button" size="icon-sm" variant="ghost" disabled={isBusy} aria-label="Cancel new layer" onClick={onCancel}>
                    <XIcon data-icon="inline-start" />
                </Button></CardAction>
            </CardHeader>
            <CardContent>
            {available.length === 0 ? (
                <p className="text-sm text-muted-foreground">Every catalog layer is already in this project.</p>
            ) : (
                <Field>
                    <FieldLabel htmlFor="new-project-layer">Layer</FieldLabel>
                    <Select
                        items={[{ label: "Choose a layer", value: null }, ...available.map((name) => ({ label: name, value: name }))]}
                        value={null}
                        onValueChange={(value) =>
                        {
                            if (value !== null) onAdd(value);
                        }}
                    >
                        <SelectTrigger id="new-project-layer" size="sm" className="w-full" disabled={isBusy}>
                            <SelectValue placeholder="Choose a layer" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>{available.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectGroup>
                        </SelectContent>
                    </Select>
                </Field>
            )}
            </CardContent>
        </Card>
    );
}

/** Project card for choosing one option and reordering an existing Layer. */
function LayerCard({ workspace, selection, isDragging, onDragStart, onDragEnd, onDrop }: LayerCardProps)
{
    const isBusy = useAppStore((state) => state.isBusy);
    const setSelection = useAppStore((state) => state.setSelection);
    const setLayerSelection = useAppStore((state) => state.setLayerSelection);
    const [removeOpen, setRemoveOpen] = useState(false);
    const options = Object.hasOwn(workspace.layerOptions, selection.name) ? workspace.layerOptions[selection.name] ?? [] : [];

    return (
        <Card
            size="sm"
            draggable={!isBusy}
            onDragStart={(event) =>
            {
                event.dataTransfer.effectAllowed = "move";
                onDragStart();
            }}
            onDragEnd={onDragEnd}
            onDragOver={(event) =>
            {
                event.preventDefault();
            }}
            onDrop={(event) =>
            {
                event.preventDefault();
                onDrop();
            }}
            onFocusCapture={() => setSelection({ kind: "config" })}
            className={cn(isDragging && "opacity-40")}
        >
            <CardHeader className="flex flex-row items-center gap-2">
                <GripVerticalIcon className="shrink-0 cursor-grab text-muted-foreground" />
                <CardTitle className="flex-1 break-all">{selection.name}</CardTitle>
                <Button type="button" size="icon-sm" variant="ghost" disabled={isBusy} aria-label={`Remove ${selection.name}`} onClick={() => setRemoveOpen(true)}>
                    <XIcon />
                </Button>
            </CardHeader>
            <CardContent><Field>
                <FieldLabel htmlFor={`layer-option-${selection.name}`}>Selected option</FieldLabel>
                <Select
                    items={options.map((option) => ({ label: option.name, value: option.name }))}
                    value={selection.option}
                    onValueChange={(value) =>
                    {
                        if (value === null) return;
                        setLayerSelection(useAppStore.getState().layerSelection.map((item) => item.name === selection.name ? { ...item, option: value } : item));
                    }}
                >
                    <SelectTrigger id={`layer-option-${selection.name}`} size="sm" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectGroup>{options.map((option) => <SelectItem key={option.name} value={option.name}>{option.name}</SelectItem>)}</SelectGroup>
                    </SelectContent>
                </Select>
            </Field></CardContent>
            <ConfirmDialog
                open={removeOpen}
                onOpenChange={setRemoveOpen}
                title={`Remove ${selection.name} from this project?`}
                description={`The files in .halign/layers/${selection.name}/ are kept. Add the layer again from the list when you need it.`}
                confirmLabel="Remove"
                confirmDisabled={isBusy}
                onConfirm={() =>
                {
                    setLayerSelection(useAppStore.getState().layerSelection.filter((item) => item.name !== selection.name));
                    toast.add({ title: `Removed layer ${selection.name}`, type: "success" });
                }}
            />
        </Card>
    );
}

/** Editor for a root or shared rule. */
function RuleForm({ workspace, selection }: { workspace: Workspace; selection: Extract<Selection, { kind: "rule" } | { kind: "rule-new" }> })
{
    const isBusy = useAppStore((state) => state.isBusy);
    const [formError, setFormError] = useState<string | undefined>();
    const [deleteOpen, setDeleteOpen] = useState(false);
    const isShared = (selection.kind === "rule-new" && selection.scope === "shared")
        || (selection.kind === "rule" && workspace.sharedRules.some((rule) => rule.path === selection.path));
    const defaultPath = selection.kind === "rule"
        ? selection.path
        : selection.scope === "root"
            ? ".halign/rules/new-rule.md"
            : ".halign/rules/shared/new-rule.md";
    const sharedExisting = workspace.sharedRules.find((rule) => selection.kind === "rule" && rule.path === selection.path);
    const existing = selection.kind === "rule"
        ? workspace.rootRules.find((rule) => rule.path === selection.path)
        : undefined;
    const existingPath = sharedExisting?.path ?? existing?.path;
    const editorKey = selectionKey(selection);
    const editor = useEditorForm(selection, existingPath ? () => setDeleteOpen(true) : undefined);
    const [ruleName, setRuleName] = useState(draftText(editor.draft, "name", ruleDisplayName(existingPath ?? defaultPath)));

    const deleteDialog = existingPath ? (
        <ConfirmDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            title={`Delete ${existingPath}?`}
            description="This permanently deletes the source file from the workspace."
            confirmLabel="Delete"
            destructive
            confirmDisabled={isBusy}
            onConfirm={() =>
            {
                setFormError(undefined);
                void runMutation(async () =>
                {
                    await window.appApi.workspace.deleteSource(existingPath);
                    useAppStore.getState().clearEditorDraft(editorKey);
                    await refreshWorkspace();
                    toast.add({ title: `Deleted ${existingPath}`, type: "success" });
                }).then((result) =>
                {
                    if (!result.ok) setFormError(result.message);
                });
            }}
        />
    ) : null;

    if (isShared)
    {
        return (
            <>
                <form
                    ref={editor.formRef}
                    className="flex h-full min-h-0 w-full min-w-0 flex-col gap-3"
                    onChange={editor.handleChange}
                    onSubmit={(event) =>
                    {
                        event.preventDefault();
                        const snapshot = formSnapshot(event.currentTarget);
                        setFormError(undefined);
                        void runMutation(async () =>
                        {
                            await persistEditorForm(workspace, selection, snapshot);
                        }).then((result) =>
                        {
                            if (!result.ok) setFormError(result.message);
                        });
                    }}
                >
                    <EditorNameHeader
                        name="name"
                        value={ruleName}
                        isBusy={isBusy}
                        submitLabel={selection.kind === "rule-new" ? "Create rule" : undefined}
                        onChange={(value) =>
                        {
                            setRuleName(value);
                            editor.handleValueChange("name", value);
                        }}
                    />
                    <FormError message={formError} />
                    <Field className="min-h-0 flex-1">
                        <FieldTitle>Body</FieldTitle>
                        <SourceEditor aria-label="Shared rule body" className="min-h-40 flex-1" name="body" language="markdown" defaultValue={draftText(editor.draft, "body", sharedExisting?.body ?? "# Title\n\nbody\n")} />
                    </Field>
                </form>
                {deleteDialog}
            </>
        );
    }

    return (
        <>
            <form
                ref={editor.formRef}
                className="flex h-full min-h-0 w-full min-w-0 flex-col gap-3"
                onChange={editor.handleChange}
                onSubmit={(event) =>
                {
                    event.preventDefault();
                    const snapshot = formSnapshot(event.currentTarget);
                    setFormError(undefined);
                    void runMutation(async () =>
                    {
                        await persistEditorForm(workspace, selection, snapshot);
                    }).then((result) =>
                    {
                        if (!result.ok) setFormError(result.message);
                    });
                }}
            >
                <EditorNameHeader
                    name="name"
                    value={ruleName}
                    isBusy={isBusy}
                    submitLabel={selection.kind === "rule-new" ? "Create rule" : undefined}
                    onChange={(value) =>
                    {
                        setRuleName(value);
                        editor.handleValueChange("name", value);
                    }}
                />
                <FormError message={formError} />
                <TargetBoxes selected={draftValues(editor.draft, "targets", existing?.targets)} />
                <Field className="min-h-0 flex-1">
                    <FieldTitle>Body</FieldTitle>
                    <SourceEditor aria-label="Rule body" className="min-h-40 flex-1" name="body" language="markdown" defaultValue={draftText(editor.draft, "body", existing?.body ?? "# Title\n\nbody\n")} />
                </Field>
            </form>
            {deleteDialog}
        </>
    );
}

/** Editor for creating or modifying a single selectable Layer option file. */
function LayerOptionForm({ workspace, selection }: { workspace: Workspace; selection: Extract<Selection, { kind: "layer-option" } | { kind: "layer-option-new" }> })
{
    const isBusy = useAppStore((state) => state.isBusy);
    const [formError, setFormError] = useState<string | undefined>();
    const [deleteOpen, setDeleteOpen] = useState(false);
    const existing = selection.kind === "layer-option"
        ? Object.values(workspace.layerOptions).flat().find((option) => option.path === selection.path)
        : undefined;
    const layer = selection.kind === "layer-option-new" ? selection.layer : existing?.layer;
    const layerConfig = workspace.config.layers.find((candidate) => candidate.name === layer);
    const canDelete = Boolean(existing && layerConfig?.selected !== existing.name && (workspace.layerOptions[existing.layer]?.length ?? 0) > 1);
    const editorKey = selectionKey(selection);
    const editor = useEditorForm(selection, canDelete ? () => setDeleteOpen(true) : undefined);
    const [optionName, setOptionName] = useState(draftText(editor.draft, "name", existing?.name ?? "new-option"));

    if (selection.kind === "layer-option" && !existing)
    {
        return <MissingEditorEmpty title="Option not found" description="This layer option is no longer in the workspace." />;
    }
    if (!layer)
    {
        return <MissingEditorEmpty title="Layer not found" description="This layer is no longer in the workspace." />;
    }

    return (
        <>
            <form
                ref={editor.formRef}
                className="flex h-full min-h-0 w-full min-w-0 flex-col gap-3"
                onChange={editor.handleChange}
                onSubmit={(event) =>
                {
                    event.preventDefault();
                    const snapshot = formSnapshot(event.currentTarget);
                    setFormError(undefined);
                    void runMutation(async () =>
                    {
                        await persistEditorForm(workspace, selection, snapshot);
                    }).then((result) =>
                    {
                        if (!result.ok) setFormError(result.message);
                    });
                }}
            >
                <EditorNameHeader
                    name="name"
                    value={optionName}
                    isBusy={isBusy}
                    submitLabel={selection.kind === "layer-option-new" ? "Create option" : undefined}
                    onChange={(value) =>
                    {
                        setOptionName(value);
                        editor.handleValueChange("name", value);
                    }}
                />
                <FormError message={formError} />
                <TargetBoxes selected={draftValues(editor.draft, "targets", existing?.targets)} />
                <Field className="min-h-0 flex-1">
                    <FieldTitle>Body</FieldTitle>
                    <SourceEditor aria-label="Layer option body" className="min-h-40 flex-1" name="body" language="markdown" defaultValue={draftText(editor.draft, "body", existing?.body ?? "")} />
                </Field>
            </form>
            {existing ? (
                <ConfirmDialog
                    open={deleteOpen}
                    onOpenChange={setDeleteOpen}
                    title={`Delete ${existing.name}?`}
                    description="This permanently deletes the Layer option file."
                    confirmLabel="Delete"
                    destructive
                    confirmDisabled={isBusy}
                    onConfirm={() =>
                    {
                        setFormError(undefined);
                        void runMutation(async () =>
                        {
                            await window.appApi.workspace.removeLayerOption(existing.layer, existing.name);
                            useAppStore.getState().clearEditorDraft(editorKey);
                            await refreshWorkspace();
                            toast.add({ title: `Deleted ${existing.name}`, type: "success" });
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

/** Editor for a subagent source and per-harness JSON metadata. */
function AgentForm({ workspace, selection }: { workspace: Workspace; selection: Extract<Selection, { kind: "agent" } | { kind: "agent-new" }> })
{
    const isBusy = useAppStore((state) => state.isBusy);
    const existing = selection.kind === "agent" ? workspace.agents.find((agent) => agent.path === selection.path) : undefined;
    const [formError, setFormError] = useState<string | undefined>();
    const [deleteOpen, setDeleteOpen] = useState(false);
    const editorKey = selectionKey(selection);
    const editor = useEditorForm(selection, existing ? () => setDeleteOpen(true) : undefined);
    const [agentName, setAgentName] = useState(draftText(editor.draft, "name", existing?.name ?? "new-agent"));

    return (
        <>
            <form
                ref={editor.formRef}
                className="flex min-h-full w-full min-w-0 flex-col gap-3"
                onChange={editor.handleChange}
                onSubmit={(event) =>
                {
                    event.preventDefault();
                    const snapshot = formSnapshot(event.currentTarget);
                    setFormError(undefined);
                    void runMutation(async () =>
                    {
                        await persistEditorForm(workspace, selection, snapshot);
                    }).then((result) =>
                    {
                        if (!result.ok) setFormError(result.message);
                    });
                }}
            >
                <EditorNameHeader
                    name="name"
                    value={agentName}
                    isBusy={isBusy}
                    submitLabel={selection.kind === "agent-new" ? "Create agent" : undefined}
                    onChange={(value) =>
                    {
                        setAgentName(value);
                        editor.handleValueChange("name", value);
                    }}
                />
                <FormError message={formError} />
                <Field>
                    <FieldLabel htmlFor="agent-description">Description</FieldLabel>
                    <Input id="agent-description" name="description" defaultValue={draftText(editor.draft, "description", existing?.description ?? "")} />
                </Field>
                {workspace.config.harnesses.map((harness) => (
                    <Card key={harness.name} size="sm">
                        <Collapsible>
                            <CollapsibleTrigger render={<button type="button" className="group/collapsible-trigger w-full text-left" />}>
                                <CardHeader className="flex flex-row items-center gap-2">
                                    <ChevronRightIcon className="shrink-0 transition-transform group-data-[panel-open]/collapsible-trigger:rotate-90" />
                                    <CardTitle className="flex-1 break-all">{harness.name} metadata (JSON)</CardTitle>
                                </CardHeader>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                                <CardContent>
                                    <SourceEditor
                                        name={`meta-${harness.name}`}
                                        language="json"
                                        aria-label={`${harness.name} metadata JSON`}
                                        autoHeight
                                        defaultValue={draftText(editor.draft, `meta-${harness.name}`, JSON.stringify(existing?.harnesses[harness.name] ?? {}, null, 2))}
                                    />
                                </CardContent>
                            </CollapsibleContent>
                        </Collapsible>
                    </Card>
                ))}
                <Card size="sm">
                    <Collapsible>
                        <CollapsibleTrigger render={<button type="button" className="group/collapsible-trigger w-full text-left" />}>
                            <CardHeader className="flex flex-row items-center gap-2">
                                <ChevronRightIcon className="shrink-0 transition-transform group-data-[panel-open]/collapsible-trigger:rotate-90" />
                                <CardTitle>Body</CardTitle>
                            </CardHeader>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                            <CardContent>
                                <SourceEditor
                                    name="body"
                                    language="markdown"
                                    aria-label="Agent instructions"
                                    autoHeight
                                    defaultValue={draftText(editor.draft, "body", existing?.body ?? "Instructions.\n")}
                                />
                            </CardContent>
                        </CollapsibleContent>
                    </Collapsible>
                </Card>
            </form>
            {existing ? (
                <ConfirmDialog
                    open={deleteOpen}
                    onOpenChange={setDeleteOpen}
                    title={`Delete ${existing.path}?`}
                    description="This permanently deletes the source file from the workspace."
                    confirmLabel="Delete"
                    destructive
                    confirmDisabled={isBusy}
                    onConfirm={() =>
                    {
                        setFormError(undefined);
                        void runMutation(async () =>
                        {
                            await window.appApi.workspace.deleteSource(existing.path);
                            useAppStore.getState().clearEditorDraft(editorKey);
                            await refreshWorkspace();
                            toast.add({ title: `Deleted ${existing.path}`, type: "success" });
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

/** Read-only viewer for one real file under `.halign/generated/`. */
function GeneratedFileView({ workspace, path }: { workspace: Workspace; path: string })
{
    const file = workspace.generatedFiles.find((item) => item.path === path);
    if (!file)
    {
        return (
            <Empty>
                <EmptyHeader>
                    <EmptyTitle>Generated file not found</EmptyTitle>
                    <EmptyDescription>Generate or reload the project to refresh the actual output files.</EmptyDescription>
                </EmptyHeader>
            </Empty>
        );
    }
    return (
        <div className="grid w-full min-w-0 gap-3">
            <div className="min-w-0">
                <h2 className="break-all text-base font-semibold">{file.path}</h2>
                <p className="text-sm text-muted-foreground">{`.halign/generated/${file.path}`}</p>
            </div>
            <SourceEditor
                aria-label={file.path}
                className="h-[calc(100vh-10rem)] min-h-40 bg-muted/30"
                language={file.path.toLowerCase().endsWith(".md") ? "markdown" : "plain"}
                defaultValue={file.content}
                readOnly
            />
        </div>
    );
}

/** Empty state shown before the project has generated real files. */
function GeneratedEmpty()
{
    return (
        <Empty>
            <EmptyHeader>
                <EmptyTitle>No generated files</EmptyTitle>
                <EmptyDescription>Run Generate to populate `.halign/generated/`.</EmptyDescription>
            </EmptyHeader>
        </Empty>
    );
}

/** Empty state when the selected editor target is missing from the workspace. */
function MissingEditorEmpty({ title, description }: { title: string; description: string })
{
    return (
        <Empty>
            <EmptyHeader>
                <EmptyTitle>{title}</EmptyTitle>
                <EmptyDescription>{description}</EmptyDescription>
            </EmptyHeader>
        </Empty>
    );
}

/** Move one Layer around the current ordered generation selection. */
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

/** Unified Home page for config, harnesses, and ordered Layers without contextual navigation. */
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

    if (!workspace)
    {
        return (
            <Empty>
                <EmptyHeader>
                    <EmptyTitle>No workspace</EmptyTitle>
                    <EmptyDescription>The user workspace is not loaded yet.</EmptyDescription>
                </EmptyHeader>
            </Empty>
        );
    }

    return (
        <div className="mx-auto grid w-full max-w-6xl gap-6 pb-4">
            <ConfigForm workspace={workspace} showTitle={false} />

            <section className="grid gap-3">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <h2 className="text-base font-semibold">Harnesses</h2>
                        <p className="text-sm text-muted-foreground">Configure every target harness declared by this project.</p>
                    </div>
                    <Button type="button" size="icon-sm" variant="ghost" disabled={isBusy} aria-label="New harness" onClick={() => setSelection({ kind: "harness-new" })}>
                        <PlusIcon />
                    </Button>
                </div>
                <div className="grid gap-3">
                    {workspace.config.harnesses.map((harness) => (
                        <HarnessCard
                            key={harness.name}
                            workspace={workspace}
                            harness={harness}
                            isInitiallyOpen={selection.kind === "harness" && selection.name === harness.name}
                        />
                    ))}
                    {selection.kind === "harness-new" ? (
                        <HarnessCard workspace={workspace} isInitiallyOpen />
                    ) : null}
                </div>
            </section>

            <section className="grid gap-3">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <h2 className="text-base font-semibold">Layers</h2>
                        <p className="text-sm text-muted-foreground">Add existing Layers, choose one option each, and drag them into generation order.</p>
                    </div>
                    <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        disabled={isBusy || isAddingLayer || catalogLayerNames(workspace).every((name) => layerSelection.some((item) => item.name === name))}
                        aria-label="New layer"
                        onClick={() => setIsAddingLayer(true)}
                    >
                        <PlusIcon />
                    </Button>
                </div>
                <div className="grid gap-3">
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
                    {catalogLayerNames(workspace).length === 0 ? (
                        <p className="text-sm text-muted-foreground">Create a layer on the Layers page, then add it here.</p>
                    ) : null}
                </div>
            </section>

            <SkillsSourcesSection workspace={workspace} />
        </div>
    );
}

/** Home-page section for registering and removing GitHub skill sources. */
function SkillsSourcesSection({ workspace }: { workspace: Workspace })
{
    const isBusy = useAppStore((state) => state.isBusy);
    const [isAdding, setIsAdding] = useState(false);
    const [formError, setFormError] = useState<string>();

    return (
        <section className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h2 className="text-base font-semibold">Skills</h2>
                    <p className="text-sm text-muted-foreground">Register GitHub repositories used by the Skills page for discover and download.</p>
                </div>
                <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    disabled={isBusy || isAdding}
                    aria-label="New skill source"
                    onClick={() =>
                    {
                        setFormError(undefined);
                        setIsAdding(true);
                    }}
                >
                    <PlusIcon />
                </Button>
            </div>
            <FormError message={formError} />
            <div className="grid gap-3">
                {workspace.config.skillSources.map((source) => (
                    <Card key={`${source.owner}/${source.name}`} size="sm">
                        <CardHeader>
                            <CardTitle className="break-all">https://github.com/{source.owner}/{source.name}</CardTitle>
                            <CardDescription className="break-all">Branch: {source.branch}</CardDescription>
                        <CardAction><Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            disabled={isBusy}
                            aria-label={`Remove ${source.owner}/${source.name}`}
                            onClick={() =>
                            {
                                setFormError(undefined);
                                void runMutation(async () =>
                                {
                                    await window.appApi.workspace.removeSkillSource(source.owner, source.name);
                                    await refreshWorkspace({ kind: "config" });
                                    toast.add({ title: "Skill source removed", type: "success" });
                                }).then((result) =>
                                {
                                    if (!result.ok) setFormError(result.message);
                                });
                            }}
                        >
                            <XIcon />
                        </Button></CardAction>
                        </CardHeader>
                    </Card>
                ))}
                {isAdding ? (
                    <NewSkillSourceCard
                        workspace={workspace}
                        onCancel={() => setIsAdding(false)}
                        onError={setFormError}
                        onAdded={() =>
                        {
                            setFormError(undefined);
                            setIsAdding(false);
                        }}
                    />
                ) : null}
                {workspace.config.skillSources.length === 0 && !isAdding ? (
                    <p className="text-sm text-muted-foreground">No skill sources registered.</p>
                ) : null}
            </div>
        </section>
    );
}

/** Dashed card that registers one GitHub skill source. */
function NewSkillSourceCard({
    workspace,
    onAdded,
    onCancel,
    onError,
}: {
    workspace: Workspace;
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
                    const input = branch.trim()
                        ? { url: url.trim(), branch: branch.trim() }
                        : { url: url.trim() };
                    await window.appApi.workspace.addSkillSource(input);
                    await refreshWorkspace({ kind: "config" });
                    toast.add({ title: "Skill source added", type: "success" });
                    onAdded();
                }).then((result) =>
                {
                    if (!result.ok) onError(result.message);
                });
            }}
        >
            <Card>
            <CardHeader>
                <CardTitle>New skill source</CardTitle>
                <CardDescription>Register a GitHub repository for skill discovery.</CardDescription>
                <CardAction><Button type="button" size="icon-sm" variant="ghost" disabled={isBusy} aria-label="Cancel new skill source" onClick={onCancel}>
                    <XIcon />
                </Button></CardAction>
            </CardHeader>
            <CardContent><FieldGroup>
                <Field><FieldLabel htmlFor="skill-source-url">Repository URL</FieldLabel><Input id="skill-source-url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://github.com/owner/repo" disabled={isBusy} /></Field>
                <Field><FieldLabel htmlFor="skill-source-branch">Branch (optional)</FieldLabel><Input id="skill-source-branch" value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="main" disabled={isBusy} /></Field>
            </FieldGroup></CardContent>
            <CardFooter><Button type="submit" disabled={isBusy || !url.trim()}>Add source</Button></CardFooter>
            </Card>
        </form>
    );
}

/** Editor pane for the current workspace selection. */
export function WorkspaceEditor()
{
    const workspace = useAppStore((state) => state.workspace);
    const selection = useAppStore((state) => state.selection);

    if (!workspace)
    {
        return (
            <Empty>
                <EmptyHeader>
                    <EmptyTitle>No workspace</EmptyTitle>
                    <EmptyDescription>The user workspace is not loaded yet.</EmptyDescription>
                </EmptyHeader>
            </Empty>
        );
    }
    if (selection.kind === "config") return <ConfigForm workspace={workspace} />;
    if (selection.kind === "harness")
    {
        const harness = workspace.config.harnesses.find((item) => item.name === selection.name);
        return harness ? <HarnessCard workspace={workspace} harness={harness} isInitiallyOpen /> : <MissingEditorEmpty title="Harness not found" description="This harness is no longer in the workspace." />;
    }
    if (selection.kind === "harness-new") return <HarnessCard workspace={workspace} isInitiallyOpen />;
    if (selection.kind === "layer-new") return <LayerNewForm workspace={workspace} />;
    if (selection.kind === "layer") return <LayerForm workspace={workspace} name={selection.name} />;
    if (selection.kind === "layer-option" || selection.kind === "layer-option-new") return <LayerOptionForm workspace={workspace} selection={selection} />;
    if (selection.kind === "rule" || selection.kind === "rule-new") return <RuleForm workspace={workspace} selection={selection} />;
    if (selection.kind === "agent" || selection.kind === "agent-new") return <AgentForm workspace={workspace} selection={selection} />;
    if (selection.kind === "generated-file") return <GeneratedFileView workspace={workspace} path={selection.path} />;
    return <GeneratedEmpty />;
}
