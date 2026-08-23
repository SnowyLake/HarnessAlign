/**
 * Workspace editors that call `window.appApi`.
 * Saves go through Main path checks; this module never imports Node or Electron.
 */

import type { AgentFormat, Config, HarnessConfig, LayerSelection, RuleInput, Workspace } from "@shared/models/Workspace";
import { useEffect, useLayoutEffect, useRef, useState, type FormEventHandler, type ReactNode, type RefObject } from "react";
import { ContextMenu } from "@base-ui/react/context-menu";
import { ChevronRightIcon, GripVerticalIcon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SourceEditor } from "@/components/ui/source-editor";
import { toast } from "@/components/ui/toast";
import { persistLayerOptionRename, persistLayerRename, persistProjectConfig, refreshWorkspace, runMutation } from "@/features/workspace/WorkspaceTasks";
import { catalogLayerNames, defaultLayerOption, ruleDisplayName, uniqueAgentPath, uniqueRulePath } from "@/lib/Utils";
import { selectionKey, useAppStore, type EditorDraft, type FormSnapshot, type Selection } from "@/stores/AppStore";

/** Form bindings that preserve drafts and respond to tree or keyboard commands. */
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
function useEditorForm(editorKey: string, onDelete?: () => void): EditorFormBinding
{
    const draft = useAppStore((state) => state.editorDrafts[editorKey]);
    const setEditorDraft = useAppStore((state) => state.setEditorDraft);
    const formRef = useRef<HTMLFormElement>(null);
    const baselineRef = useRef<FormSnapshot | undefined>(draft?.baseline);

    useLayoutEffect(() =>
    {
        if (!formRef.current) return;
        baselineRef.current = draft?.baseline ?? formSnapshot(formRef.current);
    }, [editorKey]);

    const handleChange: FormEventHandler<HTMLFormElement> = (event) =>
    {
        const current = formSnapshot(event.currentTarget);
        const baseline = baselineRef.current ?? current;
        setEditorDraft(editorKey, snapshotsEqual(baseline, current) ? undefined : { baseline, current });
    };

    const handleValueChange = (name: string, value: string): void =>
    {
        if (!formRef.current) return;
        const current = formSnapshot(formRef.current);
        current[name] = [value];
        const baseline = baselineRef.current ?? current;
        setEditorDraft(editorKey, snapshotsEqual(baseline, current) ? undefined : { baseline, current });
    };

    useEditorAction(editorKey, () => formRef.current?.requestSubmit(), onDelete);
    return { draft, formRef, handleChange, handleValueChange };
}

/** Build a rule payload, omitting `targets` when every harness is selected. */
function rulePayload(path: string, priority: number, targets: string[] | undefined, body: string): RuleInput
{
    return targets === undefined ? { path, priority, body } : { path, priority, targets, body };
}

/** Checkbox list of harness targets; empty means all harnesses. */
function TargetBoxes({ selected }: { selected: string[] | undefined })
{
    const workspace = useAppStore((state) => state.workspace);
    return (
        <fieldset className="grid gap-1">
            <legend className="text-[12px] text-muted-foreground">targets (none means all)</legend>
            {(workspace?.config.harnesses ?? []).map((harness) => (
                <label key={harness.name} className="flex items-center gap-2 text-foreground">
                    <input type="checkbox" name="targets" value={harness.name} defaultChecked={selected?.includes(harness.name) ?? false} />
                    {harness.name}
                </label>
            ))}
        </fieldset>
    );
}

/** Read checked harness names, omitting `targets` when none or all current harnesses are checked. */
function readTargets(root: HTMLElement, harnessNames: readonly string[]): string[] | undefined
{
    const values = [...root.querySelectorAll("input[name=targets]")]
        .filter((node) => (node as HTMLInputElement).checked)
        .map((node) => (node as HTMLInputElement).value);
    if (values.length === 0) return undefined;
    if (values.length === harnessNames.length && harnessNames.every((name) => values.includes(name))) return undefined;
    return values;
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
                className="h-8 min-w-0 flex-1 rounded-md bg-background px-1 text-lg font-semibold outline-none ring-2 ring-ring/50"
            />
        );
    }

    return (
        <>
            <input type="hidden" name={name} value={value} />
            <h1
                tabIndex={0}
                className="min-w-0 flex-1 cursor-text truncate px-1 text-lg font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
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

/** Title row with a click-to-edit heading and Save on the right. */
function EditorNameHeader({ name, value, onChange, isBusy }: { name: string; value: string; onChange: (value: string) => void; isBusy: boolean })
{
    return (
        <div className="flex items-center justify-between gap-3">
            <EditableHeading name={name} value={value} onChange={onChange} />
            <Button type="submit" size="sm" disabled={isBusy} onMouseDown={(event) => event.preventDefault()}>Save</Button>
        </div>
    );
}

/** Editor for `config.json` title and saved ordered layer selection. */
function ConfigForm({ workspace, showTitle = true, children }: { workspace: Workspace; showTitle?: boolean; children?: ReactNode })
{
    const setSelection = useAppStore((state) => state.setSelection);
    const layerSelection = useAppStore((state) => state.layerSelection);
    const [formError, setFormError] = useState<string | undefined>();
    const editorKey = selectionKey({ kind: "config" });
    const editor = useEditorForm(editorKey);
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
                const form = new FormData(event.currentTarget);
                setFormError(undefined);
                void runMutation(async () =>
                {
                    const next: Config = {
                        ...workspace.config,
                        name: String(form.get("name") ?? "").trim(),
                        layers: layerSelection.map((selection) => ({ name: selection.name, selected: selection.option })),
                    };
                    await window.appApi.workspace.saveConfig(next);
                    useAppStore.getState().clearEditorDraft(editorKey);
                    await refreshWorkspace({ kind: "config" });
                    toast.add({ title: "Saved config.json", type: "success" });
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
                    <Label className="grid gap-1 text-[12px] text-muted-foreground">name<Input name="name" defaultValue={draftText(editor.draft, "name", workspace.config.name)} /></Label>
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
                        {children}
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
    const editorKey = selectionKey(original ? { kind: "harness", name: original } : { kind: "harness-new" });
    const editor = useEditorForm(editorKey, original ? () => setDeleteOpen(true) : undefined);
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
                    const form = new FormData(event.currentTarget);
                    const agentFileFormat = form.get("agentFileFormat") === "toml" ? "toml" : "md";
                    const agentFormat: AgentFormat = agentFileFormat === "toml" ? "toml" : "yaml";
                    const harness: HarnessConfig = agentFormat === "toml"
                        ? {
                            name: String(form.get("name") ?? "").trim(),
                            configPath: String(form.get("configPath") ?? "").trim(),
                            agentFormat,
                            agentExtension: agentFileFormat,
                            instructionsField: String(form.get("instructionsField") ?? "").trim(),
                        }
                        : {
                            name: String(form.get("name") ?? "").trim(),
                            configPath: String(form.get("configPath") ?? "").trim(),
                            agentFormat,
                            agentExtension: agentFileFormat,
                        };
                    setFormError(undefined);
                    void runMutation(async () =>
                    {
                        if (original === undefined) await window.appApi.workspace.addHarness(harness);
                        else
                        {
                            if (original !== harness.name) await window.appApi.workspace.renameHarness(original, harness.name);
                            const current = await window.appApi.workspace.load();
                            const harnesses = current.config.harnesses.map((item) => (item.name === harness.name ? harness : item));
                            await window.appApi.workspace.saveConfig({ ...current.config, harnesses });
                        }
                        useAppStore.getState().clearEditorDraft(editorKey);
                        await refreshWorkspace({ kind: "harness", name: harness.name });
                        toast.add({ title: `Saved harness ${harness.name}`, type: "success" });
                    }).then((result) =>
                    {
                        if (!result.ok) setFormError(result.message);
                    });
                }}
            >
                <details
                    className={`group overflow-hidden rounded-lg border bg-card ${harness ? "" : "border-dashed"}`}
                    open={isOpen}
                    onToggle={(event) => setIsOpen(event.currentTarget.open)}
                >
                    <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 select-none [&::-webkit-details-marker]:hidden">
                        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
                        {isRenaming ? (
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
                        ) : (
                            <>
                                <input type="hidden" name="name" value={harnessName} />
                                <span className="min-w-0 truncate px-1 font-medium">{harnessName || "New harness"}</span>
                            </>
                        )}
                    </summary>
                    <div className="grid gap-3 border-t p-4">
                        <FormError message={formError} />
                        <Label className="grid gap-1 text-[12px] text-muted-foreground">config_path<Input name="configPath" defaultValue={draftText(editor.draft, "configPath", harness?.configPath ?? "")} /></Label>
                        <Label className="grid gap-1 text-[12px] text-muted-foreground">
                            agent file format
                            <Select
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
                                <SelectTrigger size="sm" className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="md">md (YAML metadata)</SelectItem>
                                    <SelectItem value="toml">toml</SelectItem>
                                </SelectContent>
                            </Select>
                        </Label>
                        {agentFileFormat === "toml" ? (
                            <Label className="grid gap-1 text-[12px] text-muted-foreground">instructions_field<Input name="instructionsField" defaultValue={draftText(editor.draft, "instructionsField", harness?.instructionsField ?? "")} /></Label>
                        ) : null}
                        <div className="flex justify-end">
                            <Button type="submit" size="sm" disabled={isBusy} onMouseDown={(event) => event.preventDefault()}>Save</Button>
                        </div>
                    </div>
                </details>
        </form>
    );

    return (
        <>
            <ContextMenu.Root>
                <ContextMenu.Trigger render={card} />
                <ContextMenu.Portal>
                    <ContextMenu.Positioner className="isolate z-50" sideOffset={4}>
                        <ContextMenu.Popup className="min-w-36 origin-(--transform-origin) rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
                            <ContextMenu.Item
                                disabled={isBusy}
                                onClick={() =>
                                {
                                    renameStartRef.current = harnessName;
                                    setSelection(original ? { kind: "harness", name: original } : { kind: "harness-new" });
                                    setIsRenaming(true);
                                }}
                                className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50"
                            >
                                <PencilIcon className="size-4" />
                                <span>Rename</span>
                            </ContextMenu.Item>
                            <ContextMenu.Separator className="-mx-1 my-1 h-px bg-border" />
                            <ContextMenu.Item
                                disabled={isBusy || !original}
                                onClick={() => setDeleteOpen(true)}
                                className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm text-destructive outline-none select-none data-highlighted:bg-destructive/10 data-disabled:pointer-events-none data-disabled:opacity-50"
                            >
                                <Trash2Icon className="size-4" />
                                <span>Delete</span>
                            </ContextMenu.Item>
                        </ContextMenu.Popup>
                    </ContextMenu.Positioner>
                </ContextMenu.Portal>
            </ContextMenu.Root>
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
    const editorKey = selectionKey({ kind: "layer-new" });
    const editor = useEditorForm(editorKey);
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
                const form = new FormData(event.currentTarget);
                const name = String(form.get("name") ?? "").trim();
                const initialOption = String(form.get("initialOption") ?? "").trim();
                setFormError(undefined);
                void runMutation(async () =>
                {
                    await window.appApi.workspace.addLayer(name, initialOption);
                    useAppStore.getState().clearEditorDraft(editorKey);
                    await refreshWorkspace({ kind: "layer-option", path: `.halign/layers/${name}/${initialOption}.md` });
                    toast.add({ title: `Created layer ${name}`, type: "success" });
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
            <Label className="grid gap-1 text-[12px] text-muted-foreground">initial option<Input name="initialOption" defaultValue={draftText(editor.draft, "initialOption", "")} /></Label>
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
    const editorKey = selectionKey({ kind: "layer", name });
    const editor = useEditorForm(editorKey, () => setDeleteOpen(true));
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
                    const nextName = String(new FormData(event.currentTarget).get("name") ?? "").trim();
                    if (!nextName || nextName === name)
                    {
                        setLayerName(name);
                        editor.handleValueChange("name", name);
                        return;
                    }
                    setFormError(undefined);
                    void runMutation(async () =>
                    {
                        await persistLayerRename(name, nextName);
                        useAppStore.getState().clearEditorDraft(editorKey);
                        toast.add({ title: `Renamed layer to ${nextName}`, type: "success" });
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
                <p className="text-[12px] text-muted-foreground">
                    {options.length === 1 ? "1 option" : `${options.length} options`}. Add this layer to a project from the Project page.
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

/** Props for one ordered Layer card on the Project page. */
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
        <div className="grid gap-3 rounded-lg border border-dashed bg-card p-4">
            <div className="flex items-center gap-2">
                <h3 className="min-w-0 flex-1 truncate font-medium">New layer</h3>
                <Button type="button" size="icon-sm" variant="ghost" disabled={isBusy} aria-label="Cancel new layer" className="border-0 text-muted-foreground" onClick={onCancel}>
                    <XIcon />
                </Button>
            </div>
            {available.length === 0 ? (
                <p className="text-[12px] text-muted-foreground">Every catalog layer is already in this project.</p>
            ) : (
                <Label className="grid gap-1 text-[12px] text-muted-foreground">
                    layer
                    <Select
                        value={null}
                        onValueChange={(value) =>
                        {
                            if (value !== null) onAdd(value);
                        }}
                    >
                        <SelectTrigger size="sm" className="w-full" disabled={isBusy}>
                            <SelectValue placeholder="Choose a layer" />
                        </SelectTrigger>
                        <SelectContent>
                            {available.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </Label>
            )}
        </div>
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
        <div
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
            className={`grid gap-3 rounded-lg border bg-card p-4 ${isDragging ? "opacity-40" : ""}`}
        >
            <div className="flex items-center gap-2">
                <GripVerticalIcon className="size-4 shrink-0 cursor-grab text-muted-foreground" />
                <h3 className="min-w-0 flex-1 truncate font-medium">{selection.name}</h3>
                <Button type="button" size="icon-sm" variant="ghost" disabled={isBusy} aria-label={`Remove ${selection.name}`} className="border-0 text-muted-foreground" onClick={() => setRemoveOpen(true)}>
                    <XIcon />
                </Button>
            </div>
            <Label className="grid gap-1 text-[12px] text-muted-foreground">
                selected option
                <Select
                    value={selection.option}
                    onValueChange={(value) =>
                    {
                        if (value === null) return;
                        setLayerSelection(useAppStore.getState().layerSelection.map((item) => item.name === selection.name ? { ...item, option: value } : item));
                    }}
                >
                    <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        {options.map((option) => <SelectItem key={option.name} value={option.name}>{option.name}</SelectItem>)}
                    </SelectContent>
                </Select>
            </Label>
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
        </div>
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
    const editor = useEditorForm(editorKey, existingPath ? () => setDeleteOpen(true) : undefined);
    const [ruleName, setRuleName] = useState(draftText(editor.draft, "name", ruleDisplayName(existingPath ?? defaultPath)));
    const rulePaths = [...workspace.rootRules, ...workspace.sharedRules].map((item) => item.path);

    /** Resolve the saved path from the heading name. */
    const pathFromName = (name: string): string => uniqueRulePath(existingPath ?? defaultPath, name, rulePaths);

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
                        const form = new FormData(event.currentTarget);
                        const original = sharedExisting?.path;
                        const path = pathFromName(String(form.get("name") ?? ""));
                        const body = String(form.get("body") ?? "");
                        setFormError(undefined);
                        void runMutation(async () =>
                        {
                            await window.appApi.workspace.saveSharedRule(path, body);
                            if (original && original !== path) await window.appApi.workspace.deleteSource(original);
                            useAppStore.getState().clearEditorDraft(editorKey);
                            await refreshWorkspace({ kind: "rule", path });
                            toast.add({ title: `Saved ${path}`, type: "success" });
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
                        onChange={(value) =>
                        {
                            setRuleName(value);
                            editor.handleValueChange("name", value);
                        }}
                    />
                    <FormError message={formError} />
                    <Label className="flex min-h-0 flex-1 flex-col gap-1 text-[12px] text-muted-foreground">
                        body
                        <SourceEditor className="min-h-40 flex-1" name="body" language="markdown" defaultValue={draftText(editor.draft, "body", sharedExisting?.body ?? "# Title\n\nbody\n")} />
                    </Label>
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
                    const form = event.currentTarget;
                    const data = new FormData(form);
                    const original = existing?.path;
                    const payload = rulePayload(
                        pathFromName(String(data.get("name") ?? "")),
                        existing?.priority ?? workspace.rootRules.length,
                        readTargets(form, workspace.config.harnesses.map((harness) => harness.name)),
                        String(data.get("body") ?? ""),
                    );
                    setFormError(undefined);
                    void runMutation(async () =>
                    {
                        await window.appApi.workspace.saveRule(payload);
                        if (original && original !== payload.path) await window.appApi.workspace.deleteSource(original);
                        useAppStore.getState().clearEditorDraft(editorKey);
                        await refreshWorkspace({ kind: "rule", path: payload.path });
                        toast.add({ title: `Saved ${payload.path}`, type: "success" });
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
                    onChange={(value) =>
                    {
                        setRuleName(value);
                        editor.handleValueChange("name", value);
                    }}
                />
                <FormError message={formError} />
                <TargetBoxes selected={draftValues(editor.draft, "targets", existing?.targets)} />
                <Label className="flex min-h-0 flex-1 flex-col gap-1 text-[12px] text-muted-foreground">
                    body
                    <SourceEditor className="min-h-40 flex-1" name="body" language="markdown" defaultValue={draftText(editor.draft, "body", existing?.body ?? "# Title\n\nbody\n")} />
                </Label>
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
    const editor = useEditorForm(editorKey, canDelete ? () => setDeleteOpen(true) : undefined);
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
                    const form = event.currentTarget;
                    const data = new FormData(form);
                    const nextName = ruleDisplayName(String(data.get("name") ?? "").trim() || "new-option");
                    const targets = readTargets(form, workspace.config.harnesses.map((harness) => harness.name));
                    const body = String(data.get("body") ?? "");
                    setFormError(undefined);
                    void runMutation(async () =>
                    {
                        if (existing)
                        {
                            const path = existing.name === nextName
                                ? existing.path
                                : await persistLayerOptionRename(existing.layer, existing.name, nextName);
                            await window.appApi.workspace.saveLayerOption({
                                path,
                                body,
                                ...(targets ? { targets } : {}),
                            });
                            useAppStore.getState().clearEditorDraft(editorKey);
                            await refreshWorkspace({ kind: "layer-option", path });
                            toast.add({ title: `Saved ${path}`, type: "success" });
                            return;
                        }
                        await window.appApi.workspace.addLayerOption(layer, nextName);
                        const path = `.halign/layers/${layer}/${nextName}.md`;
                        await window.appApi.workspace.saveLayerOption({
                            path,
                            body,
                            ...(targets ? { targets } : {}),
                        });
                        useAppStore.getState().clearEditorDraft(editorKey);
                        await refreshWorkspace({ kind: "layer-option", path });
                        toast.add({ title: `Created option ${nextName}`, type: "success" });
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
                    onChange={(value) =>
                    {
                        setOptionName(value);
                        editor.handleValueChange("name", value);
                    }}
                />
                <FormError message={formError} />
                <TargetBoxes selected={draftValues(editor.draft, "targets", existing?.targets)} />
                <Label className="flex min-h-0 flex-1 flex-col gap-1 text-[12px] text-muted-foreground">
                    body
                    <SourceEditor className="min-h-40 flex-1" name="body" language="markdown" defaultValue={draftText(editor.draft, "body", existing?.body ?? "")} />
                </Label>
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
    const editor = useEditorForm(editorKey, existing ? () => setDeleteOpen(true) : undefined);
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
                    const form = new FormData(event.currentTarget);
                    const harnesses: Record<string, Record<string, unknown>> = {};
                    try
                    {
                        for (const harness of workspace.config.harnesses)
                        {
                            harnesses[harness.name] = JSON.parse(String(form.get(`meta-${harness.name}`) ?? "{}")) as Record<string, unknown>;
                        }
                    }
                    catch (error)
                    {
                        setFormError(error instanceof Error ? error.message : String(error));
                        return;
                    }
                    setFormError(undefined);
                    void runMutation(async () =>
                    {
                        const path = uniqueAgentPath(existing?.path, String(form.get("name") ?? ""), workspace.agents.map((agent) => agent.path));
                        const agent = {
                            path,
                            name: ruleDisplayName(path),
                            description: String(form.get("description") ?? "").trim(),
                            harnesses,
                            body: String(form.get("body") ?? ""),
                        };
                        await window.appApi.workspace.saveAgent(agent);
                        if (existing && existing.path !== agent.path) await window.appApi.workspace.deleteSource(existing.path);
                        useAppStore.getState().clearEditorDraft(editorKey);
                        await refreshWorkspace({ kind: "agent", path: agent.path });
                        toast.add({ title: `Saved ${agent.path}`, type: "success" });
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
                    onChange={(value) =>
                    {
                        setAgentName(value);
                        editor.handleValueChange("name", value);
                    }}
                />
                <FormError message={formError} />
                <Label className="grid gap-1 text-[12px] text-muted-foreground">description<Input name="description" defaultValue={draftText(editor.draft, "description", existing?.description ?? "")} /></Label>
                {workspace.config.harnesses.map((harness) => (
                    <details key={harness.name} className="group overflow-hidden rounded-md border bg-card">
                        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[12px] text-muted-foreground select-none [&::-webkit-details-marker]:hidden">
                            <ChevronRightIcon className="size-4 shrink-0 transition-transform group-open:rotate-90" />
                            {harness.name} metadata (JSON)
                        </summary>
                        <SourceEditor
                            name={`meta-${harness.name}`}
                            language="json"
                            autoHeight
                            className="rounded-none border-0 border-t"
                            defaultValue={draftText(editor.draft, `meta-${harness.name}`, JSON.stringify(existing?.harnesses[harness.name] ?? {}, null, 2))}
                        />
                    </details>
                ))}
                <details className="group overflow-hidden rounded-md border bg-card">
                    <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[12px] text-muted-foreground select-none [&::-webkit-details-marker]:hidden">
                        <ChevronRightIcon className="size-4 shrink-0 transition-transform group-open:rotate-90" />
                        body
                    </summary>
                    <SourceEditor
                        name="body"
                        language="markdown"
                        autoHeight
                        className="rounded-none border-0 border-t"
                        defaultValue={draftText(editor.draft, "body", existing?.body ?? "Instructions.\n")}
                    />
                </details>
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
            <Empty className="border-0">
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
                <h2 className="truncate text-base font-semibold">{file.path}</h2>
                <p className="text-[12px] text-muted-foreground">{`.halign/generated/${file.path}`}</p>
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
        <Empty className="border-0">
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
        <Empty className="border-0">
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

/** Unified Project page for config, harnesses, and ordered Layers without contextual navigation. */
export function ProjectEditor()
{
    const workspace = useAppStore((state) => state.workspace);
    const selection = useAppStore((state) => state.selection);
    const setSelection = useAppStore((state) => state.setSelection);
    const isBusy = useAppStore((state) => state.isBusy);
    const requestEditorAction = useAppStore((state) => state.requestEditorAction);
    const layerSelection = useAppStore((state) => state.layerSelection);
    const setLayerSelection = useAppStore((state) => state.setLayerSelection);
    const [draggedLayer, setDraggedLayer] = useState<string>();
    const [isAddingLayer, setIsAddingLayer] = useState(false);

    if (!workspace)
    {
        return (
            <Empty className="border-0">
                <EmptyHeader>
                    <EmptyTitle>No workspace</EmptyTitle>
                    <EmptyDescription>The user workspace is not loaded yet.</EmptyDescription>
                </EmptyHeader>
            </Empty>
        );
    }

    return (
        <div className="mx-auto grid w-full max-w-6xl gap-6 pb-4">
            <ConfigForm workspace={workspace} showTitle={false}>
                <Button
                    type="button"
                    size="sm"
                    disabled={isBusy}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() =>
                    {
                        void runMutation(async () =>
                        {
                            await persistProjectConfig(workspace);
                            await refreshWorkspace(
                                selection.kind === "harness" || selection.kind === "harness-new" ? selection : { kind: "config" },
                            );
                            toast.add({ title: "Saved config.json", type: "success" });
                        }).then((result) =>
                        {
                            if (!result.ok) return;
                            if (selection.kind === "harness" || selection.kind === "harness-new")
                            {
                                requestEditorAction(selection, "save");
                            }
                        });
                    }}
                >
                    Save
                </Button>
            </ConfigForm>

            <section className="grid gap-3">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <h2 className="text-base font-semibold">Harnesses</h2>
                        <p className="text-[12px] text-muted-foreground">Configure every target harness declared by this project.</p>
                    </div>
                    <Button type="button" size="icon-sm" variant="ghost" disabled={isBusy} aria-label="New harness" className="border-0 text-muted-foreground" onClick={() => setSelection({ kind: "harness-new" })}>
                        <PlusIcon />
                    </Button>
                </div>
                <div className="grid gap-3 xl:grid-cols-2">
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
                        <p className="text-[12px] text-muted-foreground">Add existing Layers, choose one option each, and drag them into generation order.</p>
                    </div>
                    <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        disabled={isBusy || isAddingLayer || catalogLayerNames(workspace).every((name) => layerSelection.some((item) => item.name === name))}
                        aria-label="New layer"
                        className="border-0 text-muted-foreground"
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
                        <p className="text-[12px] text-muted-foreground">Create a layer on the Layers page, then add it here.</p>
                    ) : null}
                </div>
            </section>

            <SkillsSourcesSection workspace={workspace} />
        </div>
    );
}

/** Project-page section for registering and removing GitHub skill sources. */
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
                    <p className="text-[12px] text-muted-foreground">Register GitHub repositories used by the Skills page for discover and download.</p>
                </div>
                <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    disabled={isBusy || isAdding}
                    aria-label="New skill source"
                    className="border-0 text-muted-foreground"
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
                    <div key={`${source.owner}/${source.name}`} className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
                        <div className="min-w-0 flex-1">
                            <div className="truncate font-medium">https://github.com/{source.owner}/{source.name}</div>
                            <div className="text-[12px] text-muted-foreground">branch: {source.branch}</div>
                        </div>
                        <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            disabled={isBusy}
                            aria-label={`Remove ${source.owner}/${source.name}`}
                            className="border-0 text-muted-foreground"
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
                        </Button>
                    </div>
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
                    <p className="text-[12px] text-muted-foreground">No skill sources registered.</p>
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
            className="grid gap-3 rounded-lg border border-dashed bg-card p-4"
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
            <div className="flex items-center gap-2">
                <h3 className="min-w-0 flex-1 truncate font-medium">New skill source</h3>
                <Button type="button" size="icon-sm" variant="ghost" disabled={isBusy} aria-label="Cancel new skill source" className="border-0 text-muted-foreground" onClick={onCancel}>
                    <XIcon />
                </Button>
            </div>
            <Label className="grid gap-1 text-[12px] text-muted-foreground">
                Repository URL
                <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://github.com/owner/repo" disabled={isBusy} />
            </Label>
            <Label className="grid gap-1 text-[12px] text-muted-foreground">
                Branch (optional)
                <Input value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="main" disabled={isBusy} />
            </Label>
            <div>
                <Button type="submit" size="sm" disabled={isBusy || !url.trim()}>Save</Button>
            </div>
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
            <Empty className="border-0">
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
