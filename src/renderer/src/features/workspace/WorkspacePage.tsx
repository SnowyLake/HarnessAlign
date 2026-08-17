/**
 * Workspace tree and editors that call `window.appApi`.
 * Saves go through Main path checks; this module never imports Node or Electron.
 */

import type { AgentFormat, Config, HarnessConfig, RuleInput, Workspace } from "@shared/models/Workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/common/EmptyState";
import { fileName } from "@/lib/Utils";
import { useAppStore, type Selection } from "@/stores/AppStore";

/** Build a rule payload, omitting `targets` when every harness is selected. */
function rulePayload(path: string, priority: number, targets: string[] | undefined, body: string): RuleInput
{
    return targets === undefined ? { path, priority, body } : { path, priority, targets, body };
}

/** Run workspace work while holding the busy flag and logging thrown errors. */
async function wrap(work: () => Promise<void>): Promise<void>
{
    const { setIsBusy, setLog } = useAppStore.getState();
    setIsBusy(true);
    try
    {
        await work();
    }
    catch (error)
    {
        setLog(error instanceof Error ? error.message : String(error));
    }
    finally
    {
        setIsBusy(false);
    }
}

/** Reload the open workspace after a source or generate change. */
export async function refreshWorkspace(next?: Selection): Promise<void>
{
    const current = useAppStore.getState().workspace;
    if (!current) return;
    const workspace = await window.appApi.workspace.load(current.root);
    const profile = useAppStore.getState().profile;
    useAppStore.getState().setWorkspace(workspace);
    useAppStore.getState().setProfile(workspace.config.profiles.includes(profile) ? profile : workspace.config.defaultProfile);
    if (next) useAppStore.getState().setSelection(next);
}

/** One selectable row in the workspace tree. */
function TreeButton({ label, active, indent, onClick }: { label: string; active: boolean; indent?: boolean; onClick: () => void })
{
    return (
        <button
            type="button"
            onClick={onClick}
            className={`block w-full truncate px-3 py-1 text-left ${indent ? "pl-6" : ""} ${active ? "bg-accent" : "hover:bg-accent/50"}`}
        >
            {label}
        </button>
    );
}

/** Tree section heading with an optional New action. */
function Section({ title, onNew }: { title: string; onNew?: () => void })
{
    return (
        <div className="mt-3 flex items-center justify-between px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span>{title}</span>
            {onNew ? <Button size="sm" variant="ghost" onClick={onNew}>New</Button> : null}
        </div>
    );
}

/** Left tree of config, harnesses, profiles, rules, and agents. */
export function WorkspaceTree()
{
    const workspace = useAppStore((state) => state.workspace);
    const selection = useAppStore((state) => state.selection);
    const setSelection = useAppStore((state) => state.setSelection);
    if (!workspace) return <p className="p-3 text-muted-foreground">No workspace.</p>;

    /** Prompt for a profile name and create it through Main. */
    const addProfile = () =>
    {
        const name = window.prompt("New profile name");
        if (!name) return;
        void wrap(async () =>
        {
            await window.appApi.workspace.addProfile(workspace.root, name.trim());
            await refreshWorkspace({ kind: "profile", name: name.trim() });
            useAppStore.getState().setLog(`Created profile ${name.trim()}.`);
        });
    };

    return (
        <div className="h-full overflow-auto py-2 text-[13px]">
            <Section title="Config" />
            <TreeButton label="config.json" active={selection.kind === "settings"} onClick={() => setSelection({ kind: "settings" })} />
            <Section title="Harnesses" onNew={() => setSelection({ kind: "harness-new" })} />
            {workspace.config.harnesses.map((harness) => (
                <TreeButton
                    key={harness.name}
                    label={harness.name}
                    active={selection.kind === "harness" && selection.name === harness.name}
                    onClick={() => setSelection({ kind: "harness", name: harness.name })}
                />
            ))}
            <Section title="Profiles" onNew={addProfile} />
            {workspace.config.profiles.map((profile) => (
                <TreeButton
                    key={profile}
                    label={profile}
                    active={selection.kind === "profile" && selection.name === profile}
                    onClick={() => setSelection({ kind: "profile", name: profile })}
                />
            ))}
            <Section title="Rules" onNew={() => setSelection({ kind: "rule-new", scope: "root" })} />
            {workspace.rootRules.map((rule) => (
                <TreeButton
                    key={rule.path}
                    label={fileName(rule.path)}
                    active={selection.kind === "rule" && selection.path === rule.path}
                    onClick={() => setSelection({ kind: "rule", path: rule.path })}
                />
            ))}
            {workspace.config.profiles.map((profile) => (
                <div key={profile}>
                    <Section title={`${profile} domain`} onNew={() => setSelection({ kind: "rule-new", scope: "domain", profile })} />
                    {(workspace.domainRules[profile] ?? []).map((rule) => (
                        <TreeButton
                            key={rule.path}
                            indent
                            label={fileName(rule.path)}
                            active={selection.kind === "rule" && selection.path === rule.path}
                            onClick={() => setSelection({ kind: "rule", path: rule.path })}
                        />
                    ))}
                </div>
            ))}
            <Section title="Shared rules" onNew={() => setSelection({ kind: "rule-new", scope: "shared" })} />
            {workspace.sharedRules.map((rule) => (
                <TreeButton
                    key={rule.path}
                    label={fileName(rule.path)}
                    active={selection.kind === "rule" && selection.path === rule.path}
                    onClick={() => setSelection({ kind: "rule", path: rule.path })}
                />
            ))}
            <Section title="Agents" onNew={() => setSelection({ kind: "agent-new" })} />
            {workspace.agents.map((agent) => (
                <TreeButton
                    key={agent.path}
                    label={agent.name}
                    active={selection.kind === "agent" && selection.path === agent.path}
                    onClick={() => setSelection({ kind: "agent", path: agent.path })}
                />
            ))}
        </div>
    );
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
                    <input type="checkbox" value={harness.name} defaultChecked={selected?.includes(harness.name) ?? false} />
                    {harness.name}
                </label>
            ))}
        </fieldset>
    );
}

/** Read checked harness names from a form, or `undefined` when none are checked. */
function readTargets(root: HTMLElement): string[] | undefined
{
    const values = [...root.querySelectorAll("input[type=checkbox]")].filter((node) => (node as HTMLInputElement).checked).map((node) => (node as HTMLInputElement).value);
    return values.length === 0 ? undefined : values;
}

/** Editor for `config.json` title and default profile. */
function ConfigForm({ workspace }: { workspace: Workspace })
{
    return (
        <form
            className="grid max-w-3xl gap-3"
            onSubmit={(event) =>
            {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                void wrap(async () =>
                {
                    const next: Config = {
                        ...workspace.config,
                        name: String(form.get("name") ?? "").trim(),
                        defaultProfile: String(form.get("defaultProfile") ?? ""),
                    };
                    await window.appApi.workspace.saveConfig(workspace.root, next);
                    await refreshWorkspace({ kind: "settings" });
                    useAppStore.getState().setLog("Saved config.json.");
                });
            }}
        >
            <h2 className="text-base font-semibold">Settings</h2>
            <Label>name<Input name="name" defaultValue={workspace.config.name} /></Label>
            <Label>
                default_profile
                <NativeSelect name="defaultProfile" defaultValue={workspace.config.defaultProfile} className="w-full">
                    {workspace.config.profiles.map((profile) => <option key={profile} value={profile}>{profile}</option>)}
                </NativeSelect>
            </Label>
            <Button type="submit">Save</Button>
        </form>
    );
}

/** Editor for adding or updating one harness declaration. */
function HarnessForm({ workspace, original }: { workspace: Workspace; original?: string })
{
    const existing = workspace.config.harnesses.find((harness) => harness.name === original);
    return (
        <form
            className="grid max-w-3xl gap-3"
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
                void wrap(async () =>
                {
                    if (original === undefined) await window.appApi.workspace.addHarness(workspace.root, harness);
                    else
                    {
                        if (original !== harness.name) await window.appApi.workspace.renameHarness(workspace.root, original, harness.name);
                        const current = await window.appApi.workspace.load(workspace.root);
                        const harnesses = current.config.harnesses.map((item) => (item.name === harness.name ? harness : item));
                        await window.appApi.workspace.saveConfig(current.root, { ...current.config, harnesses });
                    }
                    await refreshWorkspace({ kind: "harness", name: harness.name });
                    useAppStore.getState().setLog(`Saved harness ${harness.name}.`);
                });
            }}
        >
            <h2 className="text-base font-semibold">{original ? `Harness ${original}` : "New harness"}</h2>
            <Label>name<Input name="name" defaultValue={existing?.name ?? ""} /></Label>
            <Label>config_path<Input name="configPath" defaultValue={existing?.configPath ?? ""} /></Label>
            <Label>
                agent_format
                <NativeSelect name="agentFormat" defaultValue={existing?.agentFormat ?? "yaml"} className="w-full">
                    <option value="yaml">yaml</option>
                    <option value="toml">toml</option>
                </NativeSelect>
            </Label>
            <Label>agent_extension<Input name="agentExtension" defaultValue={existing?.agentExtension ?? "md"} /></Label>
            <Label>instructions_field (TOML only)<Input name="instructionsField" defaultValue={existing?.instructionsField ?? ""} /></Label>
            <div className="flex gap-2">
                <Button type="submit">Save</Button>
                {original ? (
                    <Button
                        variant="destructive"
                        onClick={() =>
                        {
                            if (!window.confirm(`Delete harness ${original}?`)) return;
                            void wrap(async () =>
                            {
                                await window.appApi.workspace.removeHarness(workspace.root, original);
                                await refreshWorkspace({ kind: "settings" });
                                useAppStore.getState().setLog(`Deleted harness ${original}.`);
                            });
                        }}
                    >
                        Delete
                    </Button>
                ) : null}
            </div>
        </form>
    );
}

/** Editor pane for the current workspace selection. */
export function WorkspaceEditor()
{
    const workspace = useAppStore((state) => state.workspace);
    const selection = useAppStore((state) => state.selection);
    if (!workspace) return <EmptyState title="No workspace" body="Open a directory that contains .halign/config.json." />;
    if (selection.kind === "settings") return <ConfigForm workspace={workspace} />;
    if (selection.kind === "harness") return <HarnessForm workspace={workspace} original={selection.name} />;
    if (selection.kind === "harness-new") return <HarnessForm workspace={workspace} />;
    if (selection.kind === "profile")
    {
        const name = selection.name;
        return (
            <div className="grid max-w-3xl gap-3">
                <h2 className="text-base font-semibold">Profile {name}</h2>
                <p className="text-muted-foreground">
                    {name === workspace.config.defaultProfile
                        ? "This is default_profile and cannot be removed until you change it in config.json."
                        : `Deleting removes .halign/domains/${name}/.`}
                </p>
                {name !== workspace.config.defaultProfile ? (
                    <Button
                        variant="destructive"
                        onClick={() =>
                        {
                            if (!window.confirm(`Delete profile ${name}?`)) return;
                            void wrap(async () =>
                            {
                                await window.appApi.workspace.removeProfile(workspace.root, name);
                                await refreshWorkspace({ kind: "settings" });
                                useAppStore.getState().setLog(`Deleted profile ${name}.`);
                            });
                        }}
                    >
                        Delete
                    </Button>
                ) : null}
            </div>
        );
    }
    if (selection.kind === "rule" || selection.kind === "rule-new") return <RuleForm workspace={workspace} selection={selection} />;
    return <AgentForm workspace={workspace} selection={selection} />;
}

/** Editor for a root, domain, or shared rule. */
function RuleForm({ workspace, selection }: { workspace: Workspace; selection: Extract<Selection, { kind: "rule" } | { kind: "rule-new" }> })
{
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

    if (isShared)
    {
        return (
            <form
                className="grid max-w-3xl gap-3"
                onSubmit={(event) =>
                {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    const path = String(form.get("path") ?? "").trim();
                    const body = String(form.get("body") ?? "");
                    const original = sharedExisting?.path;
                    void wrap(async () =>
                    {
                        await window.appApi.workspace.saveSharedRule(workspace.root, path, body);
                        if (original && original !== path) await window.appApi.workspace.deleteSource(workspace.root, original);
                        await refreshWorkspace({ kind: "rule", path });
                        useAppStore.getState().setLog(`Saved ${path}.`);
                    });
                }}
            >
                <h2 className="text-base font-semibold">Shared rule</h2>
                <Label>path<Input name="path" defaultValue={sharedExisting?.path ?? defaultPath} /></Label>
                <Label>body<Textarea name="body" defaultValue={sharedExisting?.body ?? "# Title\n\nbody\n"} /></Label>
                <div className="flex gap-2">
                    <Button type="submit">Save</Button>
                    {sharedExisting ? (
                        <Button variant="destructive" onClick={() => void deletePath(workspace.root, sharedExisting.path)}>Delete</Button>
                    ) : null}
                </div>
            </form>
        );
    }

    const existing = selection.kind === "rule"
        ? [...workspace.rootRules, ...Object.values(workspace.domainRules).flat()].find((rule) => rule.path === selection.path)
        : undefined;
    return (
        <form
            className="grid max-w-3xl gap-3"
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
                void wrap(async () =>
                {
                    await window.appApi.workspace.saveRule(workspace.root, payload);
                    if (original && original !== payload.path) await window.appApi.workspace.deleteSource(workspace.root, original);
                    await refreshWorkspace({ kind: "rule", path: payload.path });
                    useAppStore.getState().setLog(`Saved ${payload.path}.`);
                });
            }}
        >
            <h2 className="text-base font-semibold">Rule</h2>
            <Label>path<Input name="path" defaultValue={existing?.path ?? defaultPath} /></Label>
            <Label>priority<Input name="priority" type="number" defaultValue={String(existing?.priority ?? 100)} /></Label>
            <TargetBoxes selected={existing?.targets} />
            <Label>body<Textarea name="body" defaultValue={existing?.body ?? "# Title\n\nbody\n"} /></Label>
            <div className="flex gap-2">
                <Button type="submit">Save</Button>
                {existing ? <Button variant="destructive" onClick={() => void deletePath(workspace.root, existing.path)}>Delete</Button> : null}
            </div>
        </form>
    );
}

/** Confirm then delete a `.halign` source file through Main. */
async function deletePath(root: string, path: string): Promise<void>
{
    if (!window.confirm(`Delete ${path}?`)) return;
    await wrap(async () =>
    {
        await window.appApi.workspace.deleteSource(root, path);
        await refreshWorkspace({ kind: "settings" });
        useAppStore.getState().setLog(`Deleted ${path}.`);
    });
}

/** Editor for a subagent source and per-harness JSON metadata. */
function AgentForm({ workspace, selection }: { workspace: Workspace; selection: Extract<Selection, { kind: "agent" } | { kind: "agent-new" }> })
{
    const existing = selection.kind === "agent" ? workspace.agents.find((agent) => agent.path === selection.path) : undefined;
    return (
        <form
            className="grid max-w-3xl gap-3"
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
                    useAppStore.getState().setLog(error instanceof Error ? error.message : String(error));
                    return;
                }
                const agent = {
                    path: String(form.get("path") ?? "").trim(),
                    name: String(form.get("name") ?? "").trim(),
                    description: String(form.get("description") ?? "").trim(),
                    harnesses,
                    body: String(form.get("body") ?? ""),
                };
                void wrap(async () =>
                {
                    await window.appApi.workspace.saveAgent(workspace.root, agent);
                    if (existing && existing.path !== agent.path) await window.appApi.workspace.deleteSource(workspace.root, existing.path);
                    await refreshWorkspace({ kind: "agent", path: agent.path });
                    useAppStore.getState().setLog(`Saved ${agent.path}.`);
                });
            }}
        >
            <h2 className="text-base font-semibold">{existing ? `Agent ${existing.name}` : "New agent"}</h2>
            <Label>path<Input name="path" defaultValue={existing?.path ?? ".halign/agents/new-agent.md"} /></Label>
            <Label>name<Input name="name" defaultValue={existing?.name ?? ""} /></Label>
            <Label>description<Input name="description" defaultValue={existing?.description ?? ""} /></Label>
            {workspace.config.harnesses.map((harness) => (
                <Label key={harness.name}>
                    {harness.name} metadata (JSON)
                    <Textarea name={`meta-${harness.name}`} className="min-h-28" defaultValue={JSON.stringify(existing?.harnesses[harness.name] ?? {}, null, 2)} />
                </Label>
            ))}
            <Label>body<Textarea name="body" defaultValue={existing?.body ?? "Instructions.\n"} /></Label>
            <div className="flex gap-2">
                <Button type="submit">Save</Button>
                {existing ? <Button variant="destructive" onClick={() => void deletePath(workspace.root, existing.path)}>Delete</Button> : null}
            </div>
        </form>
    );
}

/** Workspace feature page that combines the tree, editor, and log. */
export function WorkspacePage()
{
    const log = useAppStore((state) => state.log);
    return (
        <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_132px]">
            <div className="min-h-0 border-r border-border bg-card">
                <WorkspaceTree />
            </div>
            <div className="min-h-0 overflow-auto p-4">
                <WorkspaceEditor />
            </div>
            <pre className="col-span-2 overflow-auto border-t border-border bg-background p-3 font-mono text-[12px] whitespace-pre-wrap text-muted-foreground">{log}</pre>
        </div>
    );
}
