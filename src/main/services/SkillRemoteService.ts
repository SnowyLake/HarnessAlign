/**
 * GitHub skill discovery and install for Electron Main.
 * Downloads zip archives, extracts with fflate in memory, then installs through the engine.
 */

import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { loadConfig } from "../../engine/Load.js";
import { codePointCompare, errorText, HalignError, valueText } from "../../engine/Model.js";
import {
    assertSafeZipEntry,
    assertSkillName,
    installSkillFromDirectory,
    loadSkills,
    readSkillFrontmatter,
} from "../../engine/Skills.js";
import type { RemoteSkill, SkillUpdate } from "../../shared/models/Workspace.js";

/** Compressed zip size limit (128 MiB). */
const MAX_COMPRESSED_BYTES = 128 * 1024 * 1024;
/** Uncompressed entry count limit. */
const MAX_ZIP_ENTRIES = 10_000;
/** Uncompressed total size limit (512 MiB). */
const MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
/** Fetch timeout for GitHub archive downloads. */
const FETCH_TIMEOUT_MS = 60_000;

/** HTTP download failure whose status determines whether a branch fallback is appropriate. */
class ArchiveHttpError extends HalignError
{
    /** Retain the response status without parsing user-facing error text. */
    constructor(readonly status: number, location: string)
    {
        super(`failed to download ${location}: HTTP ${status}`);
    }
}

/** One discovered skill held in the session unzip cache. */
interface CachedSkill
{
    id: string;
    title: string;
    description: string;
    owner: string;
    name: string;
    branch: string;
    sourcePath: string;
    files: Map<string, Uint8Array>;
    contentHash: string;
    conflict: boolean;
}

/** Session cache of the last successful discover for a workspace root. */
interface DiscoverCache
{
    root: string;
    sources: string;
    skills: CachedSkill[];
}

/** Last discover cache used to avoid re-downloading before install. */
let discoverCache: DiscoverCache | undefined;

/** Build the GitHub archive URL for one branch. */
function archiveUrl(owner: string, name: string, branch: string): string
{
    return `https://github.com/${owner}/${name}/archive/refs/heads/${encodeURIComponent(branch)}.zip`;
}

/** Download a GitHub branch zip with size and timeout limits. */
async function fetchZip(owner: string, name: string, branch: string): Promise<Uint8Array>
{
    const url = archiveUrl(owner, name, branch);
    const location = `${owner}/${name}@${branch} (${url})`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try
    {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: { "User-Agent": "HarnessAlign/1.0", Accept: "application/zip" },
            redirect: "follow",
        });
        if (!response.ok)
        {
            await response.body?.cancel();
            throw new ArchiveHttpError(response.status, location);
        }
        const lengthHeader = response.headers.get("content-length");
        if (lengthHeader && Number(lengthHeader) > MAX_COMPRESSED_BYTES)
        {
            throw new HalignError(`skill archive exceeds ${MAX_COMPRESSED_BYTES} compressed bytes`);
        }
        if (!response.body)
        {
            throw new HalignError(`failed to download ${owner}/${name}@${branch}: empty response body`);
        }
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;
        while (true)
        {
            const { done, value } = await reader.read();
            if (done || value === undefined) break;
            received += value.byteLength;
            if (received > MAX_COMPRESSED_BYTES)
            {
                await reader.cancel();
                throw new HalignError(`skill archive exceeds ${MAX_COMPRESSED_BYTES} compressed bytes`);
            }
            chunks.push(value);
        }
        const buffer = new Uint8Array(received);
        let offset = 0;
        for (const chunk of chunks)
        {
            buffer.set(chunk, offset);
            offset += chunk.byteLength;
        }
        return buffer;
    }
    catch (error)
    {
        if (error instanceof HalignError) throw error;
        if (controller.signal.aborted) throw new HalignError(`failed to download ${location}: timed out after ${FETCH_TIMEOUT_MS / 1000}s; check GitHub connectivity and proxy settings`);
        const cause = error instanceof Error ? error.cause : undefined;
        const detail = cause instanceof Error ? `: ${cause.message}${"code" in cause ? ` (${String(cause.code)})` : ""}` : "";
        throw new HalignError(`failed to download ${location}: ${errorText(error)}${detail}`);
    }
    finally
    {
        clearTimeout(timer);
    }
}

/** Unzip archive bytes into a validated relative-path map, stripping the first directory only. */
function unzipSkillArchive(bytes: Uint8Array): Map<string, Uint8Array>
{
    let entries = 0;
    let listedUncompressed = 0;
    let unzipped: Record<string, Uint8Array>;
    try
    {
        unzipped = unzipSync(bytes, {
            filter(file)
            {
                entries += 1;
                if (entries > MAX_ZIP_ENTRIES)
                {
                    throw new HalignError(`skill archive exceeds ${MAX_ZIP_ENTRIES} entries`);
                }
                listedUncompressed += file.originalSize;
                if (listedUncompressed > MAX_UNCOMPRESSED_BYTES)
                {
                    throw new HalignError(`skill archive exceeds ${MAX_UNCOMPRESSED_BYTES} uncompressed bytes`);
                }
                return true;
            },
        });
    }
    catch (error)
    {
        if (error instanceof HalignError) throw error;
        throw new HalignError(`invalid skill archive: ${errorText(error)}`);
    }
    const normalized = new Map<string, Uint8Array>();
    let uncompressed = 0;
    for (const [rawPath, data] of Object.entries(unzipped))
    {
        if (rawPath.endsWith("/")) continue;
        uncompressed += data.byteLength;
        if (uncompressed > MAX_UNCOMPRESSED_BYTES)
        {
            throw new HalignError(`skill archive exceeds ${MAX_UNCOMPRESSED_BYTES} uncompressed bytes`);
        }
        const safe = assertSafeZipEntry(rawPath.replace(/\\/gu, "/"));
        const slash = safe.indexOf("/");
        if (slash <= 0) continue;
        const relative = assertSafeZipEntry(safe.slice(slash + 1));
        if (relative.split("/").some((part) => part.startsWith("."))) continue;
        normalized.set(relative, data);
    }
    return normalized;
}

/** Hash skill files from an in-memory map. */
function hashSkillFiles(files: Map<string, Uint8Array>): string
{
    const hash = createHash("sha256");
    for (const path of [...files.keys()].sort(codePointCompare))
    {
        hash.update(path);
        hash.update("\0");
        hash.update(files.get(path)!);
        hash.update("\0");
    }
    return hash.digest("hex");
}

/** Return whether `path` belongs to `sourcePath` and not a nested skill root. */
function belongsToSkillRoot(path: string, sourcePath: string, roots: readonly string[]): boolean
{
    if (sourcePath === "")
    {
        return !roots.some((root) => root !== "" && (path === `${root}/SKILL.md` || path.startsWith(`${root}/`)));
    }
    if (path !== `${sourcePath}/SKILL.md` && !path.startsWith(`${sourcePath}/`)) return false;
    return !roots.some((root) => root !== sourcePath
        && root.startsWith(`${sourcePath}/`)
        && (path === `${root}/SKILL.md` || path.startsWith(`${root}/`)));
}

/** Discover SKILL.md directories inside one extracted repository map. */
function discoverInArchive(
    files: Map<string, Uint8Array>,
    owner: string,
    name: string,
    branch: string,
): Array<Omit<CachedSkill, "conflict">>
{
    const skillFiles = [...files.keys()].filter((path) => path === "SKILL.md" || path.endsWith("/SKILL.md"));
    skillFiles.sort(codePointCompare);
    const roots = skillFiles.map((skillFile) => (skillFile === "SKILL.md" ? "" : skillFile.slice(0, -"/SKILL.md".length)));
    const discovered: Array<Omit<CachedSkill, "conflict">> = [];
    for (const sourcePath of roots)
    {
        const id = sourcePath ? sourcePath.split("/").at(-1)! : name;
        assertSkillName(id, `${owner}/${name}:${sourcePath || "."}`);
        const skillMap = new Map<string, Uint8Array>();
        for (const [path, data] of files)
        {
            if (!belongsToSkillRoot(path, sourcePath, roots)) continue;
            const relative = sourcePath === "" ? path : path.slice(sourcePath.length + 1);
            skillMap.set(relative, data);
        }
        if (!skillMap.has("SKILL.md")) continue;
        const text = new TextDecoder("utf-8", { fatal: false }).decode(skillMap.get("SKILL.md"));
        const meta = readSkillFrontmatter(text);
        discovered.push({
            id,
            title: meta.name ?? id,
            description: meta.description ?? "",
            owner,
            name,
            branch,
            sourcePath,
            files: skillMap,
            contentHash: hashSkillFiles(skillMap),
        });
    }
    return discovered;
}

/** Mark leaf-id conflicts across every discovered skill. */
function withConflicts(skills: Array<Omit<CachedSkill, "conflict">>): CachedSkill[]
{
    const counts = new Map<string, number>();
    for (const skill of skills)
    {
        const folded = skill.id.toLowerCase();
        counts.set(folded, (counts.get(folded) ?? 0) + 1);
    }
    return skills.map((skill) => ({ ...skill, conflict: (counts.get(skill.id.toLowerCase()) ?? 0) > 1 }));
}

/** Write one cached skill to a temporary directory for engine install. */
async function materializeSkill(skill: CachedSkill): Promise<string>
{
    const directory = join(tmpdir(), `halign-skill-${skill.id}-${randomUUID()}`);
    await fs.mkdir(directory);
    try
    {
        for (const [relative, data] of skill.files)
        {
            const target = join(directory, ...relative.split("/"));
            await fs.mkdir(join(target, ".."), { recursive: true });
            await fs.writeFile(target, data);
        }
        return directory;
    }
    catch (error)
    {
        await fs.rm(directory, { recursive: true, force: true });
        throw error;
    }
}

/** Resolve cached skills for a root, discovering first when the cache is cold. */
async function cachedSkills(root: string): Promise<CachedSkill[]>
{
    const sources = JSON.stringify((await loadConfig(root)).skillSources);
    if (!discoverCache || discoverCache.root !== root || discoverCache.sources !== sources) await discoverSkills(root);
    return discoverCache?.root === root ? discoverCache.skills : [];
}

/** Discover remote skills for every configured skill source. */
export async function discoverSkills(root: string): Promise<RemoteSkill[]>
{
    const config = await loadConfig(root);
    const discovered: Array<Omit<CachedSkill, "conflict">> = [];
    for (const source of config.skillSources)
    {
        let branch = source.branch;
        let bytes: Uint8Array;
        try
        {
            bytes = await fetchZip(source.owner, source.name, branch);
        }
        catch (error)
        {
            const canFallback = error instanceof ArchiveHttpError && error.status === 404 && (branch === "main" || branch === "master");
            if (!canFallback) throw error;
            const fallback = branch === "main" ? "master" : "main";
            bytes = await fetchZip(source.owner, source.name, fallback);
            branch = fallback;
        }
        discovered.push(...discoverInArchive(unzipSkillArchive(bytes), source.owner, source.name, branch));
    }
    const skills = withConflicts(discovered);
    discoverCache = { root, sources: JSON.stringify(config.skillSources), skills };
    return skills
        .map((skill) => ({
            id: skill.id,
            title: skill.title,
            description: skill.description,
            owner: skill.owner,
            name: skill.name,
            branch: skill.branch,
            sourcePath: skill.sourcePath,
            conflict: skill.conflict,
        }))
        .sort((left, right) => codePointCompare(left.id, right.id) || codePointCompare(left.sourcePath, right.sourcePath));
}

/** Install selected discovered skills into the project. */
export async function installSkills(root: string, ids: readonly string[]): Promise<string>
{
    if (ids.length === 0) throw new HalignError("install requires at least one skill id");
    const skills = await cachedSkills(root);
    const selected: CachedSkill[] = [];
    for (const id of ids)
    {
        const matches = skills.filter((skill) => skill.id === id);
        if (matches.length === 0) throw new HalignError(`skill is not in the latest discover results, got ${valueText(id)}`);
        if (matches.length > 1 || matches[0]!.conflict)
        {
            throw new HalignError(`skill id conflicts across discovered sources, got ${valueText(id)}`);
        }
        selected.push(matches[0]!);
    }
    const installed: string[] = [];
    for (const skill of selected)
    {
        const temporary = await materializeSkill(skill);
        try
        {
            await installSkillFromDirectory(root, skill.id, temporary, {
                kind: "github",
                owner: skill.owner,
                name: skill.name,
                branch: skill.branch,
                sourcePath: skill.sourcePath,
                contentHash: skill.contentHash,
            });
            installed.push(skill.id);
        }
        finally
        {
            await fs.rm(temporary, { recursive: true, force: true });
        }
    }
    return `Installed ${installed.length} skill(s):\n${installed.map((id) => `  ${id}`).join("\n")}\n`;
}

/** Compare installed GitHub skills against rediscovered remote hashes. */
export async function checkSkillUpdates(root: string): Promise<SkillUpdate[]>
{
    const installed = await loadSkills(root);
    const remote = await discoverSkills(root);
    const remoteById = new Map(remote.filter((skill) => !skill.conflict).map((skill) => [skill.id, skill]));
    const cache = new Map((discoverCache?.skills ?? []).map((skill) => [skill.id, skill]));
    const updates: SkillUpdate[] = [];
    for (const skill of installed)
    {
        if (skill.origin.kind !== "github") continue;
        const remoteSkill = remoteById.get(skill.id);
        const cached = cache.get(skill.id);
        if (!remoteSkill || !cached
            || remoteSkill.owner.toLowerCase() !== skill.origin.owner.toLowerCase()
            || remoteSkill.name.toLowerCase() !== skill.origin.name.toLowerCase()
            || remoteSkill.sourcePath !== skill.origin.sourcePath)
        {
            updates.push({
                id: skill.id,
                currentHash: skill.origin.contentHash,
                remoteHash: "",
                error: `remote skill ${skill.id} was not found in configured sources`,
            });
            continue;
        }
        updates.push({
            id: skill.id,
            currentHash: skill.origin.contentHash,
            remoteHash: cached.contentHash,
        });
    }
    return updates;
}

/** Reinstall selected skills that have remote updates. */
export async function applySkillUpdates(root: string, ids: readonly string[]): Promise<string>
{
    if (ids.length === 0) throw new HalignError("update requires at least one skill id");
    const updates = await checkSkillUpdates(root);
    const wanted = new Set(ids);
    const outdated = updates.filter((update) => wanted.has(update.id) && !update.error && update.currentHash !== update.remoteHash);
    const missing = ids.filter((id) => !updates.some((update) => update.id === id));
    if (missing.length > 0) throw new HalignError(`unknown installed skill id ${valueText(missing[0])}`);
    const errored = updates.find((update) => wanted.has(update.id) && update.error);
    if (errored) throw new HalignError(errored.error!);
    if (outdated.length === 0) return "No skill updates to apply.\n";
    return installSkills(root, outdated.map((update) => update.id));
}
