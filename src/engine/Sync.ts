/**
 * Bounded source snapshots and conservative three-way sync merging.
 * No networking or deployment: bytes and directory names are the portable source of truth.
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { assertContained, ensureRegularSource, isAtomicWriteTemporary, lstatIfExists } from "./FsSafe.js";
import { assertWindowsSafeName, codePointCompare, HalignError, isRecord } from "./Model.js";
import { assertSkillName } from "./Skills.js";

/** Portable snapshot with base64 file bytes and explicit empty directories. */
export interface SyncSnapshot
{
    version: 1;
    files: Record<string, string>;
    directories: string[];
}

/** Side selected for a conflicting file or complete skill. */
export type SyncChoice = "local" | "remote";

/** A changed file, directory, or skill exposed by the merge planner. */
export interface SyncChange
{
    key: string;
    paths: string[];
    direction: "upload" | "download" | "conflict" | "same";
}

/** Candidate merge and its unresolved conflict keys. */
export interface SyncMerge
{
    snapshot: SyncSnapshot;
    changes: SyncChange[];
    conflicts: string[];
}

/** Limits keep repository input and local recovery records bounded. */
export const SYNC_MAX_FILE_BYTES = 8 * 1024 * 1024;
export const SYNC_MAX_TOTAL_BYTES = 32 * 1024 * 1024;
export const SYNC_MAX_ENTRIES = 5000;
export const SYNC_SOURCE_DIRECTORIES = ["rules", "layers", "agents", "skills"] as const;

/** Create an empty baseline for the first connection. */
export function emptySyncSnapshot(): SyncSnapshot
{
    return { version: 1, files: {}, directories: [] };
}

/** Reject unsafe or out-of-scope portable paths before any filesystem or network work. */
export function assertSyncPath(path: string, directory = false): void
{
    const parts = path.split("/");
    if (path.length > 240 || parts.some((part) => !part || part === "." || part === ".." || part.startsWith(".harness-align-")))
    {
        throw new HalignError(`sync path ${JSON.stringify(path)}: expected a relative source path of at most 240 characters`);
    }
    for (const part of parts) assertWindowsSafeName(part, `sync path ${JSON.stringify(path)}`);
    if ((!directory && path === "config.json") || SYNC_SOURCE_DIRECTORIES.some((name) => directory && path === name || path.startsWith(`${name}/`))) return;
    throw new HalignError(`sync path ${JSON.stringify(path)}: expected config.json or a path under rules, layers, agents, or skills`);
}

/** Normalize a snapshot and reject malformed bytes, casing collisions, and file/directory aliases. */
export function parseSyncSnapshot(value: unknown): SyncSnapshot
{
    if (!isRecord(value) || value.version !== 1 || !isRecord(value.files) || !Array.isArray(value.directories))
    {
        throw new HalignError("sync snapshot: expected version 1, a files mapping, and a directories array");
    }
    if (Object.keys(value.files).length + value.directories.length > SYNC_MAX_ENTRIES) throw new HalignError(`sync snapshot: exceeds ${SYNC_MAX_ENTRIES} entries`);
    const files: Record<string, string> = {};
    const directories = new Set<string>();
    const names = new Map<string, string>();
    let total = 0;
    /** Register one path and its parents while retaining case-sensitive spelling. */
    const register = (path: string, directory: boolean): void =>
    {
        assertSyncPath(path, directory);
        const folded = path.toLowerCase();
        const previous = names.get(folded);
        if (previous && previous !== path) throw new HalignError(`sync path ${path}: conflicts with ${previous} without case sensitivity`);
        names.set(folded, path);
        if (directory) directories.add(path);
        const slash = path.lastIndexOf("/");
        if (slash > 0) register(path.slice(0, slash), true);
    };
    for (const directory of value.directories)
    {
        if (typeof directory !== "string") throw new HalignError("sync directories: expected string paths");
        register(directory, true);
    }
    for (const path of Object.keys(value.files).sort(codePointCompare))
    {
        register(path, false);
        const encoded = value.files[path];
        if (typeof encoded !== "string" || encoded.length > Math.ceil(SYNC_MAX_FILE_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded))
        {
            throw new HalignError(`sync file ${path}: expected canonical base64 containing at most ${SYNC_MAX_FILE_BYTES} bytes`);
        }
        const bytes = Buffer.from(encoded, "base64");
        if (bytes.toString("base64") !== encoded || bytes.length > SYNC_MAX_FILE_BYTES) throw new HalignError(`sync file ${path}: invalid or oversized base64`);
        total += bytes.length;
        if (total > SYNC_MAX_TOTAL_BYTES) throw new HalignError(`sync snapshot: exceeds ${SYNC_MAX_TOTAL_BYTES} bytes`);
        files[path] = encoded;
    }
    for (const path of directories)
    {
        if (Object.hasOwn(files, path)) throw new HalignError(`sync path ${path}: cannot be both a file and a directory`);
    }
    if (Object.keys(files).length + directories.size > SYNC_MAX_ENTRIES) throw new HalignError(`sync snapshot: exceeds ${SYNC_MAX_ENTRIES} entries`);
    return { version: 1, files, directories: [...directories].sort(codePointCompare) };
}

/** Read only the managed source scopes, refusing links and oversized files before reading bytes. */
export async function readSyncSnapshot(root: string): Promise<SyncSnapshot>
{
    const directory = join(root, ".harness-align");
    const snapshot = emptySyncSnapshot();
    let total = 0;
    let entries = 0;
    /** Walk a source scope without following filesystem links. */
    const visit = async (path: string): Promise<void> =>
    {
        const absolute = join(directory, ...path.split("/"));
        assertContained(root, absolute, "sync source");
        await ensureRegularSource(root, absolute);
        const stats = await lstatIfExists(absolute);
        if (!stats) return;
        if (stats.isFile() && isAtomicWriteTemporary(path.split("/").at(-1)!)) return;
        if (++entries > SYNC_MAX_ENTRIES) throw new HalignError(`sync snapshot: exceeds ${SYNC_MAX_ENTRIES} entries`);
        assertSyncPath(path, stats.isDirectory());
        if (stats.isDirectory())
        {
            snapshot.directories.push(path);
            for (const entry of (await fs.readdir(absolute)).sort(codePointCompare)) await visit(`${path}/${entry}`);
        }
        else if (stats.isFile())
        {
            total += stats.size;
            if (stats.size > SYNC_MAX_FILE_BYTES || total > SYNC_MAX_TOTAL_BYTES) throw new HalignError(`sync file ${path}: exceeds the 8 MiB file or 32 MiB workspace limit`);
            snapshot.files[path] = (await fs.readFile(absolute)).toString("base64");
        }
        else throw new HalignError(`sync source ${absolute}: expected a regular file or directory`);
    };
    for (const path of ["config.json", ...SYNC_SOURCE_DIRECTORIES]) await visit(path);
    return parseSyncSnapshot(snapshot);
}

/** Hash normalized bytes and directories to detect stale previews independently of clocks. */
export function syncSnapshotHash(snapshot: SyncSnapshot): string
{
    return createHash("sha256").update(JSON.stringify(parseSyncSnapshot(snapshot))).digest("hex");
}

/** One merge unit includes complete skill content and its provenance record. */
interface SyncUnit
{
    files: Record<string, string>;
    directories: string[];
    provenance?: { id: string; value: unknown };
}

/** Split sources into files and whole skills so provenance cannot drift from installed content. */
function syncUnits(snapshot: SyncSnapshot): Map<string, SyncUnit>
{
    const units = new Map<string, SyncUnit>();
    /** Get one unit without using untrusted names as object prototypes. */
    const unit = (key: string): SyncUnit =>
    {
        if (!units.has(key)) units.set(key, { files: {}, directories: [] });
        return units.get(key)!;
    };
    /** Associate every skill path with its enclosing skill id. */
    const keyFor = (path: string, directory: boolean): string =>
    {
        const parts = path.split("/");
        return (parts[0] === "skills" && parts.length > 1 ? `skills/${parts[1]}` : directory ? `${path}/` : path).toLowerCase();
    };
    for (const [path, bytes] of Object.entries(snapshot.files))
    {
        if (path === "skills/index.json")
        {
            const index: unknown = JSON.parse(Buffer.from(bytes, "base64").toString("utf8"));
            if (!isRecord(index) || !isRecord(index.skills)) throw new HalignError("skills/index.json: expected a skills mapping");
            for (const [id, provenance] of Object.entries(index.skills))
            {
                assertSkillName(id, "sync skills/index.json");
                unit(`skills/${id.toLowerCase()}`).provenance = { id, value: provenance };
            }
        }
        else unit(keyFor(path, false)).files[path] = bytes;
    }
    for (const path of snapshot.directories) unit(keyFor(path, true)).directories.push(path);
    return units;
}

/** Group structural aliases with their descendants so either valid side remains selectable. */
function structuralSyncUnits(snapshots: SyncSnapshot[]): Map<string, SyncUnit>[]
{
    const fileNames = new Set(snapshots.flatMap((snapshot) => Object.keys(snapshot.files).map((path) => path.toLowerCase())));
    const directoryNames = new Map<string, Set<string>>();
    for (const path of snapshots.flatMap((snapshot) => snapshot.directories))
    {
        const folded = path.toLowerCase();
        if (!directoryNames.has(folded)) directoryNames.set(folded, new Set());
        directoryNames.get(folded)!.add(path);
    }
    const collisions = new Set([...directoryNames].filter(([name, spellings]) => fileNames.has(name) || spellings.size > 1).map(([name]) => name));
    return snapshots.map((snapshot) =>
    {
        const units = new Map<string, SyncUnit>();
        for (const [key, value] of syncUnits(snapshot))
        {
            const parts = key.replace(/\/$/u, "").split("/");
            let group = key;
            for (let length = 1; length <= parts.length; length += 1)
            {
                const prefix = parts.slice(0, length).join("/");
                if (collisions.has(prefix))
                {
                    group = `${prefix}/`;
                    break;
                }
            }
            const merged = units.get(group) ?? { files: {}, directories: [] };
            Object.assign(merged.files, value.files);
            merged.directories.push(...value.directories);
            if (value.provenance !== undefined) merged.provenance = value.provenance;
            units.set(group, merged);
        }
        for (const unit of units.values())
        {
            unit.files = Object.fromEntries(Object.entries(unit.files).sort(([a], [b]) => codePointCompare(a, b)));
            unit.directories.sort(codePointCompare);
        }
        return units;
    });
}

/** Restore one remote unit while preserving unrelated local bytes and whole-skill provenance. */
export function restoreSyncChange(base: SyncSnapshot, local: SyncSnapshot, remote: SyncSnapshot, key: string): SyncSnapshot
{
    const [, localUnits, remoteUnits] = structuralSyncUnits([base, local, remote].map((snapshot) => parseSyncSnapshot(snapshot)));
    const here = localUnits!.get(key);
    const there = remoteUnits!.get(key);
    if (!here && !there) throw new HalignError(`sync change ${key}: expected an existing local or remote source group`);
    const result = parseSyncSnapshot(local);
    for (const path of Object.keys(here?.files ?? {})) delete result.files[path];
    Object.assign(result.files, there?.files);
    const removedDirectories = new Set(here?.directories);
    result.directories = result.directories.filter((path) => !removedDirectories.has(path));
    result.directories.push(...there?.directories ?? []);
    if (here?.provenance || there?.provenance)
    {
        const encoded = result.files["skills/index.json"];
        const index: unknown = encoded === undefined ? { skills: {} } : JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
        if (!isRecord(index) || !isRecord(index.skills)) throw new HalignError("skills/index.json: expected a skills mapping");
        if (here?.provenance) delete index.skills[here.provenance.id];
        if (there?.provenance) index.skills[there.provenance.id] = there.provenance.value;
        result.files["skills/index.json"] = Buffer.from(`${JSON.stringify(index, null, 2)}\n`).toString("base64");
    }
    return parseSyncSnapshot(result);
}

/** Merge independent edits, keeping divergent file and skill changes explicit. */
export function mergeSyncSnapshots(base: SyncSnapshot, local: SyncSnapshot, remote: SyncSnapshot, choices: Record<string, SyncChoice> = {}): SyncMerge
{
    const [baseUnits, localUnits, remoteUnits] = structuralSyncUnits([base, local, remote].map((snapshot) => parseSyncSnapshot(snapshot)));
    const keys = [...new Set([...baseUnits!.keys(), ...localUnits!.keys(), ...remoteUnits!.keys()])].sort(codePointCompare);
    const result = emptySyncSnapshot();
    const changes: SyncChange[] = [];
    const conflicts: string[] = [];
    const provenance = new Map<string, unknown>();
    for (const key of keys)
    {
        const [before, here, there] = [baseUnits!, localUnits!, remoteUnits!].map((units) => units.get(key));
        const [b, l, r] = [before, here, there].map((value) => JSON.stringify(value));
        let chosen = here;
        if (l !== b || r !== b)
        {
            const direction = l === r ? "same" : l === b ? "download" : r === b ? "upload" : "conflict";
            const paths = [...new Set([...(here ? Object.keys(here.files) : []), ...(there ? Object.keys(there.files) : []), ...(before ? Object.keys(before.files) : [])])].sort(codePointCompare);
            changes.push({ key, paths, direction });
            if (direction === "download") chosen = there;
            if (direction === "conflict")
            {
                if (!Object.hasOwn(choices, key)) conflicts.push(key);
                if (choices[key] === "remote") chosen = there;
            }
        }
        if (!chosen) continue;
        Object.assign(result.files, chosen.files);
        result.directories.push(...chosen.directories);
        if (chosen.provenance !== undefined) provenance.set(chosen.provenance.id, chosen.provenance.value);
    }
    if (provenance.size || [base, local, remote].some((snapshot) => Object.hasOwn(snapshot.files, "skills/index.json")))
    {
        result.files["skills/index.json"] = Buffer.from(`${JSON.stringify({ skills: Object.fromEntries(provenance) }, null, 2)}\n`).toString("base64");
    }
    // Parent directories are reconstituted when independent additions survive a directory deletion.
    return { snapshot: parseSyncSnapshot(result), changes, conflicts };
}
