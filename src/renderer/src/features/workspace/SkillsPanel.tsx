/**
 * Skills page: one installed list with header actions for discover, update, and import.
 */

import { useState, type ReactNode } from "react";
import type { ProjectSkill, RemoteSkill, SkillOrigin, SkillUpdate, UserSkill } from "@shared/models/Workspace";
import {
    ArrowUpCircleIcon,
    CircleAlertIcon,
    DownloadIcon,
    ExternalLinkIcon,
    FolderInputIcon,
    RefreshCwIcon,
    SearchIcon,
    Trash2Icon,
} from "lucide-react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { refreshWorkspace, runCommand, runMutation } from "@/features/workspace/WorkspaceTasks";
import { cn } from "@/lib/Utils";
import { useAppStore } from "@/stores/AppStore";

/** Which list the panel currently shows. */
type SkillsListView = "installed" | "discover";

/** Origin chip key: all installed, one GitHub repo, local imports, or unknown. */
type OriginFilter = "all" | "local" | "unknown" | `github:${string}/${string}`;

/** Counted origin chip shown beside the Installed / Discover view switch. */
interface OriginBucket
{
    key: OriginFilter;
    label: string;
    count: number;
}

/** Return whether any haystack contains the search query. */
function matchesQuery(haystacks: readonly string[], query: string): boolean
{
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return haystacks.some((item) => item.toLowerCase().includes(needle));
}

/** Stable filter key for an installed skill origin. */
function originFilterKey(origin: SkillOrigin): OriginFilter
{
    if (origin.kind === "github") return `github:${origin.owner}/${origin.name}`;
    if (origin.kind === "local") return "local";
    return "unknown";
}

/** Search haystacks for an installed skill, including GitHub provenance. */
function installedHaystacks(skill: ProjectSkill): string[]
{
    const fields = [skill.id, skill.title, skill.description];
    if (skill.origin.kind === "github") fields.push(`${skill.origin.owner}/${skill.origin.name}`, skill.origin.branch);
    return fields;
}

/** Search haystacks for a discovered remote skill. */
function remoteHaystacks(skill: RemoteSkill): string[]
{
    return [skill.id, skill.title, skill.description, `${skill.owner}/${skill.name}`, skill.sourcePath];
}

/** Build origin chips from registered sources plus installed local / unknown counts. */
function originBuckets(skillSources: readonly { owner: string; name: string }[], installed: readonly ProjectSkill[]): OriginBucket[]
{
    const buckets: OriginBucket[] = skillSources.map((source) => ({
        key: `github:${source.owner}/${source.name}`,
        label: `${source.owner}/${source.name}`,
        count: installed.filter((skill) => skill.origin.kind === "github"
            && skill.origin.owner === source.owner
            && skill.origin.name === source.name).length,
    }));
    const localCount = installed.filter((skill) => skill.origin.kind === "local").length;
    const unknownCount = installed.filter((skill) => skill.origin.kind === "unknown").length;
    if (localCount > 0) buckets.push({ key: "local", label: "Local", count: localCount });
    if (unknownCount > 0) buckets.push({ key: "unknown", label: "Unknown", count: unknownCount });
    return buckets;
}

/** Return whether an update result is an available replacement. */
function isOutdated(update: SkillUpdate): boolean
{
    return !update.error && update.currentHash !== update.remoteHash;
}

/** Compact filter chip used for list view and origin provenance. */
function FilterChip({
    label,
    count,
    isActive,
    onClick,
}: {
    label: string;
    count?: number;
    isActive: boolean;
    onClick: () => void;
})
{
    return (
        <Button type="button" size="xs" variant={isActive ? "secondary" : "outline"} aria-pressed={isActive} onClick={onClick}>
            {label}
            {count !== undefined ? <span className={cn("tabular-nums", isActive ? "text-secondary-foreground/70" : "text-muted-foreground")}>{count}</span> : null}
        </Button>
    );
}

/** Icon button with a tooltip label. */
function IconAction({
    label,
    disabled,
    className,
    onClick,
    children,
}: {
    label: string;
    disabled?: boolean;
    className?: string;
    onClick?: () => void;
    children: ReactNode;
})
{
    return (
        <Tooltip>
            <TooltipTrigger
                render={(
                    <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        disabled={disabled}
                        aria-label={label}
                        className={cn("border-0 text-muted-foreground", className)}
                        onClick={onClick}
                    />
                )}
            >
                {children}
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}

/** GitHub repo link or Local / Unknown provenance tag shown beside a skill id. */
function OriginMeta({ origin }: { origin: SkillOrigin })
{
    if (origin.kind === "github")
    {
        const repo = `${origin.owner}/${origin.name}`;
        return (
            <button
                type="button"
                className="inline-flex min-w-0 items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
                onClick={() =>
                {
                    void window.appApi.app.openExternal(`https://github.com/${origin.owner}/${origin.name}`).catch(() => undefined);
                }}
            >
                <span className="truncate">{repo}</span>
                <ExternalLinkIcon className="size-3 shrink-0" />
            </button>
        );
    }
    return (
        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
            {origin.kind === "local" ? "Local" : "Unknown"}
        </span>
    );
}

/** One compact installed-skill row with provenance, update, and remove actions. */
function InstalledSkillRow({
    skill,
    update,
    isBusy,
    onUpdate,
    onRemove,
}: {
    skill: ProjectSkill;
    update: SkillUpdate | undefined;
    isBusy: boolean;
    onUpdate: (id: string) => void;
    onRemove: (id: string) => void;
})
{
    return (
        <div className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 font-mono text-sm font-medium">{skill.id}</span>
                    <OriginMeta origin={skill.origin} />
                </div>
                {skill.description ? (
                    <p className="mt-0.5 truncate text-[12px] text-muted-foreground" title={skill.description}>{skill.description}</p>
                ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
                {update?.error ? (
                    <IconAction label={update.error} className="text-destructive">
                        <CircleAlertIcon />
                    </IconAction>
                ) : update && isOutdated(update) ? (
                    <IconAction label="Apply update" disabled={isBusy} className="text-foreground" onClick={() => onUpdate(skill.id)}>
                        <ArrowUpCircleIcon />
                    </IconAction>
                ) : null}
                <IconAction label="Remove" disabled={isBusy} onClick={() => onRemove(skill.id)}>
                    <Trash2Icon />
                </IconAction>
            </div>
        </div>
    );
}

/** Checkbox row used in the discover list and import sheet. */
function SelectableSkillRow({
    id,
    title,
    description,
    detail,
    checked,
    disabled,
    onToggle,
}: {
    id: string;
    title: string;
    description: string;
    detail?: ReactNode;
    checked: boolean;
    disabled?: boolean;
    onToggle: (id: string) => void;
})
{
    return (
        <label className={cn("flex items-start gap-3 px-4 py-3", disabled && "opacity-60")}>
            <input
                type="checkbox"
                className="mt-1"
                disabled={disabled}
                checked={checked}
                onChange={() => onToggle(id)}
            />
            <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 font-mono text-sm font-medium">{title || id}</span>
                    {detail}
                </span>
                {description ? (
                    <span className="mt-0.5 block truncate text-[12px] text-muted-foreground" title={description}>{description}</span>
                ) : null}
            </span>
        </label>
    );
}

/** Skills management page with a unified installed list and overlay pickers. */
export function SkillsPanel()
{
    const workspace = useAppStore((state) => state.workspace);
    const isBusy = useAppStore((state) => state.isBusy);
    const setOutput = useAppStore((state) => state.setOutput);
    const [listView, setListView] = useState<SkillsListView>("installed");
    const [originFilter, setOriginFilter] = useState<OriginFilter>("all");
    const [discovered, setDiscovered] = useState<RemoteSkill[]>([]);
    const [updates, setUpdates] = useState<SkillUpdate[]>([]);
    const [userSkills, setUserSkills] = useState<UserSkill[]>([]);
    const [selectedRemote, setSelectedRemote] = useState<string[]>([]);
    const [selectedImport, setSelectedImport] = useState<string[]>([]);
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
                    <EmptyDescription>The user workspace is not loaded yet.</EmptyDescription>
                </EmptyHeader>
            </Empty>
        );
    }

    const installed = workspace.skills;
    const buckets = originBuckets(workspace.config.skillSources, installed);
    const updateById = new Map(updates.map((item) => [item.id, item]));
    const outdated = updates.filter(isOutdated);
    const filteredInstalled = installed.filter((skill) => (originFilter === "all" || originFilterKey(skill.origin) === originFilter)
        && matchesQuery(installedHaystacks(skill), filter));
    const filteredDiscovered = discovered.filter((skill) => matchesQuery(remoteHaystacks(skill), filter));
    const visible = listView === "installed" ? filteredInstalled : filteredDiscovered;

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

    /** Scan registered GitHub sources and show the discover list. */
    const handleDiscover = (): void =>
    {
        void runCommand(async () =>
        {
            const skills = await window.appApi.workspace.discoverSkills();
            setDiscovered(skills);
            setSelectedRemote([]);
            setOriginFilter("all");
            setListView("discover");
            setOutput(`Discovered ${skills.length} skill(s).`, "success", "Discover completed");
        });
    };

    /** Download the selected discovered skills into this project. */
    const handleDownload = (): void =>
    {
        void runCommand(async () =>
        {
            const report = await window.appApi.workspace.installSkills(selectedRemote);
            setOutput(report, "success", "Install completed");
            setSelectedRemote([]);
            setListView("installed");
            await refreshWorkspace();
        });
    };

    /** Compare installed GitHub skills with remote content hashes. */
    const handleCheckUpdates = (): void =>
    {
        void runCommand(async () =>
        {
            const next = await window.appApi.workspace.checkSkillUpdates();
            setUpdates(next);
            setListView("installed");
            setOutput(`Checked ${next.length} GitHub skill(s).`, "success", "Update check completed");
        });
    };

    /** Apply selected or single-skill updates and refresh the workspace. */
    const handleApplyUpdates = (ids: string[]): void =>
    {
        if (ids.length === 0) return;
        void runCommand(async () =>
        {
            const report = await window.appApi.workspace.applySkillUpdates(ids);
            setOutput(report, "success", "Updates applied");
            setUpdates((current) => current.filter((item) => !ids.includes(item.id)));
            await refreshWorkspace();
        });
    };

    /** Open the user-skills picker after listing ~/.agents/skills. */
    const handleImport = (): void =>
    {
        void runCommand(async () =>
        {
            const skills = await window.appApi.workspace.listUserSkills();
            setUserSkills(skills);
            setSelectedImport([]);
            setImportOpen(true);
        });
    };

    /** Copy selected user skills, asking before overwriting project ids. */
    const handleImportConfirm = (overwrite: boolean): void =>
    {
        void runCommand(async () =>
        {
            const report = await window.appApi.workspace.importUserSkills(selectedImport, overwrite);
            setOutput(report, "success", "Import completed");
            setImportOpen(false);
            setOverwriteOpen(false);
            await refreshWorkspace();
        });
    };

    return (
        <div className="mx-auto grid w-full max-w-6xl gap-4 pb-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-semibold">Skills</h2>
                <div className="flex flex-wrap items-center justify-end gap-1">
                    <Button type="button" size="sm" variant="ghost" disabled={isBusy} onClick={handleCheckUpdates}>
                        <RefreshCwIcon />
                        Check updates
                    </Button>
                    {outdated.length > 0 ? (
                        <Button type="button" size="sm" disabled={isBusy} onClick={() => handleApplyUpdates(outdated.map((item) => item.id))}>
                            Apply {outdated.length}
                        </Button>
                    ) : null}
                    <Button type="button" size="sm" variant="ghost" disabled={isBusy} onClick={handleImport}>
                        <FolderInputIcon />
                        Import
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={isBusy || workspace.config.skillSources.length === 0}
                        title={workspace.config.skillSources.length === 0 ? "Register a GitHub source on the Project page" : undefined}
                        onClick={handleDiscover}
                    >
                        <SearchIcon />
                        Discover
                    </Button>
                    {listView === "discover" ? (
                        <Button type="button" size="sm" disabled={isBusy || selectedRemote.length === 0} onClick={handleDownload}>
                            <DownloadIcon />
                            Download
                        </Button>
                    ) : null}
                </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                    <FilterChip
                        label="Installed"
                        count={installed.length}
                        isActive={listView === "installed" && originFilter === "all"}
                        onClick={() =>
                        {
                            setListView("installed");
                            setOriginFilter("all");
                        }}
                    />
                    {listView === "discover" || discovered.length > 0 ? (
                        <FilterChip
                            label="Discover"
                            count={discovered.length}
                            isActive={listView === "discover"}
                            onClick={() => setListView("discover")}
                        />
                    ) : null}
                </div>
                {listView === "installed" && buckets.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                        {buckets.map((bucket) => (
                            <FilterChip
                                key={bucket.key}
                                label={bucket.label}
                                count={bucket.count}
                                isActive={listView === "installed" && originFilter === bucket.key}
                                onClick={() =>
                                {
                                    setListView("installed");
                                    setOriginFilter(bucket.key);
                                }}
                            />
                        ))}
                    </div>
                ) : null}
            </div>

            <div className="relative">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                    placeholder={listView === "installed"
                        ? "Search name, description, or repository..."
                        : "Search discovered skills..."}
                    className="h-9 pl-8"
                    disabled={isBusy}
                />
            </div>

            <div className="overflow-hidden rounded-xl border bg-card">
                {visible.length === 0 ? (
                    <p className="px-4 py-8 text-center text-[12px] text-muted-foreground">
                        {listView === "discover"
                            ? discovered.length === 0
                                ? "No skills found in registered sources."
                                : "No matching discovered skills."
                            : installed.length === 0
                                ? workspace.config.skillSources.length === 0
                                    ? "No installed skills yet. Register a GitHub source on the Project page, then Discover, or Import local skills."
                                    : "No installed skills yet. Use Discover or Import."
                                : "No matching skills."}
                    </p>
                ) : listView === "installed" ? (
                    <div className="divide-y">
                        {filteredInstalled.map((skill) => (
                            <InstalledSkillRow
                                key={skill.id}
                                skill={skill}
                                update={updateById.get(skill.id)}
                                isBusy={isBusy}
                                onUpdate={(id) => handleApplyUpdates([id])}
                                onRemove={setRemoveId}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="divide-y">
                        {filteredDiscovered.map((skill) => (
                            <SelectableSkillRow
                                key={`${skill.owner}/${skill.name}/${skill.sourcePath}/${skill.id}`}
                                id={skill.id}
                                title={skill.id}
                                description={skill.description}
                                disabled={isBusy || skill.conflict}
                                checked={selectedRemote.includes(skill.id)}
                                onToggle={toggleRemote}
                                detail={skill.conflict ? (
                                    <span className="text-[11px] text-destructive">Conflict</span>
                                ) : (
                                    <span className="truncate text-[12px] text-muted-foreground">{skill.owner}/{skill.name}@{skill.branch}</span>
                                )}
                            />
                        ))}
                    </div>
                )}
            </div>

            <Sheet open={importOpen} onOpenChange={setImportOpen}>
                <SheetContent side="right" className="sm:max-w-lg">
                    <SheetHeader>
                        <SheetTitle>Import user skills</SheetTitle>
                        <SheetDescription>Copy skills from ~/.agents/skills into this project.</SheetDescription>
                    </SheetHeader>
                    <div className="min-h-0 flex-1 overflow-auto">
                        {userSkills.length === 0 ? (
                            <p className="px-4 text-[12px] text-muted-foreground">No user skills found.</p>
                        ) : (
                            <div className="divide-y border-y">
                                {userSkills.map((skill) => (
                                    <SelectableSkillRow
                                        key={skill.id}
                                        id={skill.id}
                                        title={skill.id}
                                        description={skill.description || skill.title}
                                        checked={selectedImport.includes(skill.id)}
                                        onToggle={toggleImport}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                    <SheetFooter>
                        <Button
                            type="button"
                            disabled={isBusy || selectedImport.length === 0}
                            onClick={() =>
                            {
                                const overlap = selectedImport.filter((id) => installed.some((skill) => skill.id.toLowerCase() === id.toLowerCase()));
                                if (overlap.length > 0)
                                {
                                    setOverwriteOpen(true);
                                    return;
                                }
                                handleImportConfirm(false);
                            }}
                        >
                            Import
                        </Button>
                    </SheetFooter>
                </SheetContent>
            </Sheet>

            <ConfirmDialog
                open={overwriteOpen}
                onOpenChange={setOverwriteOpen}
                title="Overwrite existing skills?"
                description="One or more selected skills already exist in this project. Overwrite them?"
                confirmLabel="Overwrite"
                confirmDisabled={isBusy}
                onConfirm={() => handleImportConfirm(true)}
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
                        await window.appApi.workspace.removeSkill(removeId);
                        setRemoveId(undefined);
                        await refreshWorkspace();
                    });
                }}
            />
        </div>
    );
}
