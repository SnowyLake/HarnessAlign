/** Source navigation and Layer groups sharing the current generation selection. */

import type { LayerOption, RuleInput, SharedRule, Workspace } from "@shared/models/Workspace";
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, EditOutlined, EllipsisOutlined, PlusOutlined, RightOutlined, SaveOutlined } from "@ant-design/icons";
import { Badge, Button, Collapse, Dropdown, Empty, Flex, Input, Modal, Popover, Segmented, Select, Switch, Tooltip, Typography, type CollapseProps, type MenuProps } from "antd";
import { useEffect, useState } from "react";
import { showSuccess } from "@/components/common/Feedback";
import { persistLayerOptionRename, persistLayerRename, refreshWorkspace, runMutation, saveRenamedSource } from "@/features/workspace/WorkspaceTasks";
import { catalogLayerNames, defaultLayerOption, fileName, moveLayerSelection, ruleDisplayName, uniqueAgentPath, uniqueRulePath } from "@/lib/Utils";
import { selectionKey, useAppStore, type Selection, type WorkspaceView } from "@/stores/AppStore";

/** New-item actions exposed below workspace trees. */
const NEW_ACTION_BY_VIEW: Partial<Record<WorkspaceView, { label: string; selection: Selection }>> = {
    rules: { label: "Add rule", selection: { kind: "rule-new", scope: "root" } },
    "shared-rules": { label: "Add shared rule", selection: { kind: "rule-new", scope: "shared" } },
    layers: { label: "Add layer", selection: { kind: "layer-new" } },
    agents: { label: "Add agent", selection: { kind: "agent-new" } },
};

/** Internal Collapse key reserved for the unsaved Layer group draft. */
const NEW_LAYER_DRAFT_KEY = "__new-layer-draft__";

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
    }
    if (canSave) menuItems.push({ key: "save", icon: <SaveOutlined />, label: "Save", disabled: Boolean(disabled) });
    if (canDelete) menuItems.push({ key: "delete", icon: <DeleteOutlined />, label: "Delete", danger: true, disabled: Boolean(disabled) });

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
                    aria-current={active ? "page" : undefined}
                    disabled={Boolean(disabled)}
                    onClick={onClick}
                    className="workspace-tree-button"
                    styles={{
                        root: { paddingInline: 12, paddingLeft: indent ? 30 : 12, textAlign: "left" },
                        content: { flex: 1, minWidth: 0, overflow: "hidden", textAlign: "start", textOverflow: "ellipsis" },
                    }}
                >
                    {label}
                </Button>
            )}
            {isDirty ? (
                <Badge className="workspace-tree-dirty" status="processing" title="Unsaved changes" aria-label="Unsaved changes" />
            ) : null}
            {selection && !isRenaming ? (
                <Dropdown trigger={["click"]} menu={{ items: menuItems, onClick: handleMenuClick }}>
                    <Button type="text" size="small" icon={<EllipsisOutlined />} disabled={Boolean(disabled)} aria-label={`Actions for ${label}`} />
                </Dropdown>
            ) : null}
        </div>
    );

    if (!selection) return row;
    return (
        <Dropdown trigger={["contextMenu"]} menu={{ items: menuItems, onClick: handleMenuClick }}>{row}</Dropdown>
    );
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
            state.moveEditorDraft({ kind: "rule", path: rule.path }, { kind: "rule", path: nextPath }, ruleDisplayName(nextPath));
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
async function persistRuleOrder(rules: readonly RuleInput[], sourcePath: string | undefined, targetPath: string, position: RuleDropPosition, selection: Selection): Promise<void>
{
    const next = moveRule(rules, sourcePath, targetPath, position);
    if (!next) return;
    const ordered = next.map((rule, priority) => ({ ...rule, priority }));
    const updates = ordered.filter((rule) => rules.find((current) => current.path === rule.path)?.priority !== rule.priority);
    const result = await runMutation(async () =>
    {
        for (const rule of updates) await window.appApi.workspace.saveRule(rule);
        await refreshWorkspace(selection.kind === "rule" ? selection : undefined);
    });
    if (result.ok) showSuccess("Rule order updated");
    else await runMutation(() => refreshWorkspace());
}

/** Rename one layer option through the cascade-aware engine operation. */
async function renameLayerOptionFromTree(option: LayerOption, name: string): Promise<boolean>
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
            state.moveEditorDraft({ kind: "agent", path: agent.path }, { kind: "agent", path: nextPath }, nextName);
        }
        await refreshWorkspace({ kind: "agent", path: nextPath });
    });
    if (result.ok) showSuccess(`Renamed to ${fileName(nextPath)}`);
    return result.ok;
}

/** Props for the navigation tree of one workspace module. */
export interface WorkspaceTreeProps
{
    view: WorkspaceView;
}

/** Props for the compact Layer group action popover. */
interface LayerGroupEditorProps
{
    name: string;
    isBusy: boolean;
}

/** Edit one Layer group without replacing the option editor. */
function LayerGroupEditor({ name, isBusy }: LayerGroupEditorProps)
{
    const [isOpen, setIsOpen] = useState(false);
    const [isDeleteOpen, setIsDeleteOpen] = useState(false);
    const [isRenaming, setIsRenaming] = useState(false);
    const [nextName, setNextName] = useState(name);

    /** Persist a changed Layer name and keep any selected option active. */
    const handleRename = async (): Promise<void> =>
    {
        const trimmed = nextName.trim();
        if (!trimmed || trimmed === name)
        {
            setNextName(name);
            setIsOpen(false);
            return;
        }
        setIsRenaming(true);
        const result = await runMutation(async () =>
        {
            await persistLayerRename(name, trimmed);
            await refreshWorkspace();
        });
        setIsRenaming(false);
        if (result.ok)
        {
            setIsOpen(false);
            showSuccess(`Renamed layer to ${trimmed}`);
        }
    };

    /** Permanently remove the Layer and its related editor drafts. */
    const handleDelete = async (): Promise<void> =>
    {
        const result = await runMutation(async () =>
        {
            await window.appApi.workspace.removeLayer(name);
            const state = useAppStore.getState();
            const optionPrefix = `layer-option:.harness-align/layers/${name}/`;
            const newOptionKey = selectionKey({ kind: "layer-option-new", layer: name });
            const layerKey = selectionKey({ kind: "layer", name });
            for (const key of Object.keys(state.editorDrafts))
            {
                if (key === layerKey || key === newOptionKey || key.startsWith(optionPrefix)) state.clearEditorDraft(key);
            }
            state.setLayerSelection(state.layerSelection.filter((item) => item.name !== name));
            await refreshWorkspace();
        });
        if (result.ok)
        {
            setIsDeleteOpen(false);
            showSuccess(`Deleted layer ${name}`);
        }
    };

    const content = (
        <div className="workspace-layer-popover" onClick={(event) => event.stopPropagation()}>
            <form
                className="workspace-layer-rename"
                onSubmit={(event) =>
                {
                    event.preventDefault();
                    void handleRename();
                }}
            >
                <Input className="workspace-layer-rename-input" autoFocus value={nextName} disabled={isBusy || isRenaming} aria-label="Layer name" onChange={(event) => setNextName(event.currentTarget.value)} />
                <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={isRenaming} disabled={isBusy || !nextName.trim()} aria-label="Save layer name" />
            </form>
            <div className="workspace-layer-popover-actions">
                <Button
                    type="text"
                    danger
                    block
                    icon={<DeleteOutlined />}
                    disabled={isBusy}
                    styles={{ root: { justifyContent: "flex-start" } }}
                    onClick={() =>
                    {
                        setIsOpen(false);
                        setIsDeleteOpen(true);
                    }}
                >
                    Delete layer
                </Button>
            </div>
        </div>
    );

    return (
        <>
            <span onClick={(event) => event.stopPropagation()}>
                <Popover
                    arrow={false}
                    placement="rightTop"
                    trigger="click"
                    open={isOpen}
                    content={content}
                    destroyOnHidden
                    styles={{ container: { padding: 10 } }}
                    onOpenChange={(open) =>
                    {
                        setNextName(name);
                        setIsOpen(open);
                    }}
                >
                    <Button
                        type="text"
                        size="small"
                        icon={<EditOutlined />}
                        disabled={isBusy}
                        title="Edit layer"
                        aria-label={`Edit ${name}`}
                    />
                </Popover>
            </span>
            <Modal
                open={isDeleteOpen}
                title={`Delete layer ${name}?`}
                okText="Delete"
                okType="danger"
                confirmLoading={isBusy}
                onCancel={() => setIsDeleteOpen(false)}
                onOk={() => void handleDelete()}
            >
                <Typography.Text>This permanently removes layer {name} and every option inside it.</Typography.Text>
            </Modal>
        </>
    );
}

/** Contextual tree for Project, Rules, Layers, Agents, or Generated. */
export function WorkspaceTree({ view }: WorkspaceTreeProps)
{
    const workspace = useAppStore((state) => state.workspace);
    const selection = useAppStore((state) => state.selection);
    const setSelection = useAppStore((state) => state.setSelection);
    const setView = useAppStore((state) => state.setView);
    const isBusy = useAppStore((state) => state.isBusy);
    const editorDrafts = useAppStore((state) => state.editorDrafts);
    const layerSelection = useAppStore((state) => state.layerSelection);
    const setLayerSelection = useAppStore((state) => state.setLayerSelection);
    const [draggedLayer, setDraggedLayer] = useState<string>();
    const [draggedRulePath, setDraggedRulePath] = useState<string>();
    const [ruleDropTarget, setRuleDropTarget] = useState<RuleDropTarget>();
    const selectedLayerName = selection.kind === "layer" ? selection.name
        : selection.kind === "layer-option-new" ? selection.layer
            : selection.kind === "layer-option" ? Object.values(workspace?.layerOptions ?? {}).flat().find((option) => option.path === selection.path)?.layer
                : undefined;
    const [openLayerNames, setOpenLayerNames] = useState<string[]>(selectedLayerName ? [selectedLayerName] : []);

    useEffect(() =>
    {
        if (!selectedLayerName) return;
        setOpenLayerNames((current) => current.includes(selectedLayerName) ? current : [...current, selectedLayerName]);
    }, [selectedLayerName]);

    if (!workspace) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No project open" />;
    const rootRuleTabs = workspace.rootRules;
    const isRuleView = view === "rules" || view === "shared-rules";
    const newAction = NEW_ACTION_BY_VIEW[view];
    const layerNames = [...layerSelection.map((layer) => layer.name), ...catalogLayerNames(workspace).filter((name) => !layerSelection.some((layer) => layer.name === name))];
    const layerItems: NonNullable<CollapseProps["items"]> = layerNames.map((layerName) =>
    {
        const options = workspace.layerOptions[layerName] ?? [];
        const selectedOption = workspace.config.layers.find((layer) => layer.name === layerName)?.selected;
        const layerEditorSelection: Selection = { kind: "layer", name: layerName };
        const generationIndex = layerSelection.findIndex((layer) => layer.name === layerName);
        const isEnabled = generationIndex >= 0;
        const generationOption = layerSelection[generationIndex]?.option ?? defaultLayerOption(workspace, layerName);
        const isLayerActive = selection.kind === "layer" && selection.name === layerName;
        const newOptionSelection: Selection = { kind: "layer-option-new", layer: layerName };
        const hasNewOptionDraft = Boolean(editorDrafts[selectionKey(newOptionSelection)]);

        /** Move this enabled group by one position without writing source files. */
        const moveGroup = (offset: -1 | 1): void =>
        {
            const current = useAppStore.getState().layerSelection;
            const index = current.findIndex((layer) => layer.name === layerName);
            const target = current[index + offset];
            if (index >= 0 && target) setLayerSelection(moveLayerSelection(current, layerName, target.name));
        };

        return {
            key: layerName,
            label: (
                <span className="workspace-layer-group-title" data-layer={layerName} data-active={isLayerActive || undefined}
                    data-dragging={draggedLayer === layerName || undefined} draggable={isEnabled && !isBusy}
                    title={isEnabled ? "Drag to reorder generation" : layerName}
                    onDragStart={(event) =>
                    {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", layerName);
                        setDraggedLayer(layerName);
                    }}
                    onDragEnd={() => setDraggedLayer(undefined)}
                    onDragOver={(event) =>
                    {
                        if (draggedLayer && isEnabled && !isBusy) event.preventDefault();
                    }}
                    onDrop={(event) =>
                    {
                        event.preventDefault();
                        if (draggedLayer && isEnabled && !isBusy) setLayerSelection(moveLayerSelection(useAppStore.getState().layerSelection, draggedLayer, layerName));
                        setDraggedLayer(undefined);
                    }}>
                    <Typography.Text type="secondary" className="workspace-layer-group-order">{isEnabled ? generationIndex + 1 : "-"}</Typography.Text>
                    <span className="workspace-layer-group-name">{layerName}</span>
                    {editorDrafts[selectionKey(layerEditorSelection)] ? <Badge status="processing" title="Unsaved changes" aria-label="Unsaved changes" /> : null}
                </span>
            ),
            extra: (
                <span className="workspace-layer-group-actions" onClick={(event) => event.stopPropagation()}>
                    <Tooltip title={options.length === 0 ? "Add an option before enabling" : "Include in generation"}>
                        <Switch size="small" checked={isEnabled} disabled={isBusy || options.length === 0} aria-label={`Include ${layerName} in generation`}
                            onChange={(checked) =>
                            {
                                const current = useAppStore.getState().layerSelection.filter((layer) => layer.name !== layerName);
                                setLayerSelection(checked && generationOption ? [...current, { name: layerName, option: generationOption }] : current);
                            }} />
                    </Tooltip>
                    <Tooltip title="Add option">
                        <Button
                            type="text"
                            size="small"
                            icon={<PlusOutlined />}
                            disabled={isBusy}
                            aria-label={`Add option to ${layerName}`}
                            onClick={(event) =>
                            {
                                event.stopPropagation();
                                setOpenLayerNames((current) => current.includes(layerName) ? current : [...current, layerName]);
                                setSelection(newOptionSelection);
                            }}
                        />
                    </Tooltip>
                    <LayerGroupEditor name={layerName} isBusy={isBusy} />
                </span>
            ),
            classNames: { header: "workspace-layer-group-header", body: "workspace-layer-group-body" },
            styles: {
                header: { minHeight: 38, marginBlock: 4, padding: "4px 4px 4px 8px", borderRadius: 8, background: "var(--ant-color-fill-quaternary)" },
                body: { padding: "0 0 6px 12px" },
            },
            children: (
                <div className="workspace-layer-options">
                    <div className="workspace-layer-generation">
                        <div className="workspace-layer-choice">
                            <Typography.Text type="secondary">Generate option</Typography.Text>
                            <Select size="small" value={generationOption ?? null} disabled={isBusy || !isEnabled} placeholder="No options"
                                aria-label={`Generate option for ${layerName}`} className="full-width"
                                options={options.map((option) => ({ label: option.name, value: option.name }))}
                                onChange={(option: string) => setLayerSelection(useAppStore.getState().layerSelection.map((layer) => layer.name === layerName ? { ...layer, option } : layer))} />
                        </div>
                        <Tooltip title="Move earlier">
                            <Button size="small" type="text" icon={<ArrowUpOutlined />} aria-label={`Move ${layerName} earlier`}
                                disabled={isBusy || generationIndex <= 0} onClick={() => moveGroup(-1)} />
                        </Tooltip>
                        <Tooltip title="Move later">
                            <Button size="small" type="text" icon={<ArrowDownOutlined />} aria-label={`Move ${layerName} later`}
                                disabled={isBusy || !isEnabled || generationIndex === layerSelection.length - 1} onClick={() => moveGroup(1)} />
                        </Tooltip>
                    </div>
                    {options.length === 0 && !hasNewOptionDraft ? (
                        <Typography.Text type="secondary" className="workspace-layer-empty">No options yet</Typography.Text>
                    ) : null}
                    {options.map((option) => (
                        <TreeButton
                            key={option.path}
                            label={option.name}
                            active={selection.kind === "layer-option" && selection.path === option.path}
                            disabled={isBusy}
                            selection={{ kind: "layer-option", path: option.path }}
                            canSave
                            canDelete={option.name !== selectedOption}
                            onRename={(name) => renameLayerOptionFromTree(option, name)}
                            onClick={() => setSelection({ kind: "layer-option", path: option.path })}
                        />
                    ))}
                    {(selection.kind === "layer-option-new" && selection.layer === layerName) || hasNewOptionDraft ? (
                        <TreeButton
                            label="new-option"
                            active={selection.kind === "layer-option-new" && selection.layer === layerName}
                            disabled={isBusy}
                            selection={newOptionSelection}
                            canSave
                            onClick={() => setSelection(newOptionSelection)}
                        />
                    ) : null}
                </div>
            ),
        };
    });
    const newLayerSelection: Selection = { kind: "layer-new" };
    if (selection.kind === "layer-new" || Boolean(editorDrafts[selectionKey(newLayerSelection)]))
    {
        layerItems.push({
            key: NEW_LAYER_DRAFT_KEY,
            showArrow: false,
            label: (
                <Button
                    type="text"
                    block
                    icon={<RightOutlined />}
                    disabled={isBusy}
                    onClick={(event) =>
                    {
                        event.stopPropagation();
                        setSelection(newLayerSelection);
                    }}
                    className="workspace-layer-draft-button"
                    styles={{ root: { minHeight: 38, paddingInline: 8, textAlign: "left" }, content: { flex: 1, minWidth: 0 } }}
                >
                    <span className="workspace-layer-group-title" data-active={selection.kind === "layer-new" || undefined}>
                        <span>new-layer</span>
                        <Typography.Text type="secondary" className="workspace-layer-group-count">0</Typography.Text>
                        {editorDrafts[selectionKey(newLayerSelection)] ? <Badge status="processing" title="Unsaved changes" aria-label="Unsaved changes" /> : null}
                    </span>
                </Button>
            ),
            classNames: { header: "workspace-layer-group-header", body: "workspace-layer-group-body" },
            styles: {
                header: { minHeight: 38, marginBlock: 4, padding: 0, borderRadius: 8, background: "var(--ant-control-item-bg-active)" },
                body: { padding: 0 },
            },
        });
    }

    return (
        <div className="workspace-tree">
            <Flex className="workspace-tree-header" wrap={isRuleView} style={isRuleView ? { flexBasis: "auto" } : undefined}>
                <Flex align="center" gap={8} wrap={isRuleView}>
                    <Typography.Text strong>{isRuleView ? "Rules" : view.charAt(0).toUpperCase() + view.slice(1)}</Typography.Text>
                    {isRuleView ? (
                        <Segmented<"rules" | "shared-rules">
                            size="small"
                            name="rule-scope"
                            aria-label="Rule scope"
                            value={view}
                            options={[{ value: "rules", label: "Root" }, { value: "shared-rules", label: "Shared" }]}
                            onChange={setView}
                            disabled={isBusy}
                        />
                    ) : null}
                </Flex>
                {newAction ? <Tooltip title={newAction.label}>
                    <Button type="text" size="small" icon={<PlusOutlined />} disabled={isBusy} aria-label={newAction.label}
                            onClick={() => setSelection(newAction.selection)}>Add</Button>
                </Tooltip> : null}
            </Flex>
            <div className="workspace-tree-content">
                {view === "rules" ? (
                    <>
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
                                    void persistRuleOrder(rootRuleTabs, sourcePath, rule.path, position, selection);
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
                    </>
                ) : null}

                {view === "shared-rules" ? (
                    <>
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
                        <Collapse
                            ghost
                            size="small"
                            items={layerItems}
                            activeKey={openLayerNames}
                            onChange={(keys) => setOpenLayerNames(Array.isArray(keys) ? keys.map(String) : [String(keys)])}
                            className="workspace-layer-groups"
                        />
                    </>
                ) : null}

                {view === "agents" ? (
                    <>
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
