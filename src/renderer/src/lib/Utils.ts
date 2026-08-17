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
