import type { LayerOption, RuleInput, SharedRule, Workspace } from "@shared/models/Workspace";
import { useState } from "react";
import { PencilIcon, PlusIcon, SaveIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from "@/components/ui/context-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/components/ui/toast";
import { persistLayerOptionRename, persistLayerRename, refreshWorkspace, runMutation } from "@/features/workspace/WorkspaceTasks";
import { fileName, ruleDisplayName, uniqueAgentPath, uniqueRulePath, catalogLayerNames } from "@/lib/Utils";
import { selectionKey, useAppStore, type Selection, type WorkspaceView } from "@/stores/AppStore";
import { cn } from "@/lib/Utils";

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
            className={cn("group/tab relative flex w-full min-w-0 items-center text-sm", isDraggable && "cursor-grab active:cursor-grabbing", isDragging && "opacity-40", active ? "bg-accent font-medium text-foreground" : "hover:bg-accent/50")}
        >
            {dropPosition ? (
                <span
                    aria-hidden
                    className={cn("pointer-events-none absolute inset-x-2 z-10 h-0.5 rounded-full bg-primary ring-2 ring-background", dropPosition === "before" ? "top-0 -translate-y-1/2" : "bottom-0 translate-y-1/2")}
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
                    className={cn("my-0.5 h-7 min-w-0 flex-1 rounded border border-input bg-background pr-2 text-sm outline-none focus:ring-2 focus:ring-ring/50", indent ? "ml-5 pl-1" : "ml-2 pl-1")}
                />
            ) : (
                <button
                    type="button"
                    title={label}
                    disabled={disabled}
                    onClick={onClick}
                    className={cn("min-w-0 flex-1 truncate py-1.5 pr-2 text-left disabled:opacity-50", indent ? "pl-6" : "pl-3")}
                >
                    {label}
                </button>
            )}
            {isDirty ? (
                <span
                    title="Unsaved changes"
                    aria-label="Unsaved changes"
                    className="mr-1 flex size-5 shrink-0 items-center justify-center text-primary"
                >
                    <span className="size-2 rounded-full bg-current" />
                </span>
            ) : null}
        </div>
    );

    if (!selection) return row;
    return (
        <ContextMenu>
            <ContextMenuTrigger render={row} />
            <ContextMenuContent>
                        <ContextMenuGroup>
                        {onRename ? (
                            <>
                                <ContextMenuItem
                                    disabled={disabled}
                                    onClick={() =>
                                    {
                                        setRenameValue(label);
                                        setIsRenaming(true);
                                    }}
                                >
                                    <PencilIcon />
                                    <span>Rename</span>
                                </ContextMenuItem>
                                <ContextMenuSeparator />
                            </>
                        ) : null}
                        <ContextMenuItem
                            disabled={disabled || !canSave}
                            onClick={() => requestEditorAction(selection, "save")}
                        >
                            <SaveIcon />
                            <span>Save</span>
                            <ContextMenuShortcut>Ctrl+S</ContextMenuShortcut>
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                            variant="destructive"
                            disabled={disabled || !canDelete}
                            onClick={() => requestEditorAction(selection, "delete")}
                        >
                            <Trash2Icon />
                            <span>Delete</span>
                        </ContextMenuItem>
                        </ContextMenuGroup>
            </ContextMenuContent>
        </ContextMenu>
    );
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
        nextPath = uniqueRulePath(rule.path, name, [...workspace.rootRules, ...workspace.sharedRules].map((item) => item.path));
        if (nextPath !== rule.path)
        {
            if ("priority" in rule) await window.appApi.workspace.saveRule({ ...rule, path: nextPath });
            else await window.appApi.workspace.saveSharedRule(nextPath, rule.body);
            await window.appApi.workspace.deleteSource(rule.path);

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

/** Persist a drag result by assigning priorities from zero in visible row order. */
async function persistRuleOrder(workspace: Workspace, rules: readonly RuleInput[], sourcePath: string | undefined, targetPath: string, position: RuleDropPosition, selection: Selection): Promise<void>
{
    const next = moveRule(rules, sourcePath, targetPath, position);
    if (!next) return;
    const ordered = next.map((rule, priority) => ({ ...rule, priority }));
    const updates = ordered.filter((rule) => rules.find((current) => current.path === rule.path)?.priority !== rule.priority);
    useAppStore.getState().setWorkspace({ ...workspace, rootRules: ordered });
    const result = await runMutation(async () =>
    {
        for (const rule of updates) await window.appApi.workspace.saveRule(rule);
        await refreshWorkspace(selection.kind === "rule" ? selection : undefined);
    });
    if (result.ok) toast.add({ title: "Rule order updated", type: "success" });
    else useAppStore.getState().setWorkspace(workspace);
}

/** Rename one layer option through the cascade-aware engine operation. */
async function renameLayerOptionFromTree(workspace: Workspace, option: LayerOption, name: string): Promise<boolean>
{
    const nextName = name.trim().toLowerCase().endsWith(".md") ? name.trim().slice(0, -3) : name.trim();
    const result = await runMutation(async () =>
    {
        const nextPath = await persistLayerOptionRename(option.layer, option.name, nextName);
        await refreshWorkspace({ kind: "layer-option", path: nextPath });
    });
    if (result.ok) toast.add({ title: `Renamed to ${nextName}.md`, type: "success" });
    return result.ok;
}

/** Rename one catalog layer and keep editor drafts under the new name. */
async function renameLayerFromTree(workspace: Workspace, from: string, to: string): Promise<boolean>
{
    const nextName = to.trim().toLowerCase().endsWith(".md") ? to.trim().slice(0, -3) : to.trim();
    if (nextName === from) return true;
    const result = await runMutation(async () =>
    {
        await persistLayerRename(from, nextName);
    });
    if (result.ok) toast.add({ title: `Renamed layer to ${nextName}`, type: "success" });
    return result.ok;
}

/** Rename one agent file from the tree heading, keeping path and name aligned. */
async function renameAgentFromTree(workspace: Workspace, path: string, name: string): Promise<boolean>
{
    const agent = workspace.agents.find((item) => item.path === path);
    if (!agent) return false;
    let nextPath = agent.path;
    const result = await runMutation(async () =>
    {
        nextPath = uniqueAgentPath(agent.path, name, workspace.agents.map((item) => item.path));
        const nextName = ruleDisplayName(nextPath);
        if (nextPath !== agent.path || nextName !== agent.name)
        {
            await window.appApi.workspace.saveAgent({ ...agent, path: nextPath, name: nextName });
            if (nextPath !== agent.path) await window.appApi.workspace.deleteSource(agent.path);
            const state = useAppStore.getState();
            const previousKey = selectionKey({ kind: "agent", path: agent.path });
            const nextKey = selectionKey({ kind: "agent", path: nextPath });
            const draft = state.editorDrafts[previousKey];
            if (draft) state.setEditorDraft(nextKey, draft);
            state.clearEditorDraft(previousKey);
        }
        await refreshWorkspace({ kind: "agent", path: nextPath });
    });
    if (result.ok) toast.add({ title: `Renamed to ${fileName(nextPath)}`, type: "success" });
    return result.ok;
}

/** Props for a tree section heading. */
interface SectionProps
{
    title: string;
    disabled?: boolean;
    active?: boolean;
    onClick?: () => void;
    onNew?: () => void;
}

/** Tree section heading with an optional New action and optional selection. */
function Section({ title, disabled, active, onClick, onNew }: SectionProps)
{
    return (
        <div className="mt-3 flex items-center justify-between px-3 text-sm font-semibold text-foreground first:mt-1">
            {onClick ? (
                <button
                    type="button"
                    disabled={disabled}
                    onClick={onClick}
                    className={cn("min-w-0 truncate rounded-sm px-1 py-1 text-left disabled:opacity-50", active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50")}
                >
                    {title}
                </button>
            ) : (
                <span>{title}</span>
            )}
            {onNew ? (
                <Button size="icon-sm" variant="ghost" type="button" disabled={disabled} aria-label="New" onClick={onNew}>
                    <PlusIcon />
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

/** Contextual tree for Project, Rules, Layers, Agents, or Generated. */
export function WorkspaceTree({ view }: WorkspaceTreeProps)
{
    const workspace = useAppStore((state) => state.workspace);
    const selection = useAppStore((state) => state.selection);
    const setSelection = useAppStore((state) => state.setSelection);
    const isBusy = useAppStore((state) => state.isBusy);
    const editorDrafts = useAppStore((state) => state.editorDrafts);
    const [draggedRulePath, setDraggedRulePath] = useState<string>();
    const [ruleDropTarget, setRuleDropTarget] = useState<RuleDropTarget>();

    if (!workspace) return <p className="p-3 text-muted-foreground">No project open.</p>;
    const rootRuleTabs = sortRuleTabs(workspace.rootRules);

    return (
        <ScrollArea className="h-full">
            <div className="py-2 text-sm">
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
                        <Section title="Layers" />
                        {workspace.config.layers.map((item) => (
                            <TreeButton
                                key={item.name}
                                label={item.name}
                                active={selection.kind === "layer" && selection.name === item.name}
                                disabled={isBusy}
                                selection={{ kind: "layer", name: item.name }}
                                onClick={() => setSelection({ kind: "layer", name: item.name })}
                            />
                        ))}
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
                                    void persistRuleOrder(workspace, rootRuleTabs, sourcePath, rule.path, position, selection);
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

                {view === "layers" ? (
                    <>
                        <Section title="Layers" disabled={isBusy} onNew={() => setSelection({ kind: "layer-new" })} />
                        {(selection.kind === "layer-new" || Boolean(editorDrafts[selectionKey({ kind: "layer-new" })])) ? (
                            <TreeButton
                                label="new-layer"
                                active={selection.kind === "layer-new"}
                                disabled={isBusy}
                                selection={{ kind: "layer-new" }}
                                canSave
                                onClick={() => setSelection({ kind: "layer-new" })}
                            />
                        ) : null}
                        {catalogLayerNames(workspace).map((layerName) =>
                        {
                            const selected = workspace.config.layers.find((layer) => layer.name === layerName)?.selected;
                            return (
                                <div key={layerName}>
                                    <div className="flex items-center">
                                        <div className="min-w-0 flex-1">
                                            <TreeButton
                                                label={layerName}
                                                active={selection.kind === "layer" && selection.name === layerName}
                                                disabled={isBusy}
                                                selection={{ kind: "layer", name: layerName }}
                                                canSave
                                                canDelete
                                                onRename={(name) => renameLayerFromTree(workspace, layerName, name)}
                                                onClick={() => setSelection({ kind: "layer", name: layerName })}
                                            />
                                        </div>
                                        {selection.kind === "layer" && selection.name === layerName ? (
                                            <Button size="icon-sm" variant="ghost" type="button" disabled={isBusy} className="mr-3" aria-label="New option" onClick={() => setSelection({ kind: "layer-option-new", layer: layerName })}>
                                                <PlusIcon />
                                            </Button>
                                        ) : null}
                                    </div>
                                    {(workspace.layerOptions[layerName] ?? []).map((option) => (
                                        <TreeButton
                                            key={option.path}
                                            label={option.name}
                                            indent
                                            active={selection.kind === "layer-option" && selection.path === option.path}
                                            disabled={isBusy}
                                            selection={{ kind: "layer-option", path: option.path }}
                                            canSave
                                            canDelete={option.name !== selected && (workspace.layerOptions[layerName]?.length ?? 0) > 1}
                                            onRename={(name) => renameLayerOptionFromTree(workspace, option, name)}
                                            onClick={() => setSelection({ kind: "layer-option", path: option.path })}
                                        />
                                    ))}
                                    {(selection.kind === "layer-option-new" && selection.layer === layerName)
                                        || Boolean(editorDrafts[selectionKey({ kind: "layer-option-new", layer: layerName })]) ? (
                                            <TreeButton
                                                label="new-option"
                                                indent
                                                active={selection.kind === "layer-option-new" && selection.layer === layerName}
                                                disabled={isBusy}
                                                selection={{ kind: "layer-option-new", layer: layerName }}
                                                canSave
                                                onClick={() => setSelection({ kind: "layer-option-new", layer: layerName })}
                                            />
                                        ) : null}
                                </div>
                            );
                        })}
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
                                onRename={(name) => renameAgentFromTree(workspace, agent.path, name)}
                                onClick={() => setSelection({ kind: "agent", path: agent.path })}
                            />
                        ))}
                        {(selection.kind === "agent-new" || Boolean(editorDrafts[selectionKey({ kind: "agent-new" })])) ? (
                            <TreeButton
                                label="new-agent"
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
