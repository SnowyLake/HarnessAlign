/**
 * Skills page: one installed list with header actions for discover, update, and import.
 */

import { Fragment, useId, useState, type ReactNode } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldContent, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemSeparator, ItemTitle } from "@/components/ui/item";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { refreshWorkspace, runCommand, runMutation } from "@/features/workspace/WorkspaceTasks";
import { useAppStore } from "@/stores/AppStore";

/** Which list the panel currently shows. */
type SkillsListView = "installed" | "discover";

/** Origin chip key: all installed, one GitHub repo, local imports, or unknown. */
type OriginFilter = "all" | "local" | "unknown" | `github:${string}/${string}`;

/** Counted origin option shown in the installed-skill filter. */
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

/** Build origin options from registered sources plus installed local / unknown counts. */
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

/** Icon button with a tooltip label. */
function IconAction({
    label,
    disabled,
    variant = "ghost",
    onClick,
    children,
}: {
    label: string;
    disabled?: boolean;
    variant?: "ghost" | "outline" | "destructive";
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
                        variant={variant}
                        disabled={disabled}
                        aria-label={label}
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

/** GitHub repo link or local provenance badge shown beside a skill id. */
function OriginMeta({ origin }: { origin: SkillOrigin })
{
    if (origin.kind === "github")
    {
        const repo = `${origin.owner}/${origin.name}`;
        return (
            <button
                type="button"
                className="min-w-0 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                aria-label={`Open ${repo} on GitHub`}
                onClick={() =>
                {
                    void window.appApi.app.openExternal(`https://github.com/${origin.owner}/${origin.name}`).catch(() => undefined);
                }}
            >
                <Badge variant="outline" className="max-w-full">
                    <span className="truncate">{repo}</span>
                    <ExternalLinkIcon />
                </Badge>
            </button>
        );
    }
    return (
        <Badge variant="secondary">
            {origin.kind === "local" ? "Local" : "Unknown"}
        </Badge>
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
        <Item>
            <ItemContent>
                <ItemTitle>
                    <span className="shrink-0">{skill.id}</span>
                    <OriginMeta origin={skill.origin} />
                </ItemTitle>
                {skill.description ? (
                    <ItemDescription title={skill.description}>{skill.description}</ItemDescription>
                ) : null}
            </ItemContent>
            <ItemActions>
                {update?.error ? (
                    <IconAction label={update.error} variant="destructive">
                        <CircleAlertIcon data-icon="inline-start" />
                    </IconAction>
                ) : update && isOutdated(update) ? (
                    <IconAction label="Apply update" disabled={isBusy} variant="outline" onClick={() => onUpdate(skill.id)}>
                        <ArrowUpCircleIcon data-icon="inline-start" />
                    </IconAction>
                ) : null}
                <IconAction label="Remove" disabled={isBusy} variant="destructive" onClick={() => onRemove(skill.id)}>
                    <Trash2Icon data-icon="inline-start" />
                </IconAction>
            </ItemActions>
        </Item>
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
    const inputId = useId();
    return (
        <Item>
            <Field orientation="horizontal" data-disabled={disabled || undefined}>
                <Checkbox
                    id={inputId}
                    disabled={disabled}
                    checked={checked}
                    onCheckedChange={() => onToggle(id)}
                />
                <FieldContent>
                    <ItemTitle>
                        <FieldLabel htmlFor={inputId}>{title || id}</FieldLabel>
                        {detail}
                    </ItemTitle>
                    {description ? <ItemDescription title={description}>{description}</ItemDescription> : null}
                </FieldContent>
            </Field>
        </Item>
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
            <Empty>
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
    const originItems = [
        { label: `All (${installed.length})`, value: "all" as OriginFilter },
        ...buckets.map((bucket) => ({ label: `${bucket.label} (${bucket.count})`, value: bucket.key })),
    ];

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
        <Tabs
            className="mx-auto w-full max-w-6xl gap-4 pb-4"
            value={listView}
            onValueChange={(value) =>
            {
                const next = value as SkillsListView;
                setListView(next);
                if (next === "installed") setOriginFilter("all");
            }}
        >
            <div className="flex flex-wrap items-center justify-between gap-3">
                <TabsList variant="line" aria-label="Skills view">
                    <TabsTrigger value="installed">
                        Installed <Badge variant="secondary">{installed.length}</Badge>
                    </TabsTrigger>
                    {listView === "discover" || discovered.length > 0 ? (
                        <TabsTrigger value="discover">
                            Discover <Badge variant="secondary">{discovered.length}</Badge>
                        </TabsTrigger>
                    ) : null}
                </TabsList>
                <div className="flex flex-wrap items-center justify-end gap-2">
                    <Button type="button" variant="outline" disabled={isBusy} onClick={handleCheckUpdates}>
                        <RefreshCwIcon data-icon="inline-start" />
                        Check updates
                    </Button>
                    {outdated.length > 0 ? (
                        <Button type="button" disabled={isBusy} onClick={() => handleApplyUpdates(outdated.map((item) => item.id))}>
                            Apply {outdated.length}
                        </Button>
                    ) : null}
                    <Button type="button" variant="outline" disabled={isBusy} onClick={handleImport}>
                        <FolderInputIcon data-icon="inline-start" />
                        Import
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={isBusy || workspace.config.skillSources.length === 0}
                        title={workspace.config.skillSources.length === 0 ? "Register a GitHub source on the Home page" : undefined}
                        onClick={handleDiscover}
                    >
                        <SearchIcon data-icon="inline-start" />
                        Discover
                    </Button>
                    {listView === "discover" ? (
                        <Button type="button" disabled={isBusy || selectedRemote.length === 0} onClick={handleDownload}>
                            <DownloadIcon data-icon="inline-start" />
                            Download
                        </Button>
                    ) : null}
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
                <InputGroup className="min-w-64 flex-1">
                    <InputGroupInput
                        aria-label="Search skills"
                        value={filter}
                        onChange={(event) => setFilter(event.target.value)}
                        placeholder={listView === "installed"
                            ? "Search name, description, or repository..."
                            : "Search discovered skills..."}
                        disabled={isBusy}
                    />
                    <InputGroupAddon align="inline-start"><SearchIcon /></InputGroupAddon>
                </InputGroup>
                {listView === "installed" && buckets.length > 0 ? (
                    <Select
                        items={originItems}
                        value={originFilter}
                        onValueChange={(value) =>
                        {
                            if (value !== null) setOriginFilter(value);
                        }}
                    >
                        <SelectTrigger aria-label="Filter skills by source" className="w-56 max-w-full"><SelectValue /></SelectTrigger>
                        <SelectContent alignItemWithTrigger={false} align="end">
                            <SelectGroup>
                                {originItems.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                ) : null}
            </div>

            <TabsContent value="installed">
                {filteredInstalled.length === 0 ? (
                    <Empty className="py-8"><EmptyHeader><EmptyTitle>No skills to show</EmptyTitle><EmptyDescription>
                        {installed.length === 0
                            ? workspace.config.skillSources.length === 0
                                ? "No installed skills yet. Register a GitHub source on the Home page, then Discover, or Import local skills."
                                : "No installed skills yet. Use Discover or Import."
                            : "No matching skills."}
                    </EmptyDescription></EmptyHeader></Empty>
                ) : (
                    <ItemGroup>
                        {filteredInstalled.map((skill, index) => (
                            <Fragment key={skill.id}>
                                <InstalledSkillRow
                                    skill={skill}
                                    update={updateById.get(skill.id)}
                                    isBusy={isBusy}
                                    onUpdate={(id) => handleApplyUpdates([id])}
                                    onRemove={setRemoveId}
                                />
                                {index < filteredInstalled.length - 1 ? <ItemSeparator /> : null}
                            </Fragment>
                        ))}
                    </ItemGroup>
                )}
            </TabsContent>

            <TabsContent value="discover">
                {filteredDiscovered.length === 0 ? (
                    <Empty className="py-8"><EmptyHeader><EmptyTitle>No skills to show</EmptyTitle><EmptyDescription>
                        {discovered.length === 0 ? "No skills found in registered sources." : "No matching discovered skills."}
                    </EmptyDescription></EmptyHeader></Empty>
                ) : (
                    <ItemGroup>
                        {filteredDiscovered.map((skill, index) => (
                            <Fragment key={`${skill.owner}/${skill.name}/${skill.sourcePath}/${skill.id}`}>
                                <SelectableSkillRow
                                    id={skill.id}
                                    title={skill.id}
                                    description={skill.description}
                                    disabled={isBusy || skill.conflict}
                                    checked={selectedRemote.includes(skill.id)}
                                    onToggle={toggleRemote}
                                    detail={skill.conflict ? (
                                        <Badge variant="destructive">Conflict</Badge>
                                    ) : (
                                        <Badge variant="outline" className="max-w-full truncate">{skill.owner}/{skill.name}@{skill.branch}</Badge>
                                    )}
                                />
                                {index < filteredDiscovered.length - 1 ? <ItemSeparator /> : null}
                            </Fragment>
                        ))}
                    </ItemGroup>
                )}
            </TabsContent>

            <Sheet open={importOpen} onOpenChange={setImportOpen}>
                <SheetContent side="right" className="sm:max-w-lg">
                    <SheetHeader>
                        <SheetTitle>Import user skills</SheetTitle>
                        <SheetDescription>Copy skills from ~/.agents/skills into this project.</SheetDescription>
                    </SheetHeader>
                    <div className="min-h-0 flex-1 overflow-auto">
                        {userSkills.length === 0 ? (
                            <Empty><EmptyHeader><EmptyTitle>No user skills</EmptyTitle><EmptyDescription>No skills were found in ~/.agents/skills.</EmptyDescription></EmptyHeader></Empty>
                        ) : (
                            <ItemGroup>
                                {userSkills.map((skill, index) => (
                                    <Fragment key={skill.id}>
                                        <SelectableSkillRow
                                            id={skill.id}
                                            title={skill.id}
                                            description={skill.description || skill.title}
                                            checked={selectedImport.includes(skill.id)}
                                            onToggle={toggleImport}
                                        />
                                        {index < userSkills.length - 1 ? <ItemSeparator /> : null}
                                    </Fragment>
                                ))}
                            </ItemGroup>
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
        </Tabs>
    );
}
