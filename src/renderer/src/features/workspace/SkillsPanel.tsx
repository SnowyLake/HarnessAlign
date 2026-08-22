/**
 * Top-level Skills panel for discover, install, update, import, and remove.
 */

import { useState } from "react";
import type { RemoteSkill, SkillUpdate, UserSkill } from "@shared/models/Workspace";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { refreshWorkspace, runCommand, runMutation } from "@/features/workspace/WorkspaceTasks";
import { useAppStore } from "@/stores/AppStore";

/** Skills management page with installed, remote, update, and import actions. */
export function SkillsPanel()
{
    const workspace = useAppStore((state) => state.workspace);
    const isBusy = useAppStore((state) => state.isBusy);
    const setOutput = useAppStore((state) => state.setOutput);
    const [discovered, setDiscovered] = useState<RemoteSkill[]>([]);
    const [updates, setUpdates] = useState<SkillUpdate[]>([]);
    const [userSkills, setUserSkills] = useState<UserSkill[]>([]);
    const [selectedRemote, setSelectedRemote] = useState<string[]>([]);
    const [selectedImport, setSelectedImport] = useState<string[]>([]);
    const [selectedUpdates, setSelectedUpdates] = useState<string[]>([]);
    const [importOpen, setImportOpen] = useState(false);
    const [overwriteOpen, setOverwriteOpen] = useState(false);
    const [removeId, setRemoveId] = useState<string>();
    const [filter, setFilter] = useState("");

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

    const installed = workspace.skills;
    const filteredInstalled = installed.filter((skill) => skill.id.toLowerCase().includes(filter.toLowerCase())
        || skill.title.toLowerCase().includes(filter.toLowerCase()));

    /** Toggle a remote skill id in the install selection. */
    const toggleRemote = (id: string): void =>
    {
        setSelectedRemote((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
    };

    /** Toggle a user skill id in the import selection. */
    const toggleImport = (id: string): void =>
    {
        setSelectedImport((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
    };

    /** Toggle an update id in the apply selection. */
    const toggleUpdate = (id: string): void =>
    {
        setSelectedUpdates((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
    };

    return (
        <div className="mx-auto grid w-full max-w-6xl gap-6 pb-4">
            <section className="grid gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h2 className="text-base font-semibold">Installed skills</h2>
                        <p className="text-[12px] text-muted-foreground">Project skills under .halign/skills. Setup copies them into ~/.agents/skills.</p>
                    </div>
                    <Input
                        value={filter}
                        onChange={(event) => setFilter(event.target.value)}
                        placeholder="Filter"
                        className="w-40"
                        disabled={isBusy}
                    />
                </div>
                {filteredInstalled.length === 0 ? (
                    <p className="text-[12px] text-muted-foreground">No installed skills yet.</p>
                ) : (
                    <div className="grid gap-3">
                        {filteredInstalled.map((skill) => (
                            <Card key={skill.id} className="grid gap-2">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <div className="text-sm font-medium">{skill.title}</div>
                                        <div className="text-[12px] text-muted-foreground">{skill.id}{skill.description ? ` — ${skill.description}` : ""}</div>
                                    </div>
                                    <Button type="button" size="sm" variant="outline" disabled={isBusy} onClick={() => setRemoveId(skill.id)}>
                                        Remove
                                    </Button>
                                </div>
                                <div className="text-[12px] text-muted-foreground">
                                    {skill.origin.kind === "github"
                                        ? `github:${skill.origin.owner}/${skill.origin.name}@${skill.origin.branch}`
                                        : skill.origin.kind === "local"
                                            ? "local import"
                                            : "unknown origin"}
                                </div>
                            </Card>
                        ))}
                    </div>
                )}
            </section>

            <section className="grid gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h2 className="text-base font-semibold">Discover</h2>
                        <p className="text-[12px] text-muted-foreground">Scan registered GitHub sources and download selected skills.</p>
                    </div>
                    <div className="flex gap-2">
                        <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={isBusy || workspace.config.skillSources.length === 0}
                            onClick={() =>
                            {
                                void runCommand(async () =>
                                {
                                    const skills = await window.appApi.workspace.discoverSkills(workspace.root);
                                    setDiscovered(skills);
                                    setSelectedRemote([]);
                                    setOutput(`Discovered ${skills.length} skill(s).`, "success", "Discover completed");
                                });
                            }}
                        >
                            Discover
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            disabled={isBusy || selectedRemote.length === 0}
                            onClick={() =>
                            {
                                void runCommand(async () =>
                                {
                                    const report = await window.appApi.workspace.installSkills(workspace.root, selectedRemote);
                                    setOutput(report, "success", "Install completed");
                                    setSelectedRemote([]);
                                    await refreshWorkspace();
                                });
                            }}
                        >
                            Download
                        </Button>
                    </div>
                </div>
                {discovered.length === 0 ? (
                    <p className="text-[12px] text-muted-foreground">Run Discover after registering sources on the Project page.</p>
                ) : (
                    <div className="grid gap-2">
                        {discovered.map((skill) => (
                            <label key={`${skill.owner}/${skill.name}/${skill.sourcePath}/${skill.id}`} className="flex items-start gap-2 text-[12px]">
                                <input
                                    type="checkbox"
                                    className="mt-1"
                                    disabled={isBusy || skill.conflict}
                                    checked={selectedRemote.includes(skill.id)}
                                    onChange={() => toggleRemote(skill.id)}
                                />
                                <span>
                                    <span className="font-medium">{skill.title}</span>
                                    {" "}({skill.id})
                                    {skill.conflict ? " — conflict" : ""}
                                    {skill.description ? ` — ${skill.description}` : ""}
                                    <span className="block text-muted-foreground">{skill.owner}/{skill.name}@{skill.branch} {skill.sourcePath || "."}</span>
                                </span>
                            </label>
                        ))}
                    </div>
                )}
            </section>

            <section className="grid gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h2 className="text-base font-semibold">Updates</h2>
                        <p className="text-[12px] text-muted-foreground">Compare installed GitHub skills with remote content hashes.</p>
                    </div>
                    <div className="flex gap-2">
                        <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={isBusy}
                            onClick={() =>
                            {
                                void runCommand(async () =>
                                {
                                    const next = await window.appApi.workspace.checkSkillUpdates(workspace.root);
                                    setUpdates(next);
                                    setSelectedUpdates(next.filter((item) => !item.error && item.currentHash !== item.remoteHash).map((item) => item.id));
                                    setOutput(`Checked ${next.length} GitHub skill(s).`, "success", "Update check completed");
                                });
                            }}
                        >
                            Check updates
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            disabled={isBusy || selectedUpdates.length === 0}
                            onClick={() =>
                            {
                                void runCommand(async () =>
                                {
                                    const report = await window.appApi.workspace.applySkillUpdates(workspace.root, selectedUpdates);
                                    setOutput(report, "success", "Updates applied");
                                    setSelectedUpdates([]);
                                    setUpdates([]);
                                    await refreshWorkspace();
                                });
                            }}
                        >
                            Apply updates
                        </Button>
                    </div>
                </div>
                {updates.length === 0 ? (
                    <p className="text-[12px] text-muted-foreground">No update results yet.</p>
                ) : (
                    <div className="grid gap-2">
                        {updates.map((update) => (
                            <label key={update.id} className="flex items-start gap-2 text-[12px]">
                                <input
                                    type="checkbox"
                                    className="mt-1"
                                    disabled={isBusy || Boolean(update.error) || update.currentHash === update.remoteHash}
                                    checked={selectedUpdates.includes(update.id)}
                                    onChange={() => toggleUpdate(update.id)}
                                />
                                <span>
                                    <span className="font-medium">{update.id}</span>
                                    {update.error
                                        ? ` — ${update.error}`
                                        : update.currentHash === update.remoteHash
                                            ? " — up to date"
                                            : " — update available"}
                                </span>
                            </label>
                        ))}
                    </div>
                )}
            </section>

            <section className="grid gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h2 className="text-base font-semibold">Import</h2>
                        <p className="text-[12px] text-muted-foreground">Copy skills from ~/.agents/skills into this project.</p>
                    </div>
                    <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={isBusy}
                        onClick={() =>
                        {
                            void runCommand(async () =>
                            {
                                const skills = await window.appApi.workspace.listUserSkills();
                                setUserSkills(skills);
                                setSelectedImport([]);
                                setImportOpen(true);
                            });
                        }}
                    >
                        Import from user skills
                    </Button>
                </div>
            </section>

            <ConfirmDialog
                open={importOpen}
                onOpenChange={setImportOpen}
                title="Import user skills"
                description={(
                    <div className="grid gap-2">
                        <p>Select skills to import from the user profile.</p>
                        {userSkills.length === 0 ? (
                            <p className="text-[12px] text-muted-foreground">No user skills found.</p>
                        ) : (
                            userSkills.map((skill) => (
                                <label key={skill.id} className="flex items-start gap-2 text-[12px]">
                                    <input
                                        type="checkbox"
                                        className="mt-1"
                                        checked={selectedImport.includes(skill.id)}
                                        onChange={() => toggleImport(skill.id)}
                                    />
                                    <span>{skill.title} ({skill.id})</span>
                                </label>
                            ))
                        )}
                    </div>
                )}
                confirmLabel="Import"
                confirmDisabled={isBusy || selectedImport.length === 0}
                onConfirm={() =>
                {
                    const overlap = selectedImport.filter((id) => installed.some((skill) => skill.id.toLowerCase() === id.toLowerCase()));
                    if (overlap.length > 0)
                    {
                        setImportOpen(false);
                        setOverwriteOpen(true);
                        return;
                    }
                    void runCommand(async () =>
                    {
                        const report = await window.appApi.workspace.importUserSkills(workspace.root, selectedImport, false);
                        setOutput(report, "success", "Import completed");
                        setImportOpen(false);
                        await refreshWorkspace();
                    });
                }}
            />

            <ConfirmDialog
                open={overwriteOpen}
                onOpenChange={setOverwriteOpen}
                title="Overwrite existing skills?"
                description="One or more selected skills already exist in this project. Overwrite them?"
                confirmLabel="Overwrite"
                confirmDisabled={isBusy}
                onConfirm={() =>
                {
                    void runCommand(async () =>
                    {
                        const report = await window.appApi.workspace.importUserSkills(workspace.root, selectedImport, true);
                        setOutput(report, "success", "Import completed");
                        setOverwriteOpen(false);
                        await refreshWorkspace();
                    });
                }}
            />

            <ConfirmDialog
                open={removeId !== undefined}
                onOpenChange={(open) =>
                {
                    if (!open) setRemoveId(undefined);
                }}
                title="Remove skill?"
                description={`Remove ${removeId ?? ""} from this project?`}
                confirmLabel="Remove"
                confirmDisabled={isBusy}
                onConfirm={() =>
                {
                    if (!removeId) return;
                    void runMutation(async () =>
                    {
                        await window.appApi.workspace.removeSkill(workspace.root, removeId);
                        setRemoveId(undefined);
                        await refreshWorkspace();
                    });
                }}
            />
        </div>
    );
}
