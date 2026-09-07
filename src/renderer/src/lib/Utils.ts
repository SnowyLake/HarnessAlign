/** Workspace labels and source paths with Windows-safe collision checks. */

import type { LayerSelection, Workspace } from "@shared/models/Workspace";

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
    if (nextPath !== currentPath && existingPaths.some((path) => path.toLowerCase() === nextPath.toLowerCase())) throw new Error(`${nextPath}: rule already exists`);
    return nextPath;
}

/** Build `.harness-align/agents/<name>.md` from a heading, rejecting separators and collisions. */
export function uniqueAgentPath(currentPath: string | undefined, name: string, existingPaths: readonly string[]): string
{
    const trimmed = name.trim();
    if (!trimmed || trimmed.includes("/") || trimmed.includes("\\")) throw new Error(`Agent name must not contain path separators, got ${name}`);
    const stem = trimmed.toLowerCase().endsWith(".md") ? trimmed.slice(0, -3) : trimmed;
    const nextPath = `.harness-align/agents/${stem}.md`;
    if (nextPath !== currentPath && existingPaths.some((path) => path.toLowerCase() === nextPath.toLowerCase())) throw new Error(`${nextPath}: agent already exists`);
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

/** Move one enabled layer before or after its target in generation order. */
export function moveLayerSelection(selection: readonly LayerSelection[], sourceName: string, targetName: string): LayerSelection[]
{
    const sourceIndex = selection.findIndex((item) => item.name === sourceName);
    const targetIndex = selection.findIndex((item) => item.name === targetName);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return [...selection];
    const next = [...selection];
    const [source] = next.splice(sourceIndex, 1);
    if (!source) return [...selection];
    const nextTargetIndex = next.findIndex((item) => item.name === targetName);
    next.splice(sourceIndex < targetIndex ? nextTargetIndex + 1 : nextTargetIndex, 0, source);
    return next;
}
