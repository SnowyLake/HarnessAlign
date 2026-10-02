/** Workspace labels and source paths with Windows-safe collision checks. */

import type { LayerConfig, LayerSelection, ProjectSkill, RemoteSkill, SetupChange, Workspace } from "../../../shared/models/Workspace.js";

/** Map deployment warnings to compact labels while leaving their full details intact. */
export function setupExternalLabel(reason: string): string
{
    switch (reason)
    {
        case "Changed since last deployment": return "Modified";
        case "Extra path will be deleted": return "Extra";
        case "Existing content has no deployment baseline": return "Untracked";
        default: return "Details";
    }
}

/** Select deployment preview rows without altering the complete execution preview. */
export function filterSetupChanges(changes: readonly SetupChange[], view: "changed" | "all"): SetupChange[]
{
    return changes.filter((change) => view === "all" || change.status === "added" || change.status === "modified" || change.status === "deleted");
}

/** Return discovered ids that have no source conflict or installed case-insensitive match. */
export function selectableRemoteSkillIds(discovered: readonly RemoteSkill[], installed: readonly ProjectSkill[]): Set<string>
{
    const installedIds = new Set(installed.map((skill) => skill.id.toLowerCase()));
    return new Set(discovered.filter((skill) => !skill.conflict && !installedIds.has(skill.id.toLowerCase())).map((skill) => skill.id));
}

/** Return the final path segment of a `/`-separated workspace-relative path. */
export function fileName(path: string): string
{
    return path.split("/").pop() ?? path;
}

/** Return a rule filename without its default Markdown extension. */
export function ruleDisplayName(path: string): string
{
    const name = fileName(path);
    return name.toLowerCase().endsWith(".md") ? name.slice(0, -3) : name;
}

/** Join a rule filename onto the current rule directory. */
function renamedRulePath(path: string, name: string): string
{
    const trimmed = name.trim();
    if (!trimmed || trimmed.includes("/") || trimmed.includes("\\")) throw new Error(`Rule filename must not contain path separators, got ${name}`);
    const nextName = trimmed.toLowerCase().endsWith(".md") ? trimmed : `${trimmed}.md`;
    return `${path.slice(0, path.lastIndexOf("/") + 1)}${nextName}`;
}

/** Build a renamed rule path in the same directory, rejecting empty names, separators, and collisions. */
export function uniqueRulePath(currentPath: string, name: string, existingPaths: readonly string[]): string
{
    const nextPath = renamedRulePath(currentPath, name);
    if (existingPaths.some((path) => path !== currentPath && path.toLowerCase() === nextPath.toLowerCase())) throw new Error(`${nextPath}: rule already exists`);
    return nextPath;
}

/** Build `.harness-align/agents/<name>.md` from a heading, rejecting separators and collisions. */
export function uniqueAgentPath(currentPath: string | undefined, name: string, existingPaths: readonly string[]): string
{
    const trimmed = name.trim();
    if (!trimmed || trimmed.includes("/") || trimmed.includes("\\")) throw new Error(`Agent name must not contain path separators, got ${name}`);
    const stem = trimmed.toLowerCase().endsWith(".md") ? trimmed.slice(0, -3) : trimmed;
    const nextPath = `.harness-align/agents/${stem}.md`;
    if (existingPaths.some((path) => path !== currentPath && path.toLowerCase() === nextPath.toLowerCase())) throw new Error(`${nextPath}: agent already exists`);
    return nextPath;
}

/** Return discovered Layer directory names in their loaded order. */
export function catalogLayerNames(workspace: Workspace): string[]
{
    return Object.keys(workspace.layerOptions);
}

/** Return the option a Project card should use when adding an existing Layer. */
export function defaultLayerOption(workspace: Workspace, name: string): string | undefined
{
    const options = Object.hasOwn(workspace.layerOptions, name) ? workspace.layerOptions[name] : undefined;
    if (!options?.length) return undefined;
    const saved = workspace.config.layers.find((layer) => layer.name === name)?.selected;
    if (saved && options.some((option) => option.name === saved)) return saved;
    return options[0]?.name;
}

/** Compare the saved Layer configuration with the current ordered generation selection. */
export function hasLayerChanges(saved: readonly LayerConfig[], current: readonly LayerSelection[]): boolean
{
    return saved.length !== current.length || saved.some((item, index) => item.name !== current[index]?.name || item.selected !== current[index]?.option);
}

/** Move one enabled layer before or after its target in generation order. */
export function moveLayerSelection(selection: readonly LayerSelection[], sourceName: string, targetName: string): LayerSelection[]
{
    const sourceIndex = selection.findIndex((item) => item.name === sourceName);
    const targetIndex = selection.findIndex((item) => item.name === targetName);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return [...selection];
    const next = [...selection];
    const [source] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, source!);
    return next;
}

/** One saved source's inclusion or exclusion for a configured Harness. */
export interface HarnessEffect
{
    kind: "Rule" | "Layer option" | "Agent";
    path: string;
    active: boolean;
    reason: string;
}

/** Explain the same explicit allowlists and ordered Layer choices used for generation. */
export function harnessEffects(workspace: Workspace, harness: string, selection: readonly LayerSelection[]): HarnessEffect[]
{
    const effects: HarnessEffect[] = workspace.rootRules.map((rule) => ({ kind: "Rule", path: rule.path, active: rule.targets.includes(harness),
        reason: rule.targets.length === 0 ? "No targets selected" : rule.targets.includes(harness) ? `Included at priority ${rule.priority}` : "Harness is outside targets" }));
    for (const [layer, options] of Object.entries(workspace.layerOptions))
    {
        const index = selection.findIndex((item) => item.name === layer);
        for (const option of options)
        {
            const selected = index >= 0 && selection[index]!.option === option.name;
            const active = selected && option.targets.includes(harness);
            effects.push({ kind: "Layer option", path: option.path, active,
                reason: index < 0 ? "Layer is disabled" : !selected ? "Another option is selected" : option.targets.length === 0 ? "No targets selected" : !active ? "Harness is outside targets" : `Included at Layer position ${index + 1}${option.body.trim() ? "" : " (empty no-op)"}` });
        }
    }
    for (const agent of workspace.agents)
    {
        const active = Object.hasOwn(agent.harnesses, harness);
        effects.push({ kind: "Agent", path: agent.path, active, reason: active ? "Harness metadata block is present" : "No Harness metadata block" });
    }
    return effects;
}

/** Match all query terms across source identity and body, plus an optional strict Harness filter. */
export function matchesWorkspaceSource(source: { path: string; body: string; name?: string; description?: string; targets?: string[]; harnesses?: Record<string, unknown> }, query: string, harness = ""): boolean
{
    if (harness && !(source.targets?.includes(harness) || source.harnesses && Object.hasOwn(source.harnesses, harness))) return false;
    const content = [source.name ?? "", source.description ?? "", source.path, source.body].join("\n").toLowerCase();
    return query.trim().toLowerCase().split(/\s+/u).filter(Boolean).every((term) => content.includes(term));
}
