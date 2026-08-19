import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fileName } from "@/lib/Utils";
import { useAppStore, type WorkspaceView } from "@/stores/AppStore";

/** Props for one selectable row in a workspace module tree. */
interface TreeButtonProps
{
    label: string;
    active: boolean;
    indent?: boolean;
    disabled?: boolean;
    onClick: () => void;
}

/** One selectable row in a workspace module tree. */
function TreeButton({ label, active, indent, disabled, onClick }: TreeButtonProps)
{
    return (
        <button
            type="button"
            title={label}
            disabled={disabled}
            onClick={onClick}
            className={`block w-full truncate px-3 py-1 text-left disabled:opacity-50 ${indent ? "pl-6" : ""} ${active ? "bg-accent" : "hover:bg-accent/50"}`}
        >
            {label}
        </button>
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
                            onClick={() => setSelection({ kind: "config" })}
                        />
                        <Section title="Harnesses" disabled={isBusy} onNew={() => setSelection({ kind: "harness-new" })} />
                        {workspace.config.harnesses.map((harness) => (
                            <TreeButton
                                key={harness.name}
                                label={harness.name}
                                active={selection.kind === "harness" && selection.name === harness.name}
                                disabled={isBusy}
                                onClick={() => setSelection({ kind: "harness", name: harness.name })}
                            />
                        ))}
                        <Section title="Profiles" disabled={isBusy} onNew={() => setSelection({ kind: "profile-new" })} />
                        {workspace.config.profiles.map((item) => (
                            <TreeButton
                                key={item}
                                label={item}
                                active={selection.kind === "profile" && selection.name === item}
                                disabled={isBusy}
                                onClick={() => setSelection({ kind: "profile", name: item })}
                            />
                        ))}
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
                                onClick={() => setSelection({ kind: "rule", path: rule.path })}
                            />
                        ))}
                        <Section title="Shared rules" disabled={isBusy} onNew={() => setSelection({ kind: "rule-new", scope: "shared" })} />
                        {workspace.sharedRules.map((rule) => (
                            <TreeButton
                                key={rule.path}
                                label={fileName(rule.path)}
                                active={selection.kind === "rule" && selection.path === rule.path}
                                disabled={isBusy}
                                onClick={() => setSelection({ kind: "rule", path: rule.path })}
                            />
                        ))}
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
                                onClick={() => setSelection({ kind: "rule", path: rule.path })}
                            />
                        ))}
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
                                onClick={() => setSelection({ kind: "agent", path: agent.path })}
                            />
                        ))}
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
