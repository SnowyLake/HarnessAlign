/**
 * Project skill load, hash, install, import, and zip-entry safety.
 * No network and no unzip library; Electron Main downloads and extracts before calling install helpers.
 */

import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { isAbsolute, join, posix, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { assertContained, assertNoReparseTree, atomicWrite, display, ensureRegularSource, lstatIfExists, reparseError } from "./FsSafe.js";
import {
    codePointCompare,
    errorText,
    FRONTMATTER,
    HalignError,
    hasOwn,
    isRecord,
    type ProjectSkill,
    type SkillOrigin,
    type SkillSource,
    SKILL_NAME,
    SKILL_NAME_MAX,
    type UserSkill,
    valueText,
    WINDOWS_RESERVED_NAMES,
} from "./Model.js";

/** Index provenance persisted in `.halign/skills/index.json`. */
export type SkillIndexEntry =
    | { origin: "github"; owner: string; name: string; branch: string; sourcePath: string; contentHash: string }
    | { origin: "local"; contentHash: string };

/** Parsed skill index keyed by skill id. */
export type SkillIndex = Record<string, SkillIndexEntry>;

/** Return whether any path segment is hidden (dot-prefixed). */
export function hasHiddenSegment(relativePath: string): boolean
{
    return relativePath.split("/").some((part) => part.startsWith("."));
}

/** Validate and normalize a zip entry path; reject absolute, `..`, `\`, NUL, and empty segments. */
export function assertSafeZipEntry(path: string): string
{
    if (!path || path.includes("\0") || path.includes("\\"))
    {
        throw new HalignError(`zip entry path is unsafe, got ${valueText(path)}`);
    }
    if (posix.isAbsolute(path) || /^[A-Za-z]:/u.test(path) || path.startsWith("/") || path.startsWith("//"))
    {
        throw new HalignError(`zip entry path must be relative, got ${valueText(path)}`);
    }
    const parts = path.split("/");
    if (parts.some((part) => !part || part === "." || part === ".."))
    {
        throw new HalignError(`zip entry path is unsafe, got ${valueText(path)}`);
    }
    return parts.join("/");
}

/** Validate a skill directory id against naming and Windows reserved-name rules. */
export function assertSkillName(id: string, context: string): string
{
    if (!id || id.length > SKILL_NAME_MAX || !SKILL_NAME.test(id))
    {
        throw new HalignError(`${context}: skill id must match ${SKILL_NAME.source} and be at most ${SKILL_NAME_MAX} characters, got ${valueText(id)}`);
    }
    if (WINDOWS_RESERVED_NAMES.has(id.toUpperCase()))
    {
        throw new HalignError(`${context}: skill id must not be a Windows reserved name, got ${valueText(id)}`);
    }
    return id;
}

/** Parse a GitHub https repository URL into owner, name, and optional branch. */
export function parseGitHubSkillSource(url: string, branchOverride?: string): SkillSource
{
    let parsed: URL;
    try
    {
        parsed = new URL(url);
    }
    catch
    {
        throw new HalignError(`skill source URL must be a valid https GitHub repository URL, got ${valueText(url)}`);
    }
    if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com" || parsed.username || parsed.password)
    {
        throw new HalignError(`skill source URL must be https://github.com/{owner}/{repo}, got ${valueText(url)}`);
    }
    const segments = parsed.pathname.replace(/\/+$/u, "").split("/").filter(Boolean);
    if (segments.length < 2 || segments[0]!.toLowerCase() === "gist")
    {
        throw new HalignError(`skill source URL must be https://github.com/{owner}/{repo}, got ${valueText(url)}`);
    }
    if (segments.length > 2)
    {
        if (segments.length !== 4 || segments[2]!.toLowerCase() !== "tree")
        {
            throw new HalignError(`skill source URL may only append /tree/{branch}, got ${valueText(url)}`);
        }
    }
    const owner = segments[0]!;
    let name = segments[1]!;
    if (name.endsWith(".git")) name = name.slice(0, -4);
    if (!owner || !name)
    {
        throw new HalignError(`skill source URL must be https://github.com/{owner}/{repo}, got ${valueText(url)}`);
    }
    const branchFromUrl = segments.length === 4 ? decodeURIComponent(segments[3]!) : undefined;
    const branch = (branchOverride?.trim() || branchFromUrl || "main").trim();
    if (!branch || /[\r\n]/.test(branch) || branch.includes("\\") || branch.includes(".."))
    {
        throw new HalignError(`skill source branch must be a single-line git ref, got ${valueText(branch)}`);
    }
    return { owner, name, branch };
}

/** Read lenient SKILL.md frontmatter name/description without reusing rule/agent parsers. */
export function readSkillFrontmatter(text: string): { name?: string; description?: string }
{
    const match = FRONTMATTER.exec(text);
    if (!match) return {};
    let metadata: unknown;
    try
    {
        metadata = parseYaml(match[1] ?? "");
    }
    catch
    {
        return {};
    }
    if (!isRecord(metadata)) return {};
    const result: { name?: string; description?: string } = {};
    if (typeof metadata.name === "string" && metadata.name.trim()) result.name = metadata.name.trim();
    if (typeof metadata.description === "string" && metadata.description.trim()) result.description = metadata.description.trim();
    return result;
}

/** Read SKILL.md title and description from a skill directory. */
async function readSkillMeta(skillDirectory: string, id: string): Promise<{ title: string; description: string }>
{
    const skillFile = join(skillDirectory, "SKILL.md");
    const stats = await lstatIfExists(skillFile);
    if (!stats?.isFile())
    {
        throw new HalignError(`${skillFile}: SKILL.md is required`);
    }
    const text = new TextDecoder("utf-8", { fatal: false }).decode(await fs.readFile(skillFile));
    const meta = readSkillFrontmatter(text);
    return {
        title: meta.name ?? id,
        description: meta.description ?? "",
    };
}

/** Collect non-hidden regular files under a skill directory as `/`-separated relative paths. */
async function listSkillFiles(skillDirectory: string): Promise<string[]>
{
    const files: string[] = [];
    const visit = async (current: string, prefix: string): Promise<void> =>
    {
        const entries = await fs.readdir(current, { withFileTypes: true });
        entries.sort((left, right) => codePointCompare(left.name, right.name));
        for (const entry of entries)
        {
            if (entry.name.startsWith(".")) continue;
            const child = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (hasHiddenSegment(child)) continue;
            const path = join(current, entry.name);
            const stats = await lstatIfExists(path);
            if (!stats) continue;
            if (stats.isSymbolicLink()) throw new HalignError(`${path}: symbolic link skill sources are not allowed`);
            if (stats.isDirectory()) await visit(path, child);
            else if (stats.isFile()) files.push(child);
        }
    };
    await visit(skillDirectory, "");
    return files.sort(codePointCompare);
}

/** SHA-256 hash of non-hidden skill files using path + NUL + bytes + NUL. */
export async function hashSkillDirectory(skillDirectory: string): Promise<string>
{
    const hash = createHash("sha256");
    for (const relative of await listSkillFiles(skillDirectory))
    {
        hash.update(relative);
        hash.update("\0");
        hash.update(await fs.readFile(join(skillDirectory, ...relative.split("/"))));
        hash.update("\0");
    }
    return hash.digest("hex");
}

/** Load and validate `.halign/skills/index.json`, returning an empty index when missing. */
export async function loadSkillIndex(root: string): Promise<SkillIndex>
{
    const path = join(root, ".halign", "skills", "index.json");
    await ensureRegularSource(root, path);
    const stats = await lstatIfExists(path);
    if (!stats) return {};
    if (!stats.isFile()) throw new HalignError(".halign/skills/index.json: expected a file");
    let parsed: unknown;
    try
    {
        parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await fs.readFile(path))) as unknown;
    }
    catch (error)
    {
        throw new HalignError(`.halign/skills/index.json: invalid JSON: ${errorText(error)}`);
    }
    if (!isRecord(parsed) || !hasOwn(parsed, "skills") || !isRecord(parsed.skills))
    {
        throw new HalignError(".halign/skills/index.json: expected a mapping with skills");
    }
    const index: SkillIndex = {};
    for (const [id, entry] of Object.entries(parsed.skills))
    {
        assertSkillName(id, `.halign/skills/index.json: skills.${id}`);
        if (!isRecord(entry) || typeof entry.origin !== "string")
        {
            throw new HalignError(`.halign/skills/index.json: skills.${id} must be a mapping with origin`);
        }
        if (entry.origin === "github")
        {
            for (const field of ["owner", "name", "branch", "sourcePath", "contentHash"])
            {
                if (typeof entry[field] !== "string" || !String(entry[field]).trim())
                {
                    throw new HalignError(`.halign/skills/index.json: skills.${id}.${field} must be a non-empty string`);
                }
            }
            index[id] = {
                origin: "github",
                owner: entry.owner as string,
                name: entry.name as string,
                branch: entry.branch as string,
                sourcePath: entry.sourcePath as string,
                contentHash: entry.contentHash as string,
            };
        }
        else if (entry.origin === "local")
        {
            if (typeof entry.contentHash !== "string" || !entry.contentHash.trim())
            {
                throw new HalignError(`.halign/skills/index.json: skills.${id}.contentHash must be a non-empty string`);
            }
            index[id] = { origin: "local", contentHash: entry.contentHash };
        }
        else
        {
            throw new HalignError(`.halign/skills/index.json: skills.${id}.origin must be github or local, got ${valueText(entry.origin)}`);
        }
    }
    return index;
}

/** Atomically write `.halign/skills/index.json`. */
export async function writeSkillIndex(root: string, index: SkillIndex): Promise<void>
{
    const path = join(root, ".halign", "skills", "index.json");
    await ensureRegularSource(root, path);
    const skills: Record<string, SkillIndexEntry> = {};
    for (const id of Object.keys(index).sort(codePointCompare)) skills[id] = index[id]!;
    await atomicWrite(path, Buffer.from(`${JSON.stringify({ skills }, null, 2)}\n`, "utf8"));
}

/** Convert an index entry into a runtime skill origin. */
function originFromIndex(entry: SkillIndexEntry | undefined): SkillOrigin
{
    if (!entry) return { kind: "unknown" };
    if (entry.origin === "github")
    {
        return {
            kind: "github",
            owner: entry.owner,
            name: entry.name,
            branch: entry.branch,
            sourcePath: entry.sourcePath,
            contentHash: entry.contentHash,
        };
    }
    return { kind: "local", contentHash: entry.contentHash };
}

/** Discover installed project skills under `.halign/skills`. */
export async function loadSkills(root: string): Promise<ProjectSkill[]>
{
    const skillsRoot = join(root, ".halign", "skills");
    await ensureRegularSource(root, skillsRoot);
    const stats = await lstatIfExists(skillsRoot);
    if (!stats) return [];
    if (!stats.isDirectory()) throw new HalignError(".halign/skills: expected a directory");
    const index = await loadSkillIndex(root);
    const entries = await fs.readdir(skillsRoot, { withFileTypes: true });
    entries.sort((left, right) => codePointCompare(left.name, right.name));
    const skills: ProjectSkill[] = [];
    const seen = new Set<string>();
    for (const entry of entries)
    {
        const path = join(skillsRoot, entry.name);
        await ensureRegularSource(root, path);
        const entryStats = await lstatIfExists(path);
        if (!entryStats) continue;
        if (entryStats.isSymbolicLink()) throw reparseError(root, path, false);
        if (entry.name === "index.json")
        {
            if (!entryStats.isFile()) throw new HalignError(".halign/skills/index.json: expected a file");
            continue;
        }
        if (!entryStats.isDirectory())
        {
            throw new HalignError(`${display(root, path)}: skills directory may only contain index.json and skill subdirectories`);
        }
        const id = assertSkillName(entry.name, display(root, path));
        const folded = id.toLowerCase();
        if (seen.has(folded))
        {
            throw new HalignError(`${display(root, path)}: skill ids must be unique without case sensitivity, got ${valueText(id)}`);
        }
        seen.add(folded);
        const skillFile = join(path, "SKILL.md");
        await ensureRegularSource(root, skillFile);
        const skillStats = await lstatIfExists(skillFile);
        if (!skillStats?.isFile())
        {
            throw new HalignError(`${display(root, skillFile)}: SKILL.md is required`);
        }
        const meta = await readSkillMeta(path, id);
        skills.push({ id, title: meta.title, description: meta.description, origin: originFromIndex(index[id]) });
    }
    for (const id of Object.keys(index))
    {
        if (!skills.some((skill) => skill.id === id))
        {
            throw new HalignError(`.halign/skills/index.json: skills.${id} points at a missing skill directory`);
        }
    }
    return skills.sort((left, right) => codePointCompare(left.id, right.id));
}

/** Copy non-hidden skill files from `sourceDir` into a managed skill destination. */
async function copySkillTree(sourceDir: string, destinationDir: string): Promise<void>
{
    if (!(await lstatIfExists(join(sourceDir, "SKILL.md")))?.isFile())
    {
        throw new HalignError(`${sourceDir}: SKILL.md is required`);
    }
    const files = await listSkillFiles(sourceDir);
    await fs.mkdir(destinationDir, { recursive: true });
    for (const relative of files)
    {
        const from = join(sourceDir, ...relative.split("/"));
        const to = join(destinationDir, ...relative.split("/"));
        await fs.mkdir(join(to, ".."), { recursive: true });
        await fs.copyFile(from, to);
    }
    if (!(await lstatIfExists(join(destinationDir, "SKILL.md")))?.isFile())
    {
        throw new HalignError(`${destinationDir}: SKILL.md is required after copy`);
    }
}

/** Install one skill from an already-extracted local directory into `.halign/skills/<id>`, optionally replacing a different origin. */
export async function installSkillFromDirectory(
    rootPath: string,
    id: string,
    sourceDir: string,
    origin: Exclude<SkillOrigin, { kind: "unknown" }>,
    allowOriginChange = false,
): Promise<void>
{
    const root = resolve(rootPath);
    const skillId = assertSkillName(id, `.halign/skills/${id}`);
    const skillsRoot = join(root, ".halign", "skills");
    const destination = join(skillsRoot, skillId);
    assertContained(root, destination, destination);
    await ensureRegularSource(root, destination);
    const sourceStats = await lstatIfExists(sourceDir);
    if (!sourceStats?.isDirectory()) throw new HalignError(`${sourceDir}: expected a skill directory`);
    const skillsRootStats = await lstatIfExists(skillsRoot);
    const existing = skillsRootStats ? await loadSkills(root) : [];
    const collision = existing.find((skill) => skill.id.toLowerCase() === skillId.toLowerCase());
    if (collision && collision.id !== skillId)
    {
        throw new HalignError(`.halign/skills/${skillId}: skill ids must be unique without case sensitivity, got ${valueText(skillId)} after ${valueText(collision.id)}`);
    }
    if (collision && !allowOriginChange)
    {
        const previous = collision.origin;
        if (previous.kind !== "unknown")
        {
            if (previous.kind !== origin.kind)
            {
                throw new HalignError(`.halign/skills/${skillId}: refusing to overwrite a skill from a different origin`);
            }
            if (previous.kind === "github" && origin.kind === "github"
                && (previous.owner.toLowerCase() !== origin.owner.toLowerCase()
                    || previous.name.toLowerCase() !== origin.name.toLowerCase()
                    || previous.sourcePath !== origin.sourcePath))
            {
                throw new HalignError(`.halign/skills/${skillId}: refusing to overwrite a skill from a different GitHub source path`);
            }
        }
    }
    const contentHash = await hashSkillDirectory(sourceDir);
    const index = await loadSkillIndex(root);
    const temporary = join(root, ".halign", `.skill-install-${skillId}-${randomUUID()}`);
    const backup = join(root, ".halign", `.skill-backup-${skillId}-${randomUUID()}`);
    if (await lstatIfExists(temporary)) throw new HalignError(`${display(root, temporary)}: temporary path already exists`);
    await fs.mkdir(join(root, ".halign"), { recursive: true });
    await fs.mkdir(temporary);
    let replaced = false;
    try
    {
        await copySkillTree(sourceDir, temporary);
        await fs.mkdir(skillsRoot, { recursive: true });
        const existingDestination = await lstatIfExists(destination);
        if (existingDestination)
        {
            if (existingDestination.isSymbolicLink()) throw reparseError(root, destination, false);
            if (!existingDestination.isDirectory()) throw new HalignError(`${display(root, destination)}: expected a directory`);
            await assertNoReparseTree(root, destination);
            if (await lstatIfExists(backup)) throw new HalignError(`${display(root, backup)}: temporary path already exists`);
            await fs.rename(destination, backup);
            replaced = true;
        }
        await fs.rename(temporary, destination);
        index[skillId] = origin.kind === "github"
            ? {
                origin: "github",
                owner: origin.owner,
                name: origin.name,
                branch: origin.branch,
                sourcePath: origin.sourcePath,
                contentHash,
            }
            : { origin: "local", contentHash };
        await writeSkillIndex(root, index);
    }
    catch (error)
    {
        const destinationStats = await lstatIfExists(destination);
        if (replaced && destinationStats && await lstatIfExists(backup))
        {
            const failed = join(root, ".halign", `.skill-failed-${skillId}-${randomUUID()}`);
            await fs.rename(destination, failed);
            await fs.rename(backup, destination);
            await fs.rm(failed, { recursive: true, force: true }).catch(() => undefined);
        }
        else if (replaced && !destinationStats && await lstatIfExists(backup))
        {
            await fs.rename(backup, destination);
        }
        await fs.rm(temporary, { recursive: true, force: true }).catch(() => undefined);
        throw error;
    }
    if (replaced) await fs.rm(backup, { recursive: true, force: true });
}

/** Remove one installed project skill directory and its index entry. */
export async function removeSkill(rootPath: string, id: string): Promise<void>
{
    const root = resolve(rootPath);
    const skillId = assertSkillName(id, `.halign/skills/${id}`);
    const destination = join(root, ".halign", "skills", skillId);
    await ensureRegularSource(root, destination);
    const stats = await lstatIfExists(destination);
    if (!stats) throw new HalignError(`.halign/skills/${skillId}: skill does not exist`);
    if (stats.isSymbolicLink()) throw reparseError(root, destination, false);
    if (!stats.isDirectory()) throw new HalignError(`.halign/skills/${skillId}: expected a directory`);
    await assertNoReparseTree(root, destination);
    const index = await loadSkillIndex(root);
    delete index[skillId];
    const temporary = join(root, ".halign", `.remove-skill-${skillId}-${process.pid}`);
    if (await lstatIfExists(temporary)) throw new HalignError(`${display(root, temporary)}: temporary path already exists`);
    await fs.rename(destination, temporary);
    try
    {
        await writeSkillIndex(root, index);
    }
    catch (error)
    {
        await fs.rename(temporary, destination);
        throw error;
    }
    await fs.rm(temporary, { recursive: true, force: true });
}

/** List skills installed under `%USERPROFILE%\.agents\skills`. */
export async function listUserSkills(userProfile = process.env.USERPROFILE): Promise<UserSkill[]>
{
    if (!userProfile || !isAbsolute(userProfile))
    {
        throw new HalignError(`USERPROFILE must be an absolute path, got ${valueText(userProfile)}`);
    }
    const skillsRoot = join(resolve(userProfile), ".agents", "skills");
    const stats = await lstatIfExists(skillsRoot);
    if (!stats) return [];
    if (stats.isSymbolicLink()) throw new HalignError(`${skillsRoot}: symbolic link skill sources are not allowed`);
    if (!stats.isDirectory()) throw new HalignError(`${skillsRoot}: expected a directory`);
    const entries = await fs.readdir(skillsRoot, { withFileTypes: true });
    entries.sort((left, right) => codePointCompare(left.name, right.name));
    const skills: UserSkill[] = [];
    for (const entry of entries)
    {
        if (entry.name.startsWith(".")) continue;
        const id = entry.name;
        if (!SKILL_NAME.test(id) || id.length > SKILL_NAME_MAX || WINDOWS_RESERVED_NAMES.has(id.toUpperCase())) continue;
        const directory = join(skillsRoot, id);
        const directoryStats = await lstatIfExists(directory);
        if (!directoryStats || directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) continue;
        const skillFile = join(directory, "SKILL.md");
        const skillStats = await lstatIfExists(skillFile);
        if (!skillStats?.isFile()) continue;
        const meta = await readSkillMeta(directory, id);
        skills.push({ id, title: meta.title, description: meta.description });
    }
    return skills;
}

/** Import selected user-profile skills into the project skills directory. */
export async function importUserSkills(
    rootPath: string,
    ids: readonly string[],
    overwrite: boolean,
    userProfile = process.env.USERPROFILE,
): Promise<string>
{
    const root = resolve(rootPath);
    if (!userProfile || !isAbsolute(userProfile))
    {
        throw new HalignError(`USERPROFILE must be an absolute path, got ${valueText(userProfile)}`);
    }
    if (ids.length === 0) throw new HalignError("import requires at least one skill id");
    const unique = new Set<string>();
    for (const id of ids)
    {
        const skillId = assertSkillName(id, id);
        const folded = skillId.toLowerCase();
        if (unique.has(folded)) throw new HalignError(`import skill ids must be unique without case sensitivity, got ${valueText(skillId)}`);
        unique.add(folded);
    }
    const existing = await loadSkills(root);
    const profileRoot = join(resolve(userProfile), ".agents", "skills");
    const installed: string[] = [];
    for (const id of ids)
    {
        const skillId = assertSkillName(id, id);
        const source = join(profileRoot, skillId);
        const sourceStats = await lstatIfExists(source);
        if (!sourceStats?.isDirectory()) throw new HalignError(`${source}: skill does not exist`);
        const collision = existing.find((skill) => skill.id.toLowerCase() === skillId.toLowerCase());
        if (collision && !overwrite)
        {
            throw new HalignError(`.halign/skills/${collision.id}: skill already exists; pass overwrite to replace it`);
        }
        await installSkillFromDirectory(root, skillId, source, { kind: "local", contentHash: await hashSkillDirectory(source) }, overwrite);
        installed.push(skillId);
    }
    return `Imported ${installed.length} skill(s):\n${installed.map((id) => `  ${id}`).join("\n")}\n`;
}
