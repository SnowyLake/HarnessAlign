import type { LayerOption, RuleInput, SharedRule, Workspace } from "@shared/models/Workspace";
import { DeleteOutlined, EditOutlined, PlusOutlined, SaveOutlined } from "@ant-design/icons";
import { Badge, Button, Dropdown, Empty, Input, Typography, type MenuProps } from "antd";
import { useState } from "react";
import { showSuccess } from "@/components/common/Feedback";
import { persistLayerOptionRename, persistLayerRename, refreshWorkspace, runMutation, saveRenamedSource } from "@/features/workspace/WorkspaceTasks";
import { catalogLayerNames, fileName, ruleDisplayName, uniqueAgentPath, uniqueRulePath } from "@/lib/Utils";
import { selectionKey, useAppStore, type Selection, type WorkspaceView } from "@/stores/AppStore";

/** Contextual titles for the master list beside each workspace editor. */
const TREE_COPY: Record<WorkspaceView, { title: string; description: string }> = {
    project: { title: "Project structure", description: "Configuration and harness targets" },
    rules: { title: "Rule library", description: "Repository and shared instructions" },
    layers: { title: "Layer catalog", description: "Selectable instruction variants" },
    agents: { title: "Agent profiles", description: "Reusable subagent definitions" },
    skills: { title: "Project skills", description: "Installed capabilities" },
    generated: { title: "Output files", description: "Generated harness content" },
};

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

    const menuItems: NonNullable<MenuProps["items"]> = [];
    if (onRename)
    {
        menuItems.push({ key: "rename", icon: <EditOutlined />, label: "Rename", disabled: Boolean(disabled) });
        menuItems.push({ type: "divider" });
    }
    menuItems.push({ key: "save", icon: <SaveOutlined />, label: "Save", disabled: Boolean(disabled) || !canSave });
    menuItems.push({ type: "divider" });
    menuItems.push({ key: "delete", icon: <DeleteOutlined />, label: "Delete", danger: true, disabled: Boolean(disabled) || !canDelete });

    /** Dispatch one context menu command to the selected editor row. */
    const handleMenuClick: MenuProps["onClick"] = ({ key }) =>
    {
        if (!selection) return;
        if (key === "rename")
        {
            setRenameValue(label);
            setIsRenaming(true);
        }
        else if (key === "save") requestEditorAction(selection, "save");
        else if (key === "delete") requestEditorAction(selection, "delete");
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
            className="workspace-tree-row"
            data-active={active || undefined}
            data-indent={indent || undefined}
            data-draggable={isDraggable || undefined}
            data-dragging={isDragging || undefined}
        >
            {dropPosition ? (
                <span aria-hidden className="workspace-tree-drop" data-position={dropPosition} />
            ) : null}
            {isRenaming ? (
                <Input
                    autoFocus
                    size="small"
                    value={renameValue}
                    disabled={disabled || isRenameBusy}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => setRenameValue(event.currentTarget.value)}
                    onBlur={() => void commitRename()}
                    onPressEnter={() => void commitRename()}
                    onKeyDown={(event) =>
                    {
                        if (event.key === "Escape")
                        {
                            event.preventDefault();
                            setRenameValue(label);
                            setIsRenaming(false);
                        }
                    }}
                    className="workspace-tree-rename"
                />
            ) : (
                <Button
                    type="text"
                    block
                    title={label}
                    disabled={Boolean(disabled)}
                    onClick={onClick}
                    className="workspace-tree-button"
                >
                    {label}
                </Button>
            )}
            {isDirty ? (
                <Badge status="processing" title="Unsaved changes" aria-label="Unsaved changes" />
            ) : null}
        </div>
    );

    if (!selection) return row;
    return (
        <Dropdown trigger={["contextMenu"]} menu={{ items: menuItems, onClick: handleMenuClick }}>{row}</Dropdown>
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
            await window.appApi.workspace.renameSource(rule.path, nextPath);

            const state = useAppStore.getState();
            const previousKey = selectionKey({ kind: "rule", path: rule.path });
            const nextKey = selectionKey({ kind: "rule", path: nextPath });
            const draft = state.editorDrafts[previousKey];
            if (draft) state.setEditorDraft(nextKey, {
                ...draft,
                selection: { kind: "rule", path: nextPath },
            });
            state.clearEditorDraft(previousKey);
        }
        await refreshWorkspace({ kind: "rule", path: nextPath });
    });
    if (result.ok) showSuccess(`Renamed to ${fileName(nextPath)}`);
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
    if (result.ok) showSuccess("Rule order updated");
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
    if (result.ok) showSuccess(`Renamed to ${nextName}.md`);
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
        await refreshWorkspace({ kind: "layer", name: nextName });
    });
    if (result.ok) showSuccess(`Renamed layer to ${nextName}`);
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
            await saveRenamedSource(agent.path, nextPath, (savePath) => window.appApi.workspace.saveAgent({ ...agent, path: savePath, name: nextName }));
            const state = useAppStore.getState();
            const previousKey = selectionKey({ kind: "agent", path: agent.path });
            const nextKey = selectionKey({ kind: "agent", path: nextPath });
            const draft = state.editorDrafts[previousKey];
            if (draft) state.setEditorDraft(nextKey, {
                ...draft,
                selection: { kind: "agent", path: nextPath },
            });
            state.clearEditorDraft(previousKey);
        }
        await refreshWorkspace({ kind: "agent", path: nextPath });
    });
    if (result.ok) showSuccess(`Renamed to ${fileName(nextPath)}`);
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
        <div className="workspace-tree-section" data-active={active || undefined}>
            {onClick ? (
                <Button
                    type="text"
                    block
                    disabled={Boolean(disabled)}
                    onClick={onClick}
                    className="workspace-tree-section-button"
                >
                    {title}
                </Button>
            ) : (
                <Typography.Text strong>{title}</Typography.Text>
            )}
            {onNew ? (
                <Button size="small" type="text" disabled={Boolean(disabled)} aria-label="New" icon={<PlusOutlined />} onClick={onNew} />
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

    if (!workspace) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No project open" />;
    const rootRuleTabs = sortRuleTabs(workspace.rootRules);
    const copy = TREE_COPY[view];

    return (
        <div className="workspace-tree">
            <div className="workspace-tree-content">
                <div className="workspace-tree-header">
                    <Typography.Text className="section-eyebrow">Browse</Typography.Text>
                    <Typography.Title level={5}>{copy.title}</Typography.Title>
                    <Typography.Text type="secondary">{copy.description}</Typography.Text>
                </div>
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
                                    <div className="workspace-tree-layer-row">
                                        <div className="workspace-tree-layer-main">
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
                                            <Button size="small" type="text" disabled={isBusy} aria-label="New option" icon={<PlusOutlined />} onClick={() => setSelection({ kind: "layer-option-new", layer: layerName })} />
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
                            <Typography.Text type="secondary" className="workspace-tree-empty">No generated files.</Typography.Text>
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
        </div>
    );
}
