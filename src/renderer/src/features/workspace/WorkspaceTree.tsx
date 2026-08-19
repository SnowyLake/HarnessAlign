import { ContextMenu } from "@base-ui/react/context-menu";
import { SaveIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fileName } from "@/lib/Utils";
import { selectionKey, useAppStore, type Selection, type WorkspaceView } from "@/stores/AppStore";

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
    onClick: () => void;
}

/** One selectable row in a workspace module tree. */
function TreeButton({ label, active, indent, disabled, selection, canSave = false, canDelete = false, onClick }: TreeButtonProps)
{
    const editorKey = selection ? selectionKey(selection) : undefined;
    const isDirty = useAppStore((state) => editorKey ? Boolean(state.editorDrafts[editorKey]) : false);
    const requestEditorAction = useAppStore((state) => state.requestEditorAction);
    const row = (
        <div className={`group/tab flex w-full min-w-0 items-center ${active ? "bg-accent" : "hover:bg-accent/50"}`}>
            <button
                type="button"
                title={label}
                disabled={disabled}
                onClick={onClick}
                className={`min-w-0 flex-1 truncate py-1 pr-2 text-left disabled:opacity-50 ${indent ? "pl-6" : "pl-3"}`}
            >
                {label}
            </button>
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

    if (!workspace) return <p className="p-3 text-muted-foreground">No project open.</p>;

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
                        {workspace.rootRules.map((rule) => (
                            <TreeButton
                                key={rule.path}
                                label={fileName(rule.path)}
                                active={selection.kind === "rule" && selection.path === rule.path}
                                disabled={isBusy}
                                selection={{ kind: "rule", path: rule.path }}
                                canSave
                                canDelete
                                onClick={() => setSelection({ kind: "rule", path: rule.path })}
                            />
                        ))}
                        {(selection.kind === "rule-new" && selection.scope === "root") || Boolean(editorDrafts[selectionKey({ kind: "rule-new", scope: "root" })]) ? (
                            <TreeButton
                                label="new-rule.md"
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
                                label={fileName(rule.path)}
                                active={selection.kind === "rule" && selection.path === rule.path}
                                disabled={isBusy}
                                selection={{ kind: "rule", path: rule.path }}
                                canSave
                                canDelete
                                onClick={() => setSelection({ kind: "rule", path: rule.path })}
                            />
                        ))}
                        {(selection.kind === "rule-new" && selection.scope === "shared") || Boolean(editorDrafts[selectionKey({ kind: "rule-new", scope: "shared" })]) ? (
                            <TreeButton
                                label="new-rule.md"
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
                        {(workspace.domainRules[profile] ?? []).map((rule) => (
                            <TreeButton
                                key={rule.path}
                                label={fileName(rule.path)}
                                active={selection.kind === "rule" && selection.path === rule.path}
                                disabled={isBusy}
                                selection={{ kind: "rule", path: rule.path }}
                                canSave
                                canDelete
                                onClick={() => setSelection({ kind: "rule", path: rule.path })}
                            />
                        ))}
                        {(selection.kind === "rule-new" && selection.scope === "domain" && selection.profile === profile)
                            || Boolean(editorDrafts[selectionKey({ kind: "rule-new", scope: "domain", profile })]) ? (
                                <TreeButton
                                    label="new-rule.md"
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
