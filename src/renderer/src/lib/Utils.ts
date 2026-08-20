import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge class names with Tailwind conflict resolution. */
export function cn(...inputs: ClassValue[]): string
{
    return twMerge(clsx(inputs));
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
    if (nextPath !== currentPath && existingPaths.includes(nextPath)) throw new Error(`${nextPath}: rule already exists`);
    return nextPath;
}
