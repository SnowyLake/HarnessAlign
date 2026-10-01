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
import { ensureRegularSource } from "../../engine/FsSafe.js";
import { codePointCompare, errorText, HalignError, isRecord, type SkillOrigin, valueText } from "../../engine/Model.js";
import { parseSyncSnapshot, syncSkillHash, syncSkillIndex, type SyncSnapshot } from "../../engine/Sync.js";
import {
    assertSafeZipEntry,
    assertSkillName,
    assertSkillReplacement,
    installSkillFromDirectory,
    loadSkills,
    listSkillFiles,
    readSkillContent,
    readSkillFrontmatter,
} from "../../engine/Skills.js";
import type { RemoteSkill, SkillUpdate, SkillUpdatePreview } from "../../shared/models/Workspace.js";
import { fetchRemote, readResponseBytes } from "./RemoteFetch.js";

/** Compressed zip size limit (128 MiB). */
const MAX_COMPRESSED_BYTES = 128 * 1024 * 1024;
/** Uncompressed entry count limit. */
const MAX_ZIP_ENTRIES = 10_000;
/** Uncompressed total size limit (512 MiB). */
const MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
/** Fetch timeout for GitHub archive downloads. */
const FETCH_TIMEOUT_MS = 60_000;
/** Maximum SKILL.md body returned to the renderer for preview. */
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;

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
interface CachedSkill extends RemoteSkill
{
    files: Map<string, Uint8Array>;
    contentHash: string;
    commit: string;
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

/** Bounded session cache keyed only by repository and immutable commit. */
const archiveCache = new Map<string, Map<string, Uint8Array>>();
let archiveCacheBytes = 0;

/** Latest reviewed updates bind immutable remote files to installed provenance. */
let updateReview: { root: string; sources: string; items: Array<{ skill: CachedSkill; currentHash: string; currentOrigin: string }> } | undefined;

/** Build the GitHub archive URL for one immutable commit. */
function archiveUrl(owner: string, name: string, commit: string): string
{
    return `https://github.com/${owner}/${name}/archive/${commit}.zip`;
}

/** Download a GitHub branch zip with size and timeout limits. */
async function fetchZip(owner: string, name: string, branch: string, pinnedCommit?: string): Promise<{ files: Map<string, Uint8Array>; commit: string }>
{
    const location = `${owner}/${name}@${pinnedCommit ?? branch}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try
    {
        let commit = pinnedCommit;
        if (commit === undefined)
        {
            const response = await fetchRemote(`https://api.github.com/repos/${owner}/${name}/commits/${encodeURIComponent(branch)}`, {
                signal: controller.signal, headers: { "User-Agent": "HarnessAlign/1.0", Accept: "application/vnd.github+json" }, redirect: "error",
            });
            if (!response.ok)
            {
                await response.body?.cancel();
                throw new ArchiveHttpError(response.status, location);
            }
            const value: unknown = JSON.parse((await readResponseBytes(response, 1024 * 1024, `skill commit ${location}`)).toString("utf8"));
            if (!isRecord(value) || typeof value.sha !== "string" || !/^[a-f0-9]{40}$/u.test(value.sha)) throw new HalignError(`skill commit ${location}: expected a 40-character SHA`);
            commit = value.sha;
        }
        const cacheKey = `${owner.toLowerCase()}/${name.toLowerCase()}@${commit}`;
        const cached = archiveCache.get(cacheKey);
        if (cached)
        {
            archiveCache.delete(cacheKey);
            archiveCache.set(cacheKey, cached);
            return { files: cached, commit };
        }
        const url = archiveUrl(owner, name, commit);
        const response = await fetchRemote(url, {
            signal: controller.signal,
            headers: { "User-Agent": "HarnessAlign/1.0", Accept: "application/zip" },
            redirect: "follow",
        });
        if (!response.ok)
        {
            await response.body?.cancel();
            throw new ArchiveHttpError(response.status, location);
        }
        const files = unzipSkillArchive(await readResponseBytes(response, MAX_COMPRESSED_BYTES, `skill archive ${location}`));
        const size = [...files.values()].reduce((total, data) => total + data.byteLength, 0);
        while ((archiveCacheBytes + size > MAX_UNCOMPRESSED_BYTES || archiveCache.size >= 8) && archiveCache.size > 0)
        {
            const oldest = archiveCache.keys().next().value!;
            archiveCacheBytes -= [...archiveCache.get(oldest)!.values()].reduce((total, data) => total + data.byteLength, 0);
            archiveCache.delete(oldest);
        }
        archiveCache.set(cacheKey, files);
        archiveCacheBytes += size;
        return { files, commit };
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
        const safe = assertSafeZipEntry(rawPath);
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

/** Discover SKILL.md directories inside one extracted repository map. */
function discoverInArchive(
    files: Map<string, Uint8Array>,
    owner: string,
    name: string,
    branch: string,
    commit: string,
): Array<Omit<CachedSkill, "conflict">>
{
    const skillFiles = [...files.keys()].filter((path) => path === "SKILL.md" || path.endsWith("/SKILL.md"));
    skillFiles.sort(codePointCompare);
    const roots = skillFiles.map((skillFile) => (skillFile === "SKILL.md" ? "" : skillFile.slice(0, -"/SKILL.md".length)));
    const skillMaps = new Map(roots.map((root) => [root, new Map<string, Uint8Array>()]));
    for (const [path, data] of files)
    {
        let parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
        for (;;)
        {
            const skillMap = skillMaps.get(parent);
            if (skillMap)
            {
                skillMap.set(parent ? path.slice(parent.length + 1) : path, data);
                break;
            }
            if (!parent) break;
            parent = parent.includes("/") ? parent.slice(0, parent.lastIndexOf("/")) : "";
        }
    }
    return [...skillMaps].map(([sourcePath, skillMap]) =>
    {
        const id = sourcePath ? sourcePath.split("/").at(-1)! : name;
        assertSkillName(id, `${owner}/${name}:${sourcePath || "."}`);
        const meta = readSkillFrontmatter(new TextDecoder().decode(skillMap.get("SKILL.md")));
        return { id, title: meta.name ?? id, description: meta.description ?? "", owner, name, branch, sourcePath, previewId: randomUUID(),
            files: skillMap, contentHash: hashSkillFiles(skillMap), commit };
    });
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
    updateReview = undefined;
    const config = await loadConfig(root);
    const discovered: Array<Omit<CachedSkill, "conflict">> = [];
    for (const source of config.skillSources)
    {
        let branch = source.branch;
        let archive: { files: Map<string, Uint8Array>; commit: string };
        try
        {
            archive = await fetchZip(source.owner, source.name, branch);
        }
        catch (error)
        {
            const canFallback = error instanceof ArchiveHttpError && error.status === 404 && (branch === "main" || branch === "master");
            if (!canFallback) throw error;
            const fallback = branch === "main" ? "master" : "main";
            archive = await fetchZip(source.owner, source.name, fallback);
            branch = fallback;
        }
        discovered.push(...discoverInArchive(archive.files, source.owner, source.name, branch, archive.commit));
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
            previewId: skill.previewId,
            conflict: skill.conflict,
        }))
        .sort((left, right) => codePointCompare(left.id, right.id) || codePointCompare(left.sourcePath, right.sourcePath));
}

/** Resolve one item only from the current workspace's discovery cache. */
async function currentCachedSkill(root: string, previewId: string): Promise<CachedSkill>
{
    const sources = JSON.stringify((await loadConfig(root)).skillSources);
    if (!discoverCache || discoverCache.root !== root || discoverCache.sources !== sources)
    {
        throw new HalignError(`discovered skill preview ${valueText(previewId)} is not in the latest discover results`);
    }
    const skill = discoverCache.skills.find((item) => item.previewId === previewId);
    if (!skill) throw new HalignError(`discovered skill preview ${valueText(previewId)} is not in the latest discover results`);
    return skill;
}

/** Read SKILL.md only from the current validated discovery cache. */
export async function readDiscoveredSkillContent(root: string, previewId: string): Promise<string>
{
    const skill = await currentCachedSkill(root, previewId);
    const content = skill.files.get("SKILL.md");
    if (!content) throw new HalignError(`discovered skill ${skill.id}: SKILL.md is missing from the validated archive`);
    if (content.byteLength > MAX_PREVIEW_BYTES) throw new HalignError(`discovered skill ${skill.id}: SKILL.md exceeds ${MAX_PREVIEW_BYTES} preview bytes`);
    try
    {
        return new TextDecoder("utf-8", { fatal: true }).decode(content);
    }
    catch (error)
    {
        throw new HalignError(`discovered skill ${skill.owner}/${skill.name}/${skill.sourcePath || "."}/SKILL.md: invalid UTF-8: ${errorText(error)}`);
    }
}

/** Install selected cached skills after checking the complete batch. */
async function installCachedSkills(root: string, ids: readonly string[], skills: readonly CachedSkill[]): Promise<string>
{
    if (ids.length === 0) throw new HalignError("install requires at least one skill id");
    const existing = await loadSkills(root);
    const selected: Array<{ skill: CachedSkill; origin: Exclude<SkillOrigin, { kind: "unknown" }> }> = [];
    for (const id of ids)
    {
        const matches = skills.filter((skill) => skill.id === id);
        if (matches.length === 0) throw new HalignError(`skill is not in the latest discover results, got ${valueText(id)}`);
        if (matches.length > 1 || matches[0]!.conflict)
        {
            throw new HalignError(`skill id conflicts across discovered sources, got ${valueText(id)}`);
        }
        const skill = matches[0]!;
        const origin: Exclude<SkillOrigin, { kind: "unknown" }> = {
            kind: "github", owner: skill.owner, name: skill.name, branch: skill.branch, sourcePath: skill.sourcePath, contentHash: skill.contentHash, commit: skill.commit,
        };
        assertSkillReplacement(existing.find((item) => item.id.toLowerCase() === id.toLowerCase()), id, origin);
        selected.push({ skill, origin });
    }
    const installed: string[] = [];
    for (const { skill, origin } of selected)
    {
        const temporary = await materializeSkill(skill);
        try
        {
            await installSkillFromDirectory(root, skill.id, temporary, origin);
            installed.push(skill.id);
        }
        finally
        {
            await fs.rm(temporary, { recursive: true, force: true });
        }
    }
    return `Installed ${installed.length} skill(s):\n${installed.map((id) => `  ${id}`).join("\n")}\n`;
}

/** Install the exact remote item shown by a discovery preview. */
export async function installDiscoveredSkill(root: string, previewId: string): Promise<string>
{
    const skill = await currentCachedSkill(root, previewId);
    return installCachedSkills(root, [skill.id], [skill]);
}

/** Install selected discovered skills into the project. */
export async function installSkills(root: string, ids: readonly string[]): Promise<string>
{
    return installCachedSkills(root, ids, await cachedSkills(root));
}

/** Restore referenced skill bytes in memory, leaving the live workspace untouched on download failure. */
export async function hydrateSyncSkills(snapshot: SyncSnapshot, local: SyncSnapshot): Promise<SyncSnapshot>
{
    const next = parseSyncSnapshot(snapshot);
    const archives = new Map<string, Array<Omit<CachedSkill, "conflict">>>();
    for (const [id, origin] of Object.entries(syncSkillIndex(next)))
    {
        if (origin.origin !== "github" || next.files[`skills/${id}/SKILL.md`] !== undefined) continue;
        const prefix = `skills/${id}/`;
        if (local.files[`${prefix}SKILL.md`] !== undefined && syncSkillHash(local, id) === origin.contentHash)
        {
            for (const [path, bytes] of Object.entries(local.files)) if (path.startsWith(prefix)) next.files[path] = bytes;
            next.directories.push(...local.directories.filter((path) => path === `skills/${id}` || path.startsWith(prefix)));
            continue;
        }
        try
        {
            const key = JSON.stringify([origin.owner, origin.name, origin.branch, origin.commit]);
            let skills = archives.get(key);
            if (!skills)
            {
                const archive = await fetchZip(origin.owner, origin.name, origin.branch, origin.commit);
                skills = discoverInArchive(archive.files, origin.owner, origin.name, origin.branch, archive.commit);
                archives.set(key, skills);
            }
            const skill = skills.find((item) => item.sourcePath === origin.sourcePath);
            if (!skill || skill.contentHash !== origin.contentHash)
            {
                throw new HalignError(`expected sourcePath ${JSON.stringify(origin.sourcePath)} with contentHash ${origin.contentHash}; got ${skill?.contentHash ?? "missing skill"}`);
            }
            for (const [path, bytes] of skill.files) next.files[`${prefix}${path}`] = Buffer.from(bytes).toString("base64");
        }
        catch (error)
        {
            throw new HalignError(`skills/${id}: download pending; local files were preserved. Refresh sync preview to retry. ${errorText(error)}`);
        }
    }
    return parseSyncSnapshot(next);
}

/** Compare installed GitHub skills against rediscovered remote hashes. */
export async function checkSkillUpdates(root: string): Promise<SkillUpdate[]>
{
    const installed = await loadSkills(root);
    await discoverSkills(root);
    const remoteById = new Map((discoverCache?.skills ?? []).filter((skill) => !skill.conflict).map((skill) => [skill.id, skill]));
    const updates: SkillUpdate[] = [];
    const reviewed: NonNullable<typeof updateReview>["items"] = [];
    for (const skill of installed)
    {
        if (skill.origin.kind !== "github") continue;
        const remoteSkill = remoteById.get(skill.id);
        if (!remoteSkill
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
            remoteHash: remoteSkill.contentHash,
            previewId: remoteSkill.previewId,
        });
        reviewed.push({ skill: remoteSkill, currentHash: skill.origin.contentHash, currentOrigin: JSON.stringify(skill.origin) });
    }
    updateReview = { root, sources: JSON.stringify((await loadConfig(root)).skillSources), items: reviewed };
    return updates;
}

/** Inspect actual local files against the immutable version retained by an update check. */
export async function readSkillUpdatePreview(root: string, previewId: string): Promise<SkillUpdatePreview>
{
    if (!updateReview || updateReview.root !== root || updateReview.sources !== JSON.stringify((await loadConfig(root)).skillSources)) throw new HalignError("skill update preview expired; check updates again");
    const item = updateReview.items.find((entry) => entry.skill.previewId === previewId);
    if (!item) throw new HalignError(`skill update preview ${valueText(previewId)} expired; check updates again`);
    const current = (await loadSkills(root)).find((skill) => skill.id === item.skill.id);
    if (!current || current.origin.kind !== "github" || JSON.stringify(current.origin) !== item.currentOrigin) throw new HalignError(`skills/${item.skill.id}: installed provenance changed since review`);
    const directory = join(root, ".harness-align", "skills", current.id);
    await ensureRegularSource(root, directory);
    const local = new Map<string, string>();
    const paths = await listSkillFiles(directory);
    if (paths.length > MAX_ZIP_ENTRIES) throw new HalignError(`${directory}: preview exceeds ${MAX_ZIP_ENTRIES} files`);
    for (const path of paths)
    {
        const absolute = join(directory, ...path.split("/"));
        await ensureRegularSource(root, absolute);
        if ((await fs.stat(absolute)).size > MAX_UNCOMPRESSED_BYTES) throw new HalignError(`${absolute}: preview file exceeds 512 MiB`);
        local.set(path, createHash("sha256").update(await fs.readFile(absolute)).digest("hex"));
    }
    const remote = new Map([...item.skill.files].map(([path, bytes]) => [path, createHash("sha256").update(bytes).digest("hex")]));
    const files: SkillUpdatePreview["files"] = [...new Set([...local.keys(), ...remote.keys()])].sort(codePointCompare).map((path) => ({ path,
        status: !local.has(path) ? "added" : !remote.has(path) ? "deleted" : local.get(path) === remote.get(path) ? "unchanged" : "modified" }));
    const oldText = await readSkillContent(root, current.id);
    const bytes = item.skill.files.get("SKILL.md")!;
    let newText: string;
    try { newText = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch (error) { throw new HalignError(`skills/${current.id}/SKILL.md: invalid remote UTF-8: ${errorText(error)}`); }
    return { previewId, id: current.id, oldCommit: current.origin.commit ?? null, newCommit: item.skill.commit, files,
        oldText: oldText.slice(0, 16_000), newText: newText.slice(0, 16_000), truncated: oldText.length > 16_000 || newText.length > 16_000 };
}

/** Reinstall selected skills that have remote updates. */
export async function applySkillUpdates(root: string, previewIds: readonly string[]): Promise<string>
{
    if (previewIds.length === 0 || new Set(previewIds).size !== previewIds.length) throw new HalignError("update requires unique reviewed preview ids");
    if (!updateReview || updateReview.root !== root || updateReview.sources !== JSON.stringify((await loadConfig(root)).skillSources)) throw new HalignError("skill update preview expired; check updates again before applying");
    const installed = await loadSkills(root);
    const selected: CachedSkill[] = [];
    for (const previewId of previewIds)
    {
        const item = updateReview.items.find((entry) => entry.skill.previewId === previewId);
        if (!item) throw new HalignError(`skill update preview ${valueText(previewId)} expired; check updates again`);
        const current = installed.find((skill) => skill.id === item.skill.id);
        if (!current || current.origin.kind !== "github" || JSON.stringify(current.origin) !== item.currentOrigin
            || current.origin.owner.toLowerCase() !== item.skill.owner.toLowerCase() || current.origin.name.toLowerCase() !== item.skill.name.toLowerCase() || current.origin.sourcePath !== item.skill.sourcePath) throw new HalignError(`skills/${item.skill.id}: installed provenance changed since review; check updates again`);
        if (item.currentHash !== item.skill.contentHash) selected.push(item.skill);
    }
    if (selected.length === 0) return "No skill updates to apply.\n";
    const report = await installCachedSkills(root, selected.map((skill) => skill.id), selected);
    updateReview = undefined;
    return report;
}
