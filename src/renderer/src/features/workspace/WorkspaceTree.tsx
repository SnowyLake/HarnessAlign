import { ContextMenu } from "@base-ui/react/context-menu";
import type { RuleInput, SharedRule, Workspace } from "@shared/models/Workspace";
import { useState } from "react";
import { PencilIcon, SaveIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/components/ui/toast";
import { refreshWorkspace, runMutation } from "@/features/workspace/WorkspaceTasks";
import { fileName } from "@/lib/Utils";
import { selectionKey, useAppStore, type Selection, type WorkspaceView } from "@/stores/AppStore";

/** Available insertion gaps around a rule row. */
type RuleDropPosition = "before" | "after";

/** Active rule insertion marker shown while dragging. */
interface RuleDropTarget
{
    path: string;
    position: RuleDropPosition;
}

/** Props for one selectable row in a workspace module tree. */
interface TreeButtonProps
{
    label: string;
    active: boolean;
    indent?: boolean;
    disabled?: boolean;
    selection?: Selection;
    canSave?: boolean;
    canDelete?: boolean;
    isDraggable?: boolean;
    isDragging?: boolean;
    dropPosition?: RuleDropPosition | undefined;
    onRename?: (name: string) => Promise<boolean>;
    onDragStart?: () => void;
    onDragEnd?: () => void;
    onDragPositionChange?: (position: RuleDropPosition) => void;
    onDragLeave?: () => void;
    onDrop?: (position: RuleDropPosition) => void;
    onClick: () => void;
}

/** One selectable row in a workspace module tree. */
function TreeButton({ label, active, indent, disabled, selection, canSave = false, canDelete = false, isDraggable = false, isDragging = false, dropPosition, onRename, onDragStart, onDragEnd, onDragPositionChange, onDragLeave, onDrop, onClick }: TreeButtonProps)
{
    const editorKey = selection ? selectionKey(selection) : undefined;
    const isDirty = useAppStore((state) => editorKey ? Boolean(state.editorDrafts[editorKey]) : false);
    const requestEditorAction = useAppStore((state) => state.requestEditorAction);
    const [isRenaming, setIsRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState(label);
    const [isRenameBusy, setIsRenameBusy] = useState(false);

    /** Persist the inline filename edit and keep it open when persistence fails. */
    const commitRename = async (): Promise<void> =>
    {
        if (!onRename || isRenameBusy) return;
        if (renameValue.trim() === label)
        {
            setIsRenaming(false);
            return;
        }
        setIsRenameBusy(true);
        const isSaved = await onRename(renameValue);
        setIsRenameBusy(false);
        if (isSaved) setIsRenaming(false);
    };

    const row = (
        <div
            draggable={isDraggable && !disabled && !isRenaming}
            onDragStart={(event) =>
            {
                if (!isDraggable || disabled)
                {
                    event.preventDefault();
                    return;
                }
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", label);
                onDragStart?.();
            }}
            onDragEnd={onDragEnd}
            onDragOver={(event) =>
            {
                if (!isDraggable || disabled) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                const bounds = event.currentTarget.getBoundingClientRect();
                onDragPositionChange?.(event.clientY < bounds.top + bounds.height / 2 ? "before" : "after");
            }}
            onDragLeave={(event) =>
            {
                if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
                onDragLeave?.();
            }}
            onDrop={(event) =>
            {
                if (!isDraggable || disabled) return;
                event.preventDefault();
                const bounds = event.currentTarget.getBoundingClientRect();
                onDrop?.(event.clientY < bounds.top + bounds.height / 2 ? "before" : "after");
            }}
            className={`group/tab relative flex w-full min-w-0 items-center ${isDraggable ? "cursor-grab active:cursor-grabbing" : ""} ${isDragging ? "opacity-40" : ""} ${active ? "bg-accent" : "hover:bg-accent/50"}`}
        >
            {dropPosition ? (
                <span
                    aria-hidden
                    className={`pointer-events-none absolute inset-x-2 z-10 h-0.5 rounded-full bg-blue-500 ring-2 ring-background ${dropPosition === "before" ? "top-0 -translate-y-1/2" : "bottom-0 translate-y-1/2"}`}
                />
            ) : null}
            {isRenaming ? (
                <input
                    autoFocus
                    value={renameValue}
                    disabled={disabled || isRenameBusy}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => setRenameValue(event.currentTarget.value)}
                    onBlur={() => void commitRename()}
                    onKeyDown={(event) =>
                    {
                        if (event.key === "Enter")
                        {
                            event.preventDefault();
                            void commitRename();
                        }
                        if (event.key === "Escape")
                        {
                            event.preventDefault();
                            setRenameValue(label);
                            setIsRenaming(false);
                        }
                    }}
                    className={`my-0.5 h-6 min-w-0 flex-1 rounded border border-input bg-background pr-2 text-sm outline-none focus:ring-2 focus:ring-ring/50 ${indent ? "ml-5 pl-1" : "ml-2 pl-1"}`}
                />
            ) : (
                <button
                    type="button"
                    title={label}
                    disabled={disabled}
                    onClick={onClick}
                    className={`min-w-0 flex-1 truncate py-1 pr-2 text-left disabled:opacity-50 ${indent ? "pl-6" : "pl-3"}`}
                >
                    {label}
                </button>
            )}
            {isDirty && selection ? (
                <button
                    type="button"
                    title={`Save ${label}`}
                    aria-label={`Save ${label}`}
                    disabled={disabled || !canSave}
                    onClick={(event) =>
                    {
                        event.stopPropagation();
                        requestEditorAction(selection, "save");
                    }}
                    className="group/save mr-1 flex h-5 w-10 shrink-0 items-center justify-center rounded text-blue-600 hover:bg-blue-500/10 disabled:opacity-50 dark:text-blue-400"
                >
                    <span className="size-2 rounded-full bg-current group-hover/save:hidden" />
                    <span className="hidden text-[10px] font-semibold group-hover/save:inline">Save</span>
                </button>
            ) : null}
        </div>
    );

    if (!selection) return row;
    return (
        <ContextMenu.Root>
            <ContextMenu.Trigger render={row} />
            <ContextMenu.Portal>
                <ContextMenu.Positioner className="isolate z-50" sideOffset={4}>
                    <ContextMenu.Popup className="min-w-40 origin-(--transform-origin) rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
                        {onRename ? (
                            <>
                                <ContextMenu.Item
                                    disabled={disabled}
                                    onClick={() =>
                                    {
                                        setRenameValue(label);
                                        setIsRenaming(true);
                                    }}
                                    className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50"
                                >
                                    <PencilIcon className="size-4" />
                                    <span>Rename</span>
                                </ContextMenu.Item>
                                <ContextMenu.Separator className="-mx-1 my-1 h-px bg-border" />
                            </>
                        ) : null}
                        <ContextMenu.Item
                            disabled={disabled || !canSave}
                            onClick={() => requestEditorAction(selection, "save")}
                            className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50"
                        >
                            <SaveIcon className="size-4" />
                            <span>Save</span>
                            <span className="ml-auto text-[11px] text-muted-foreground">Ctrl+S</span>
                        </ContextMenu.Item>
                        <ContextMenu.Separator className="-mx-1 my-1 h-px bg-border" />
                        <ContextMenu.Item
                            disabled={disabled || !canDelete}
                            onClick={() => requestEditorAction(selection, "delete")}
                            className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm text-destructive outline-none select-none data-highlighted:bg-destructive/10 data-disabled:pointer-events-none data-disabled:opacity-50"
                        >
                            <Trash2Icon className="size-4" />
                            <span>Delete</span>
                        </ContextMenu.Item>
                    </ContextMenu.Popup>
                </ContextMenu.Positioner>
            </ContextMenu.Portal>
        </ContextMenu.Root>
    );
}

/** Build a renamed rule path while keeping the file in its current directory. */
function renamedRulePath(path: string, name: string): string
{
    const trimmed = name.trim();
    if (!trimmed || trimmed.includes("/") || trimmed.includes("\\")) throw new Error(`Rule filename must not contain path separators, got ${name}`);
    const nextName = trimmed.toLowerCase().endsWith(".md") ? trimmed : `${trimmed}.md`;
    return `${path.slice(0, path.lastIndexOf("/") + 1)}${nextName}`;
}

/** Return a rule filename without its default Markdown extension. */
function ruleDisplayName(path: string): string
{
    const name = fileName(path);
    return name.toLowerCase().endsWith(".md") ? name.slice(0, -3) : name;
}

/** Return rule tabs in their persisted priority order. */
function sortRuleTabs(rules: readonly RuleInput[]): RuleInput[]
{
    return [...rules].sort((left, right) => left.priority - right.priority || (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}

/** Rename one rule immediately and preserve any unsaved editor draft under the new selection key. */
async function renameRuleFromTree(workspace: Workspace, rule: RuleInput | SharedRule, name: string): Promise<boolean>
{
    let nextPath = rule.path;
    const result = await runMutation(async () =>
    {
        nextPath = renamedRulePath(rule.path, name);
        const allRules = [...workspace.rootRules, ...Object.values(workspace.domainRules).flat(), ...workspace.sharedRules];
        if (nextPath !== rule.path && allRules.some((item) => item.path === nextPath)) throw new Error(`${nextPath}: rule already exists`);
        if (nextPath !== rule.path)
        {
            if ("priority" in rule) await window.appApi.workspace.saveRule(workspace.root, { ...rule, path: nextPath });
            else await window.appApi.workspace.saveSharedRule(workspace.root, nextPath, rule.body);
            await window.appApi.workspace.deleteSource(workspace.root, rule.path);

            const state = useAppStore.getState();
            const previousKey = selectionKey({ kind: "rule", path: rule.path });
            const nextKey = selectionKey({ kind: "rule", path: nextPath });
            const draft = state.editorDrafts[previousKey];
            if (draft) state.setEditorDraft(nextKey, draft);
            state.clearEditorDraft(previousKey);
        }
        await refreshWorkspace({ kind: "rule", path: nextPath });
    });
    if (result.ok) toast.add({ title: `Renamed to ${fileName(nextPath)}`, type: "success" });
    return result.ok;
}

/** Move one rule into the selected gap without crossing its rule section. */
function moveRule(rules: readonly RuleInput[], sourcePath: string | undefined, targetPath: string, position: RuleDropPosition): RuleInput[] | undefined
{
    if (!sourcePath || sourcePath === targetPath) return undefined;
    const sourceIndex = rules.findIndex((rule) => rule.path === sourcePath);
    if (sourceIndex < 0) return undefined;
    const next = [...rules];
    const [moved] = next.splice(sourceIndex, 1);
    if (!moved) return undefined;
    const targetIndex = next.findIndex((rule) => rule.path === targetPath);
    if (targetIndex < 0) return undefined;
    next.splice(position === "before" ? targetIndex : targetIndex + 1, 0, moved);
    if (next.every((rule, index) => rule.path === rules[index]?.path)) return undefined;
    return next;
}

/** Identify the workspace rule collection being reordered. */
type RuleOrderScope = { kind: "root" } | { kind: "domain"; profile: string };

/** Persist a drag result by assigning priorities from zero in visible row order. */
async function persistRuleOrder(workspace: Workspace, rules: readonly RuleInput[], sourcePath: string | undefined, targetPath: string, position: RuleDropPosition, scope: RuleOrderScope, selection: Selection): Promise<void>
{
    const next = moveRule(rules, sourcePath, targetPath, position);
    if (!next) return;
    const ordered = next.map((rule, priority) => ({ ...rule, priority }));
    const updates = ordered.filter((rule) => rules.find((current) => current.path === rule.path)?.priority !== rule.priority);
    useAppStore.getState().setWorkspace(scope.kind === "root"
        ? { ...workspace, rootRules: ordered }
        : { ...workspace, domainRules: { ...workspace.domainRules, [scope.profile]: ordered } });
    const result = await runMutation(async () =>
    {
        for (const rule of updates) await window.appApi.workspace.saveRule(workspace.root, rule);
        await refreshWorkspace(selection.kind === "rule" ? selection : undefined);
    });
    if (result.ok) toast.add({ title: "Rule order updated", type: "success" });
    else useAppStore.getState().setWorkspace(workspace);
}

/** Props for a tree section heading. */
interface SectionProps
{
    title: string;
    disabled?: boolean;
    onNew?: () => void;
}

/** Tree section heading with an optional New action. */
function Section({ title, disabled, onNew }: SectionProps)
{
    return (
        <div className="mt-3 flex items-center justify-between px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground first:mt-1">
            <span>{title}</span>
            {onNew ? (
                <Button size="sm" variant="ghost" type="button" disabled={disabled} onClick={onNew}>
                    New
                </Button>
            ) : null}
        </div>
    );
}

/** Props for the navigation tree of one workspace module. */
export interface WorkspaceTreeProps
{
    view: WorkspaceView;
}

/** Contextual tree for Project, Rules, Domain, Agents, or Generated. */
export function WorkspaceTree({ view }: WorkspaceTreeProps)
{
    const workspace = useAppStore((state) => state.workspace);
    const selection = useAppStore((state) => state.selection);
    const setSelection = useAppStore((state) => state.setSelection);
    const profile = useAppStore((state) => state.profile);
    const isBusy = useAppStore((state) => state.isBusy);
    const editorDrafts = useAppStore((state) => state.editorDrafts);
    const [draggedRulePath, setDraggedRulePath] = useState<string>();
    const [ruleDropTarget, setRuleDropTarget] = useState<RuleDropTarget>();

    if (!workspace) return <p className="p-3 text-muted-foreground">No project open.</p>;
    const rootRuleTabs = sortRuleTabs(workspace.rootRules);
    const domainRuleTabs = sortRuleTabs(workspace.domainRules[profile] ?? []);

    return (
        <ScrollArea className="h-full">
            <div className="py-2 text-[13px]">
                {view === "project" ? (
                    <>
                        <Section title="Config" />
                        <TreeButton
                            label="config.json"
                            active={selection.kind === "config"}
                            disabled={isBusy}
                            selection={{ kind: "config" }}
                            canSave
                            onClick={() => setSelection({ kind: "config" })}
                        />
                        <Section title="Harnesses" disabled={isBusy} onNew={() => setSelection({ kind: "harness-new" })} />
                        {workspace.config.harnesses.map((harness) => (
                            <TreeButton
                                key={harness.name}
                                label={harness.name}
                                active={selection.kind === "harness" && selection.name === harness.name}
                                disabled={isBusy}
                                selection={{ kind: "harness", name: harness.name }}
                                canSave
                                canDelete
                                onClick={() => setSelection({ kind: "harness", name: harness.name })}
                            />
                        ))}
                        {(selection.kind === "harness-new" || Boolean(editorDrafts[selectionKey({ kind: "harness-new" })])) ? (
                            <TreeButton
                                label="New harness"
                                active={selection.kind === "harness-new"}
                                disabled={isBusy}
                                selection={{ kind: "harness-new" }}
                                canSave
                                onClick={() => setSelection({ kind: "harness-new" })}
                            />
                        ) : null}
                        <Section title="Profiles" disabled={isBusy} onNew={() => setSelection({ kind: "profile-new" })} />
                        {workspace.config.profiles.map((item) => (
                            <TreeButton
                                key={item}
                                label={item}
                                active={selection.kind === "profile" && selection.name === item}
                                disabled={isBusy}
                                selection={{ kind: "profile", name: item }}
                                canDelete={item !== workspace.config.defaultProfile}
                                onClick={() => setSelection({ kind: "profile", name: item })}
                            />
                        ))}
                        {(selection.kind === "profile-new" || Boolean(editorDrafts[selectionKey({ kind: "profile-new" })])) ? (
                            <TreeButton
                                label="New profile"
                                active={selection.kind === "profile-new"}
                                disabled={isBusy}
                                selection={{ kind: "profile-new" }}
                                canSave
                                onClick={() => setSelection({ kind: "profile-new" })}
                            />
                        ) : null}
                    </>
                ) : null}

                {view === "rules" ? (
                    <>
                        <Section title="Rules" disabled={isBusy} onNew={() => setSelection({ kind: "rule-new", scope: "root" })} />
                        {rootRuleTabs.map((rule) => (
                            <TreeButton
                                key={rule.path}
                                label={ruleDisplayName(rule.path)}
                                active={selection.kind === "rule" && selection.path === rule.path}
                                disabled={isBusy}
                                selection={{ kind: "rule", path: rule.path }}
                                canSave
                                canDelete
                                isDraggable
                                isDragging={draggedRulePath === rule.path}
                                dropPosition={draggedRulePath !== rule.path && ruleDropTarget?.path === rule.path ? ruleDropTarget.position : undefined}
                                onRename={(name) => renameRuleFromTree(workspace, rule, name)}
                                onDragStart={() =>
                                {
                                    setDraggedRulePath(rule.path);
                                    setRuleDropTarget(undefined);
                                }}
                                onDragEnd={() =>
                                {
                                    setDraggedRulePath(undefined);
                                    setRuleDropTarget(undefined);
                                }}
                                onDragPositionChange={(position) =>
                                {
                                    if (!draggedRulePath || draggedRulePath === rule.path) return;
                                    if (!moveRule(rootRuleTabs, draggedRulePath, rule.path, position))
                                    {
                                        setRuleDropTarget(undefined);
                                        return;
                                    }
                                    setRuleDropTarget((current) => current?.path === rule.path && current.position === position ? current : { path: rule.path, position });
                                }}
                                onDragLeave={() => setRuleDropTarget((current) => current?.path === rule.path ? undefined : current)}
                                onDrop={(position) =>
                                {
                                    const sourcePath = draggedRulePath;
                                    setDraggedRulePath(undefined);
                                    setRuleDropTarget(undefined);
                                    void persistRuleOrder(workspace, rootRuleTabs, sourcePath, rule.path, position, { kind: "root" }, selection);
                                }}
                                onClick={() => setSelection({ kind: "rule", path: rule.path })}
                            />
                        ))}
                        {(selection.kind === "rule-new" && selection.scope === "root") || Boolean(editorDrafts[selectionKey({ kind: "rule-new", scope: "root" })]) ? (
                            <TreeButton
                                label="new-rule"
                                active={selection.kind === "rule-new" && selection.scope === "root"}
                                disabled={isBusy}
                                selection={{ kind: "rule-new", scope: "root" }}
                                canSave
                                onClick={() => setSelection({ kind: "rule-new", scope: "root" })}
                            />
                        ) : null}
                        <Section title="Shared rules" disabled={isBusy} onNew={() => setSelection({ kind: "rule-new", scope: "shared" })} />
                        {workspace.sharedRules.map((rule) => (
                            <TreeButton
                                key={rule.path}
                                label={ruleDisplayName(rule.path)}
                                active={selection.kind === "rule" && selection.path === rule.path}
                                disabled={isBusy}
                                selection={{ kind: "rule", path: rule.path }}
                                canSave
                                canDelete
                                onRename={(name) => renameRuleFromTree(workspace, rule, name)}
                                onClick={() => setSelection({ kind: "rule", path: rule.path })}
                            />
                        ))}
                        {(selection.kind === "rule-new" && selection.scope === "shared") || Boolean(editorDrafts[selectionKey({ kind: "rule-new", scope: "shared" })]) ? (
                            <TreeButton
                                label="new-rule"
                                active={selection.kind === "rule-new" && selection.scope === "shared"}
                                disabled={isBusy}
                                selection={{ kind: "rule-new", scope: "shared" }}
                                canSave
                                onClick={() => setSelection({ kind: "rule-new", scope: "shared" })}
                            />
                        ) : null}
                    </>
                ) : null}

                {view === "domain" ? (
                    <>
                        <Section
                            title={`${profile} rules`}
                            disabled={isBusy}
                            onNew={() => setSelection({ kind: "rule-new", scope: "domain", profile })}
                        />
                        {domainRuleTabs.map((rule) => (
                            <TreeButton
                                key={rule.path}
                                label={ruleDisplayName(rule.path)}
                                active={selection.kind === "rule" && selection.path === rule.path}
                                disabled={isBusy}
                                selection={{ kind: "rule", path: rule.path }}
                                canSave
                                canDelete
                                isDraggable
                                isDragging={draggedRulePath === rule.path}
                                dropPosition={draggedRulePath !== rule.path && ruleDropTarget?.path === rule.path ? ruleDropTarget.position : undefined}
                                onRename={(name) => renameRuleFromTree(workspace, rule, name)}
                                onDragStart={() =>
                                {
                                    setDraggedRulePath(rule.path);
                                    setRuleDropTarget(undefined);
                                }}
                                onDragEnd={() =>
                                {
                                    setDraggedRulePath(undefined);
                                    setRuleDropTarget(undefined);
                                }}
                                onDragPositionChange={(position) =>
                                {
                                    if (!draggedRulePath || draggedRulePath === rule.path) return;
                                    if (!moveRule(domainRuleTabs, draggedRulePath, rule.path, position))
                                    {
                                        setRuleDropTarget(undefined);
                                        return;
                                    }
                                    setRuleDropTarget((current) => current?.path === rule.path && current.position === position ? current : { path: rule.path, position });
                                }}
                                onDragLeave={() => setRuleDropTarget((current) => current?.path === rule.path ? undefined : current)}
                                onDrop={(position) =>
                                {
                                    const sourcePath = draggedRulePath;
                                    setDraggedRulePath(undefined);
                                    setRuleDropTarget(undefined);
                                    void persistRuleOrder(workspace, domainRuleTabs, sourcePath, rule.path, position, { kind: "domain", profile }, selection);
                                }}
                                onClick={() => setSelection({ kind: "rule", path: rule.path })}
                            />
                        ))}
                        {(selection.kind === "rule-new" && selection.scope === "domain" && selection.profile === profile)
                            || Boolean(editorDrafts[selectionKey({ kind: "rule-new", scope: "domain", profile })]) ? (
                                <TreeButton
                                    label="new-rule"
                                    active={selection.kind === "rule-new" && selection.scope === "domain" && selection.profile === profile}
                                    disabled={isBusy}
                                    selection={{ kind: "rule-new", scope: "domain", profile }}
                                    canSave
                                    onClick={() => setSelection({ kind: "rule-new", scope: "domain", profile })}
                                />
                            ) : null}
                    </>
                ) : null}

                {view === "agents" ? (
                    <>
                        <Section title="Agents" disabled={isBusy} onNew={() => setSelection({ kind: "agent-new" })} />
                        {workspace.agents.map((agent) => (
                            <TreeButton
                                key={agent.path}
                                label={agent.name}
                                active={selection.kind === "agent" && selection.path === agent.path}
                                disabled={isBusy}
                                selection={{ kind: "agent", path: agent.path }}
                                canSave
                                canDelete
                                onClick={() => setSelection({ kind: "agent", path: agent.path })}
                            />
                        ))}
                        {(selection.kind === "agent-new" || Boolean(editorDrafts[selectionKey({ kind: "agent-new" })])) ? (
                            <TreeButton
                                label="New agent"
                                active={selection.kind === "agent-new"}
                                disabled={isBusy}
                                selection={{ kind: "agent-new" }}
                                canSave
                                onClick={() => setSelection({ kind: "agent-new" })}
                            />
                        ) : null}
                    </>
                ) : null}

                {view === "generated" ? (
                    <>
                        <Section title="Files" />
                        {workspace.generatedFiles.length === 0 ? (
                            <p className="px-3 py-2 text-muted-foreground">No generated files.</p>
                        ) : workspace.generatedFiles.map((file) => (
                            <TreeButton
                                key={file.path}
                                label={file.path}
                                active={selection.kind === "generated-file" && selection.path === file.path}
                                disabled={isBusy}
                                onClick={() => setSelection({ kind: "generated-file", path: file.path })}
                            />
                        ))}
                    </>
                ) : null}
            </div>
        </ScrollArea>
    );
}
