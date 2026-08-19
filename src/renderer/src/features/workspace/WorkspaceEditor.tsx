/**
 * Workspace editors that call `window.appApi`.
 * Saves go through Main path checks; this module never imports Node or Electron.
 */

import type { AgentFormat, Config, HarnessConfig, RuleInput, Workspace } from "@shared/models/Workspace";
import { useEffect, useLayoutEffect, useRef, useState, type FormEventHandler, type RefObject } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { refreshWorkspace, runMutation } from "@/features/workspace/WorkspaceTasks";
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

/** Read checked harness names from a form, or `undefined` when none are checked. */
function readTargets(root: HTMLElement): string[] | undefined
{
    const values = [...root.querySelectorAll("input[type=checkbox]")]
        .filter((node) => (node as HTMLInputElement).checked)
        .map((node) => (node as HTMLInputElement).value);
    return values.length === 0 ? undefined : values;
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

/** Editor for `config.json` title and default profile. */
function ConfigForm({ workspace }: { workspace: Workspace })
{
    const [formError, setFormError] = useState<string | undefined>();
    const editorKey = selectionKey({ kind: "config" });
    const editor = useEditorForm(editorKey);

    return (
        <form
            ref={editor.formRef}
            className="flex h-full min-h-0 w-full min-w-0 flex-col gap-3"
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
                        defaultProfile: String(form.get("defaultProfile") ?? ""),
                    };
                    await window.appApi.workspace.saveConfig(workspace.root, next);
                    useAppStore.getState().clearEditorDraft(editorKey);
                    await refreshWorkspace({ kind: "config" });
                    toast.add({ title: "Saved config.json", type: "success" });
                }).then((result) =>
                {
                    if (!result.ok) setFormError(result.message);
                });
            }}
        >
            <h2 className="text-base font-semibold">config.json</h2>
            <FormError message={formError} />
            <Label className="grid gap-1 text-[12px] text-muted-foreground">name<Input name="name" defaultValue={draftText(editor.draft, "name", workspace.config.name)} /></Label>
            <Label className="grid gap-1 text-[12px] text-muted-foreground">
                default_profile
                <Select
                    name="defaultProfile"
                    defaultValue={draftText(editor.draft, "defaultProfile", workspace.config.defaultProfile)}
                    onValueChange={(value) =>
                    {
                        if (value !== null) editor.handleValueChange("defaultProfile", value);
                    }}
                >
                    <SelectTrigger size="sm" className="w-full">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {workspace.config.profiles.map((profile) => (
                            <SelectItem key={profile} value={profile}>{profile}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </Label>
        </form>
    );
}

/** Editor for adding or updating one harness declaration. */
function HarnessForm({ workspace, original }: { workspace: Workspace; original?: string })
{
    const isBusy = useAppStore((state) => state.isBusy);
    const existing = workspace.config.harnesses.find((harness) => harness.name === original);
    const [formError, setFormError] = useState<string | undefined>();
    const [deleteOpen, setDeleteOpen] = useState(false);
    const editorKey = selectionKey(original ? { kind: "harness", name: original } : { kind: "harness-new" });
    const editor = useEditorForm(editorKey, original ? () => setDeleteOpen(true) : undefined);

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
                    const agentFormat: AgentFormat = form.get("agentFormat") === "toml" ? "toml" : "yaml";
                    const harness: HarnessConfig = agentFormat === "toml"
                        ? {
                            name: String(form.get("name") ?? "").trim(),
                            configPath: String(form.get("configPath") ?? "").trim(),
                            agentFormat,
                            agentExtension: String(form.get("agentExtension") ?? "").trim(),
                            instructionsField: String(form.get("instructionsField") ?? "").trim(),
                        }
                        : {
                            name: String(form.get("name") ?? "").trim(),
                            configPath: String(form.get("configPath") ?? "").trim(),
                            agentFormat,
                            agentExtension: String(form.get("agentExtension") ?? "").trim(),
                        };
                    setFormError(undefined);
                    void runMutation(async () =>
                    {
                        if (original === undefined) await window.appApi.workspace.addHarness(workspace.root, harness);
                        else
                        {
                            if (original !== harness.name) await window.appApi.workspace.renameHarness(workspace.root, original, harness.name);
                            const current = await window.appApi.workspace.load(workspace.root);
                            const harnesses = current.config.harnesses.map((item) => (item.name === harness.name ? harness : item));
                            await window.appApi.workspace.saveConfig(current.root, { ...current.config, harnesses });
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
                <h2 className="text-base font-semibold">{original ? `Harness ${original}` : "New harness"}</h2>
                <FormError message={formError} />
                <Label className="grid gap-1 text-[12px] text-muted-foreground">name<Input name="name" defaultValue={draftText(editor.draft, "name", existing?.name ?? "")} /></Label>
                <Label className="grid gap-1 text-[12px] text-muted-foreground">config_path<Input name="configPath" defaultValue={draftText(editor.draft, "configPath", existing?.configPath ?? "")} /></Label>
                <Label className="grid gap-1 text-[12px] text-muted-foreground">
                    agent_format
                    <Select
                        name="agentFormat"
                        defaultValue={draftText(editor.draft, "agentFormat", existing?.agentFormat ?? "yaml")}
                        onValueChange={(value) =>
                        {
                            if (value !== null) editor.handleValueChange("agentFormat", value);
                        }}
                    >
                        <SelectTrigger size="sm" className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="yaml">yaml</SelectItem>
                            <SelectItem value="toml">toml</SelectItem>
                        </SelectContent>
                    </Select>
                </Label>
                <Label className="grid gap-1 text-[12px] text-muted-foreground">agent_extension<Input name="agentExtension" defaultValue={draftText(editor.draft, "agentExtension", existing?.agentExtension ?? "md")} /></Label>
                <Label className="grid gap-1 text-[12px] text-muted-foreground">instructions_field (TOML only)<Input name="instructionsField" defaultValue={draftText(editor.draft, "instructionsField", existing?.instructionsField ?? "")} /></Label>
            </form>
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
                        await window.appApi.workspace.removeHarness(workspace.root, original);
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

/** Editor for creating a new profile name. */
function ProfileNewForm({ workspace }: { workspace: Workspace })
{
    const [formError, setFormError] = useState<string | undefined>();
    const editorKey = selectionKey({ kind: "profile-new" });
    const editor = useEditorForm(editorKey);

    return (
        <form
            ref={editor.formRef}
            className="flex h-full min-h-0 w-full min-w-0 flex-col gap-3"
            onChange={editor.handleChange}
            onSubmit={(event) =>
            {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const name = String(form.get("name") ?? "").trim();
                setFormError(undefined);
                void runMutation(async () =>
                {
                    await window.appApi.workspace.addProfile(workspace.root, name);
                    useAppStore.getState().clearEditorDraft(editorKey);
                    await refreshWorkspace({ kind: "profile", name });
                    toast.add({ title: `Created profile ${name}`, type: "success" });
                }).then((result) =>
                {
                    if (!result.ok) setFormError(result.message);
                });
            }}
        >
            <h2 className="text-base font-semibold">New profile</h2>
            <FormError message={formError} />
            <Label className="grid gap-1 text-[12px] text-muted-foreground">name<Input name="name" defaultValue={draftText(editor.draft, "name", "")} /></Label>
        </form>
    );
}

/** Editor pane for an existing profile (delete only). */
function ProfileForm({ workspace, name }: { workspace: Workspace; name: string })
{
    const isBusy = useAppStore((state) => state.isBusy);
    const isDefault = name === workspace.config.defaultProfile;
    const [formError, setFormError] = useState<string | undefined>();
    const [deleteOpen, setDeleteOpen] = useState(false);
    const editorKey = selectionKey({ kind: "profile", name });
    useEditorAction(editorKey, undefined, isDefault ? undefined : () => setDeleteOpen(true));

    return (
        <div className="flex h-full min-h-0 w-full min-w-0 flex-col gap-3">
            <h2 className="text-base font-semibold">Profile {name}</h2>
            <FormError message={formError} />
            {isDefault ? (
                <Alert>
                    <AlertTitle>Cannot delete default profile</AlertTitle>
                    <AlertDescription>
                        This is default_profile and cannot be removed until you change it in config.json.
                    </AlertDescription>
                </Alert>
            ) : (
                <p className="text-muted-foreground">{`Deleting removes .halign/domains/${name}/.`}</p>
            )}
            {!isDefault ? (
                <ConfirmDialog
                    open={deleteOpen}
                    onOpenChange={setDeleteOpen}
                    title={`Delete profile ${name}?`}
                    description={`This removes .halign/domains/${name}/.`}
                    confirmLabel="Delete"
                    destructive
                    confirmDisabled={isBusy}
                    onConfirm={() =>
                    {
                        setFormError(undefined);
                        void runMutation(async () =>
                        {
                            await window.appApi.workspace.removeProfile(workspace.root, name);
                            await refreshWorkspace();
                            toast.add({ title: `Deleted profile ${name}`, type: "success" });
                        }).then((result) =>
                        {
                            if (!result.ok) setFormError(result.message);
                        });
                    }}
                />
            ) : null}
        </div>
    );
}

/** Editor for a root, domain, or shared rule. */
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
            : selection.scope === "shared"
                ? ".halign/rules/shared/new-rule.md"
                : `.halign/domains/${selection.profile ?? "profile"}/rules/new-rule.md`;
    const sharedExisting = workspace.sharedRules.find((rule) => selection.kind === "rule" && rule.path === selection.path);
    const existing = selection.kind === "rule"
        ? [...workspace.rootRules, ...Object.values(workspace.domainRules).flat()].find((rule) => rule.path === selection.path)
        : undefined;
    const existingPath = sharedExisting?.path ?? existing?.path;
    const editorKey = selectionKey(selection);
    const editor = useEditorForm(editorKey, existingPath ? () => setDeleteOpen(true) : undefined);
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
                    await window.appApi.workspace.deleteSource(workspace.root, existingPath);
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
                        const path = String(form.get("path") ?? "").trim();
                        const body = String(form.get("body") ?? "");
                        const original = sharedExisting?.path;
                        setFormError(undefined);
                        void runMutation(async () =>
                        {
                            await window.appApi.workspace.saveSharedRule(workspace.root, path, body);
                            if (original && original !== path) await window.appApi.workspace.deleteSource(workspace.root, original);
                            useAppStore.getState().clearEditorDraft(editorKey);
                            await refreshWorkspace({ kind: "rule", path });
                            toast.add({ title: `Saved ${path}`, type: "success" });
                        }).then((result) =>
                        {
                            if (!result.ok) setFormError(result.message);
                        });
                    }}
                >
                    <h2 className="text-base font-semibold">Shared rule</h2>
                    <FormError message={formError} />
                    <Label className="grid gap-1 text-[12px] text-muted-foreground">path<Input name="path" defaultValue={draftText(editor.draft, "path", sharedExisting?.path ?? defaultPath)} /></Label>
                    <Label className="flex min-h-0 flex-1 flex-col gap-1 text-[12px] text-muted-foreground">
                        body
                        <Textarea className="min-h-40 flex-1 resize-none" name="body" defaultValue={draftText(editor.draft, "body", sharedExisting?.body ?? "# Title\n\nbody\n")} />
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
                    const payload = rulePayload(
                        String(data.get("path") ?? "").trim(),
                        Number(data.get("priority")),
                        readTargets(form),
                        String(data.get("body") ?? ""),
                    );
                    const original = existing?.path;
                    setFormError(undefined);
                    void runMutation(async () =>
                    {
                        await window.appApi.workspace.saveRule(workspace.root, payload);
                        if (original && original !== payload.path) await window.appApi.workspace.deleteSource(workspace.root, original);
                        useAppStore.getState().clearEditorDraft(editorKey);
                        await refreshWorkspace({ kind: "rule", path: payload.path });
                        toast.add({ title: `Saved ${payload.path}`, type: "success" });
                    }).then((result) =>
                    {
                        if (!result.ok) setFormError(result.message);
                    });
                }}
            >
                <h2 className="text-base font-semibold">Rule</h2>
                <FormError message={formError} />
                <Label className="grid gap-1 text-[12px] text-muted-foreground">path<Input name="path" defaultValue={draftText(editor.draft, "path", existing?.path ?? defaultPath)} /></Label>
                <Label className="grid gap-1 text-[12px] text-muted-foreground">priority<Input name="priority" type="number" defaultValue={draftText(editor.draft, "priority", String(existing?.priority ?? 100))} /></Label>
                <TargetBoxes selected={draftValues(editor.draft, "targets", existing?.targets)} />
                <Label className="flex min-h-0 flex-1 flex-col gap-1 text-[12px] text-muted-foreground">
                    body
                    <Textarea className="min-h-40 flex-1 resize-none" name="body" defaultValue={draftText(editor.draft, "body", existing?.body ?? "# Title\n\nbody\n")} />
                </Label>
            </form>
            {deleteDialog}
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
                    const agent = {
                        path: String(form.get("path") ?? "").trim(),
                        name: String(form.get("name") ?? "").trim(),
                        description: String(form.get("description") ?? "").trim(),
                        harnesses,
                        body: String(form.get("body") ?? ""),
                    };
                    setFormError(undefined);
                    void runMutation(async () =>
                    {
                        await window.appApi.workspace.saveAgent(workspace.root, agent);
                        if (existing && existing.path !== agent.path) await window.appApi.workspace.deleteSource(workspace.root, existing.path);
                        useAppStore.getState().clearEditorDraft(editorKey);
                        await refreshWorkspace({ kind: "agent", path: agent.path });
                        toast.add({ title: `Saved ${agent.path}`, type: "success" });
                    }).then((result) =>
                    {
                        if (!result.ok) setFormError(result.message);
                    });
                }}
            >
                <h2 className="text-base font-semibold">{existing ? `Agent ${existing.name}` : "New agent"}</h2>
                <FormError message={formError} />
                <Label className="grid gap-1 text-[12px] text-muted-foreground">path<Input name="path" defaultValue={draftText(editor.draft, "path", existing?.path ?? ".halign/agents/new-agent.md")} /></Label>
                <Label className="grid gap-1 text-[12px] text-muted-foreground">name<Input name="name" defaultValue={draftText(editor.draft, "name", existing?.name ?? "")} /></Label>
                <Label className="grid gap-1 text-[12px] text-muted-foreground">description<Input name="description" defaultValue={draftText(editor.draft, "description", existing?.description ?? "")} /></Label>
                {workspace.config.harnesses.map((harness) => (
                    <Label key={harness.name} className="grid gap-1 text-[12px] text-muted-foreground">
                        {harness.name} metadata (JSON)
                        <Textarea name={`meta-${harness.name}`} className="min-h-28" defaultValue={draftText(editor.draft, `meta-${harness.name}`, JSON.stringify(existing?.harnesses[harness.name] ?? {}, null, 2))} />
                    </Label>
                ))}
                <Label className="flex min-h-0 flex-1 flex-col gap-1 text-[12px] text-muted-foreground">
                    body
                    <Textarea className="min-h-40 flex-1 resize-none" name="body" defaultValue={draftText(editor.draft, "body", existing?.body ?? "Instructions.\n")} />
                </Label>
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
                            await window.appApi.workspace.deleteSource(workspace.root, existing.path);
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
            <Textarea
                aria-label={file.path}
                className="h-[calc(100vh-10rem)] min-h-40 resize-none bg-muted/30"
                value={file.content}
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
                    <EmptyDescription>Open a directory that contains .halign/config.json.</EmptyDescription>
                </EmptyHeader>
            </Empty>
        );
    }
    if (selection.kind === "config") return <ConfigForm workspace={workspace} />;
    if (selection.kind === "harness") return <HarnessForm workspace={workspace} original={selection.name} />;
    if (selection.kind === "harness-new") return <HarnessForm workspace={workspace} />;
    if (selection.kind === "profile-new") return <ProfileNewForm workspace={workspace} />;
    if (selection.kind === "profile") return <ProfileForm workspace={workspace} name={selection.name} />;
    if (selection.kind === "rule" || selection.kind === "rule-new") return <RuleForm workspace={workspace} selection={selection} />;
    if (selection.kind === "agent" || selection.kind === "agent-new") return <AgentForm workspace={workspace} selection={selection} />;
    if (selection.kind === "generated-file") return <GeneratedFileView workspace={workspace} path={selection.path} />;
    return <GeneratedEmpty />;
}
