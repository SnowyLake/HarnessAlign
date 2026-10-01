/**
 * Deploy generated harness files into existing USERPROFILE roots, shared-rules, and skills.
 * Missing harness roots are skipped. Opening a harness folder uses the same existing-root checks.
 */

import { promises as fs } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { atomicWrite, ensureRegularSource, lstatIfExists, pathKey, resolveUserHome } from "./FsSafe.js";
import { buildOutputs, generate } from "./Generate.js";
import { loadConfig } from "./Load.js";
import { type Harness, type LayerSelection, type OutputMap, assertWindowsSafeName, codePointCompare, errorText, HalignError, isRecord, valueText } from "./Model.js";
import { copySkillTree, loadSkills } from "./Skills.js";

/** Resolve `path` and throw if it escapes `root`. */
function assertContainedWithin(root: string, path: string, label: string): string
{
    const rootFull = resolve(root);
    const pathFull = resolve(path);
    const pathRelative = relative(rootFull, pathFull);
    if (!pathRelative || pathRelative === ".." || pathRelative.startsWith(`..${sep}`) || isAbsolute(pathRelative))
    {
        throw new HalignError(`${label}: path ${valueText(path)} must stay inside ${valueText(rootFull)}, got relative ${valueText(pathRelative)}`);
    }
    return pathFull;
}

/** Build the domain error used when a deploy target is a reparse point. */
function deploymentReparseError(label: string, path: string): HalignError
{
    return new HalignError(`${label}: reparse points are not allowed: ${path}`);
}

/** Walk every path prefix under `root` and reject reparse points. */
async function assertNoReparseComponents(root: string, path: string, label: string): Promise<string>
{
    const rootFull = resolve(root);
    const pathFull = assertContainedWithin(rootFull, path, label);
    const rootStats = await lstatIfExists(rootFull);
    if (!rootStats || !rootStats.isDirectory()) throw new HalignError(`${label}: allowed root must be an existing directory: ${rootFull}`);
    if (rootStats.isSymbolicLink()) throw deploymentReparseError(label, rootFull);
    let current = rootFull;
    for (const part of relative(rootFull, pathFull).split(sep).filter(Boolean))
    {
        current = join(current, part);
        const stats = await lstatIfExists(current);
        if (!stats) break;
        if (stats.isSymbolicLink()) throw deploymentReparseError(label, current);
    }
    return pathFull;
}

/** Require an existing regular directory. */
async function assertRegularDirectory(path: string, label: string): Promise<void>
{
    const stats = await lstatIfExists(path);
    if (!stats) throw new HalignError(`${label}: directory does not exist: ${path}`);
    if (stats.isSymbolicLink()) throw deploymentReparseError(label, path);
    if (!stats.isDirectory()) throw new HalignError(`${label}: expected a directory: ${path}`);
}

/** Require a regular file when the path exists. */
async function assertRegularFileIfPresent(path: string, label: string): Promise<void>
{
    const stats = await lstatIfExists(path);
    if (!stats) return;
    if (stats.isSymbolicLink()) throw deploymentReparseError(label, path);
    if (!stats.isFile()) throw new HalignError(`${label}: expected a file: ${path}`);
}

/** Recursively reject reparse points under a deploy directory. */
async function assertNoReparseTree(path: string, label: string): Promise<void>
{
    const stats = await lstatIfExists(path);
    if (!stats) throw new HalignError(`${label}: path does not exist: ${path}`);
    if (stats.isSymbolicLink()) throw deploymentReparseError(label, path);
    if (!stats.isDirectory()) return;
    const entries = await fs.readdir(path, { withFileTypes: true });
    for (const entry of entries)
    {
        await assertNoReparseTree(join(path, entry.name), label);
    }
}

/** Delete a staged deployment path only after containment and reparse checks. */
async function removeDeploymentPath(userProfile: string, path: string): Promise<void>
{
    const target = await assertNoReparseComponents(userProfile, path, "deployment cleanup");
    const stats = await lstatIfExists(target);
    if (!stats) return;
    await assertNoReparseTree(target, "deployment cleanup");
    await fs.rm(target, { recursive: true, force: true });
}

/** One persisted replacement guarded by exact contents across interrupted renames. */
interface DeploymentEntry
{
    target: string;
    temporary: string;
    backup: string;
    before: Record<string, string>;
    after: Record<string, string>;
    progress: "pending" | "prepared" | "backed-up" | "installed" | "restored";
}

/** Durable progress whose paths never select a user profile during recovery. */
interface DeploymentJournal
{
    version: 1;
    userProfile: string;
    phase: "staging" | "applying" | "committed";
    entries: DeploymentEntry[];
    baselineBefore: string | null;
    baselineAfter: string;
}

/** Compare exact tree contents independently of object insertion order. */
function sameTree(left: Record<string, string>, right: Record<string, string>): boolean
{
    return JSON.stringify(Object.entries(left).sort()) === JSON.stringify(Object.entries(right).sort());
}

/** Persist only our previous recovery record, refusing a concurrent replacement. */
async function persistDeploymentJournal(root: string, journal: DeploymentJournal, expected: Buffer | null): Promise<Buffer>
{
    const path = join(root, ".harness-align", ".deployment-recovery.json");
    await ensureRegularSource(root, path);
    await assertRegularFileIfPresent(path, "deployment recovery");
    const actual = await lstatIfExists(path) ? await fs.readFile(path) : null;
    if ((actual === null) !== (expected === null) || (actual && expected && !actual.equals(expected))) throw new HalignError(`${path}: recovery record changed; preserve it and retry recovery`);
    const content = Buffer.from(`${JSON.stringify(journal, null, 2)}\n`);
    await atomicWrite(path, content);
    return content;
}

/** Stage and record replacements before swapping, retaining backups until finalization. */
async function deployReplacements(root: string, userProfile: string, replacements: Array<{ target: string; populate: (path: string) => Promise<void> }>, desired: Record<string, string>[], nextBaseline: DeploymentBaseline, recheck: () => Promise<void>): Promise<void>
{
    const baselinePath = join(root, ".harness-align", ".deployment.json");
    await ensureRegularSource(root, baselinePath);
    const before = await lstatIfExists(baselinePath) ? await fs.readFile(baselinePath) : null;
    const journal: DeploymentJournal = { version: 1, userProfile, phase: "staging", entries: [], baselineBefore: before?.toString("base64") ?? null,
        baselineAfter: Buffer.from(`${JSON.stringify(nextBaseline, null, 2)}\n`).toString("base64") };
    for (const [index, replacement] of replacements.entries())
    {
        const target = await assertNoReparseComponents(userProfile, replacement.target, "deployment target");
        const parent = dirname(target);
        journal.entries.push({ target: relative(userProfile, target).split(sep).join("/"),
            temporary: relative(userProfile, join(parent, `.harness-align-stage-${randomUUID()}`)).split(sep).join("/"),
            backup: relative(userProfile, join(parent, `.harness-align-backup-${randomUUID()}`)).split(sep).join("/"),
            before: await snapshotTree(userProfile, target), after: desired[index]!, progress: "pending" });
    }
    let record = await persistDeploymentJournal(root, journal, null);
    try
    {
        for (const [index, entry] of journal.entries.entries())
        {
            const temporary = join(userProfile, ...entry.temporary.split("/"));
            await assertNoReparseComponents(userProfile, temporary, "deployment stage");
            await fs.mkdir(dirname(temporary), { recursive: true });
            await assertNoReparseComponents(userProfile, temporary, "deployment stage");
            await replacements[index]!.populate(temporary);
            if (!sameTree(await snapshotTree(userProfile, temporary), entry.after)) throw new HalignError(`${entry.target}: staged content differs from the reviewed source; preview again before deploying`);
            entry.progress = "prepared";
            record = await persistDeploymentJournal(root, journal, record);
        }
        await recheck();
        journal.phase = "applying";
        record = await persistDeploymentJournal(root, journal, record);
        for (const entry of journal.entries)
        {
            const target = join(userProfile, ...entry.target.split("/"));
            const backup = join(userProfile, ...entry.backup.split("/"));
            const temporary = join(userProfile, ...entry.temporary.split("/"));
            if (!sameTree(await snapshotTree(userProfile, target), entry.before)) throw new HalignError(`${target}: target changed before replacement; preserve deployment recovery`);
            await assertNoReparseComponents(userProfile, backup, "deployment backup");
            if (await lstatIfExists(backup)) throw new HalignError(`${backup}: backup destination already exists; preserve deployment recovery`);
            if (await lstatIfExists(target)) await fs.rename(target, backup);
            entry.progress = "backed-up";
            record = await persistDeploymentJournal(root, journal, record);
            await fs.rename(temporary, target);
            entry.progress = "installed";
            record = await persistDeploymentJournal(root, journal, record);
        }
        journal.phase = "committed";
        await persistDeploymentJournal(root, journal, record);
        await recoverDeployment(root, userProfile);
    }
    catch (error)
    {
        try { if (await recoverDeployment(root, userProfile) === "completed") return; }
        catch (recoveryError) { throw new HalignError(`Setup failed: ${errorText(error)}; recovery preserved at ${join(root, ".harness-align", ".deployment-recovery.json")}: ${errorText(recoveryError)}`); }
        throw error;
    }
}

/** Resolved source and target paths for one harness deploy. */
interface SetupInstallation
{
    agents: Array<[string, Buffer]>;
    rules: Buffer;
    targetAgents: string;
    targetRules: string;
}

/** Per-harness deploy result used in the setup report. */
export interface SetupTargetReport
{
    harness: Harness;
    root: string;
    skipped: boolean;
    files: string[];
}

/** Skills deploy result used in the setup report. */
export interface SetupSkillsReport
{
    target: string;
    skipped: boolean;
    ids: string[];
}

/** Outcome of generating and deploying into existing harness roots. */
export interface SetupResult
{
    outputs: OutputMap;
    generatedRoot: string;
    targets: SetupTargetReport[];
    sharedRules: { target: string; files: string[] };
    skills: SetupSkillsReport;
}

/** One file or directory whose deployment outcome can be reviewed before writing. */
export interface SetupChange
{
    path: string;
    status: "added" | "modified" | "deleted" | "unchanged" | "skipped";
    external?: string;
}

/** Exact snapshots from successful deployments, separate from generated output and sync archives. */
interface DeploymentBaseline
{
    version: 1;
    scopes: Record<string, Record<string, string>>;
}

/** Decode only canonical base64 bytes from a recovery record. */
function recoveryBytes(value: unknown, label: string): Buffer
{
    if (typeof value !== "string" || Buffer.from(value, "base64").toString("base64") !== value) throw new HalignError(`${label}: expected canonical base64 content`);
    return Buffer.from(value, "base64");
}

/** Parse hash snapshots without treating arbitrary record fields as filesystem paths. */
function deploymentTree(value: unknown, label: string): Record<string, string>
{
    if (!isRecord(value)) throw new HalignError(`${label}: expected a content hash mapping`);
    const entries: Array<[string, string]> = [];
    for (const [name, hash] of Object.entries(value))
    {
        if (typeof hash !== "string" || (hash !== "directory" && !/^[a-f0-9]{64}$/u.test(hash)) || (name !== "." && (name.includes("\\") || name.split("/").some((part) => !part || part === "." || part === "..")))) throw new HalignError(`${label}: invalid path ${valueText(name)} or hash ${valueText(hash)}`);
        entries.push([name, hash]);
    }
    if (entries.length > 0 && !Object.hasOwn(value, ".")) throw new HalignError(`${label}: nonempty snapshot must contain its root`);
    return Object.fromEntries(entries);
}

/** Require a canonical relative user path before checking its authorized replacement scope. */
function deploymentRelative(value: unknown, label: string): string
{
    if (typeof value !== "string" || !value || value.includes("\\") || value.split("/").some((part) => !part || part === "." || part === "..")) throw new HalignError(`${label}: expected a relative deployment path, got ${valueText(value)}`);
    for (const part of value.split("/")) assertWindowsSafeName(part, label);
    return value;
}

/** Parse recovery data only within currently declared harness and installed skill scopes. */
async function deploymentJournal(root: string, home: string, value: unknown, label: string): Promise<DeploymentJournal>
{
    if (!isRecord(value) || value.version !== 1 || typeof value.userProfile !== "string" || pathKey(value.userProfile) !== pathKey(home)
        || !["staging", "applying", "committed"].includes(String(value.phase)) || !Array.isArray(value.entries) || value.entries.length === 0 || value.entries.length > 5000) throw new HalignError(`${label}: expected version 1, current USERPROFILE ${home}, valid phase and bounded entries`);
    const config = await loadConfig(root);
    const allowed = new Set([...config.harnesses.flatMap((harness) => [`${harness.configPath}/agents`, `${harness.configPath}/AGENTS.md`]), ".agents/shared-rules",
        ...(await loadSkills(root)).map((skill) => `.agents/skills/${skill.id}`)]);
    const identities = new Set<string>();
    const entries: DeploymentEntry[] = [];
    for (const item of value.entries)
    {
        if (!isRecord(item)) throw new HalignError(`${label}: expected a replacement record`);
        const target = deploymentRelative(item.target, label);
        const temporary = deploymentRelative(item.temporary, label);
        const backup = deploymentRelative(item.backup, label);
        if (!allowed.has(target) || dirname(target) !== dirname(temporary) || dirname(target) !== dirname(backup)
            || !/^\.harness-align-stage-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u.test(basename(temporary))
            || !/^\.harness-align-backup-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u.test(basename(backup))) throw new HalignError(`${label}: target ${target} or stage/backup paths are outside the declared deployment scopes`);
        for (const name of [target, temporary, backup])
        {
            const path = assertContainedWithin(home, join(home, ...name.split("/")), label);
            if (identities.has(pathKey(path))) throw new HalignError(`${label}: duplicate deployment path ${path}`);
            identities.add(pathKey(path));
        }
        const progress = item.progress;
        if (progress !== "pending" && progress !== "prepared" && progress !== "backed-up" && progress !== "installed" && progress !== "restored") throw new HalignError(`${label}: invalid progress ${valueText(progress)}`);
        const before = deploymentTree(item.before, `${label} ${target} before`);
        const after = deploymentTree(item.after, `${label} ${target} after`);
        const isFile = target.endsWith("/AGENTS.md");
        for (const [name, tree] of [["before", before], ["after", after]] as const)
        {
            if (name === "before" && Object.keys(tree).length === 0) continue;
            if (isFile ? Object.keys(tree).length !== 1 || !/^[a-f0-9]{64}$/u.test(tree["."] ?? "") : tree["."] !== "directory") throw new HalignError(`${label}: ${target} ${name} must describe a ${isFile ? "regular file" : "directory"}`);
        }
        entries.push({ target, temporary, backup, before, after, progress });
    }
    const baselineBefore = value.baselineBefore === null ? null : recoveryBytes(value.baselineBefore, label).toString("base64");
    const baselineAfter = recoveryBytes(value.baselineAfter, label).toString("base64");
    let baseline: unknown;
    try { baseline = JSON.parse(Buffer.from(baselineAfter, "base64").toString("utf8")); }
    catch (error) { throw new HalignError(`${label}: invalid deployment baseline: ${errorText(error)}`); }
    if (!isRecord(baseline) || baseline.version !== 1 || !isRecord(baseline.scopes)) throw new HalignError(`${label}: expected a version 1 deployment baseline`);
    for (const [scope, tree] of Object.entries(baseline.scopes))
    {
        deploymentRelative(scope, label);
        deploymentTree(tree, label);
    }
    const phase = value.phase;
    if (phase !== "staging" && phase !== "applying" && phase !== "committed") throw new HalignError(`${label}: invalid recovery phase`);
    return { version: 1, userProfile: home, entries, phase, baselineBefore, baselineAfter };
}

/** Recover a pending deployment only when every target, stage, backup, and baseline still belongs to it. */
export async function recoverDeployment(rootPath: string, userProfile = process.env.USERPROFILE): Promise<"none" | "restored" | "completed">
{
    const root = resolve(rootPath);
    const recordPath = join(root, ".harness-align", ".deployment-recovery.json");
    await ensureRegularSource(root, recordPath);
    const stats = await lstatIfExists(recordPath);
    if (!stats) return "none";
    if (!stats.isFile() || stats.size > 32 * 1024 * 1024) throw new HalignError(`${recordPath}: expected a regular recovery record no larger than 32 MiB`);
    let record: Buffer = await fs.readFile(recordPath);
    let value: unknown;
    try { value = JSON.parse(record.toString("utf8")); }
    catch (error) { throw new HalignError(`${recordPath}: invalid recovery JSON: ${errorText(error)}`); }
    const home = resolveUserHome(userProfile);
    const journal = await deploymentJournal(root, home, value, recordPath);
    const baselinePath = join(root, ".harness-align", ".deployment.json");
    await ensureRegularSource(root, baselinePath);
    await assertRegularFileIfPresent(baselinePath, "deployment baseline recovery");
    const baseline = await lstatIfExists(baselinePath) ? (await fs.readFile(baselinePath)).toString("base64") : null;
    if (baseline !== journal.baselineBefore && baseline !== journal.baselineAfter) throw new HalignError(`${baselinePath}: changed outside the pending deployment; preserve ${recordPath}`);
    /** Check one complete replacement before any cleanup or restoration. */
    const inspect = async (entry: DeploymentEntry) =>
    {
        const target = await snapshotTree(home, join(home, ...entry.target.split("/")));
        const backup = await snapshotTree(home, join(home, ...entry.backup.split("/")));
        const temporary = await snapshotTree(home, join(home, ...entry.temporary.split("/")));
        const hasBackup = Object.keys(backup).length > 0;
        const hasTarget = Object.keys(target).length > 0;
        const stageValid = journal.phase === "staging" ? Object.entries(temporary).every(([name, hash]) => Object.hasOwn(entry.after, name) && entry.after[name] === hash) : Object.keys(temporary).length === 0 || sameTree(temporary, entry.after);
        const targetValid = journal.phase === "committed" ? sameTree(target, entry.after) : sameTree(target, entry.before) || (journal.phase === "applying" && (sameTree(target, entry.after) || (!hasTarget && hasBackup)));
        const missingBackup = journal.phase === "applying" && !hasBackup && Object.keys(entry.before).length > 0 && !sameTree(target, entry.before);
        if (!stageValid || !targetValid || (hasBackup && !sameTree(backup, entry.before)) || missingBackup || (journal.phase === "staging" && hasBackup)) throw new HalignError(`${join(home, entry.target)} (backup: ${join(home, entry.backup)}, stage: ${join(home, entry.temporary)}): changed outside the pending deployment; preserve ${recordPath}`);
        return { target, backup, temporary, hasBackup, hasTarget };
    };
    await Promise.all(journal.entries.map(inspect));
    if (journal.phase === "committed" && baseline !== journal.baselineAfter)
    {
        await atomicWrite(baselinePath, Buffer.from(journal.baselineAfter, "base64"));
    }
    if (journal.phase !== "committed" && baseline !== journal.baselineBefore)
    {
        if (journal.baselineBefore === null) await fs.unlink(baselinePath);
        else await atomicWrite(baselinePath, Buffer.from(journal.baselineBefore, "base64"));
    }
    for (const entry of [...journal.entries].reverse())
    {
        const state = await inspect(entry);
        const target = join(home, ...entry.target.split("/"));
        const backup = join(home, ...entry.backup.split("/"));
        const temporary = join(home, ...entry.temporary.split("/"));
        if (journal.phase !== "committed")
        {
            if (state.hasBackup)
            {
                if (state.hasTarget) await removeDeploymentPath(home, target);
                await fs.rename(backup, target);
            }
            else if (state.hasTarget && !sameTree(state.target, entry.before)) await removeDeploymentPath(home, target);
            entry.progress = "restored";
            record = await persistDeploymentJournal(root, journal, record);
        }
        else if (state.hasBackup) await removeDeploymentPath(home, backup);
        if (Object.keys(state.temporary).length > 0) await removeDeploymentPath(home, temporary);
    }
    await ensureRegularSource(root, recordPath);
    if (!(await fs.readFile(recordPath)).equals(record)) throw new HalignError(`${recordPath}: recovery record changed before finalization; preserve it`);
    await fs.unlink(recordPath);
    return journal.phase === "committed" ? "completed" : "restored";
}

/** Read only the fixed deployment baseline and reject malformed metadata before target writes. */
async function readDeploymentBaseline(root: string): Promise<DeploymentBaseline>
{
    const path = join(root, ".harness-align", ".deployment.json");
    await ensureRegularSource(root, path);
    if (!(await lstatIfExists(path))) return { version: 1, scopes: {} };
    await assertRegularFileIfPresent(path, "deployment baseline");
    let value: unknown;
    try { value = JSON.parse(await fs.readFile(path, "utf8")); }
    catch (error) { throw new HalignError(`${path}: expected deployment JSON, got ${errorText(error)}`); }
    if (!isRecord(value) || value.version !== 1 || !isRecord(value.scopes)) throw new HalignError(`${path}: expected version 1 and scopes mapping`);
    const scopes: Array<[string, Record<string, string>]> = [];
    for (const [scope, tree] of Object.entries(value.scopes))
    {
        if (!scope || scope.includes("\\") || scope.split("/").some((part) => !part || part === "." || part === "..") || !isRecord(tree)) throw new HalignError(`${path}: invalid deployment scope ${valueText(scope)}`);
        const entries: Array<[string, string]> = [];
        for (const [name, hash] of Object.entries(tree))
        {
            if (typeof hash !== "string" || (hash !== "directory" && !/^[a-f0-9]{64}$/u.test(hash)) || (name !== "." && (name.includes("\\") || name.split("/").some((part) => !part || part === "." || part === "..")))) throw new HalignError(`${path}: invalid scope ${scope} entry ${valueText(name)} with hash ${valueText(hash)}`);
            entries.push([name, hash]);
        }
        scopes.push([scope, Object.fromEntries(entries)]);
    }
    return { version: 1, scopes: Object.fromEntries(scopes) };
}

/** Read-only deployment preview bound to source bytes, selection, and target contents. */
export interface SetupPreview
{
    revision: string;
    changes: SetupChange[];
}

/** Capture exact file contents and empty directories without following links. */
async function snapshotTree(root: string, path: string, skipHidden = false): Promise<Record<string, string>>
{
    await assertNoReparseComponents(root, path, "deployment snapshot");
    const tree: Record<string, string> = Object.create(null);
    /** Recursively capture a regular path relative to the deployment scope. */
    const visit = async (current: string, name: string): Promise<void> =>
    {
        const stats = await lstatIfExists(current);
        if (!stats) return;
        if (stats.isSymbolicLink()) throw deploymentReparseError("deployment snapshot", current);
        if (stats.isDirectory())
        {
            tree[name] = "directory";
            for (const child of (await fs.readdir(current)).sort(codePointCompare))
            {
                if (!skipHidden || !child.startsWith(".")) await visit(join(current, child), name === "." ? child : `${name}/${child}`);
            }
        }
        else if (stats.isFile()) tree[name] = createHash("sha256").update(await fs.readFile(current)).digest("hex");
        else throw new HalignError(`${current}: expected a regular file or directory`);
    };
    await visit(path, ".");
    return tree;
}

/** Compare scopes deterministically, keeping deletions and skipped directories visible. */
function scopeChanges(path: string, before: Record<string, string>, after: Record<string, string>, previous?: Record<string, string>): SetupChange[]
{
    return [...new Set([...Object.keys(before), ...Object.keys(after), ...Object.keys(previous ?? {})])].sort(codePointCompare).map((name) =>
    {
        const status: SetupChange["status"] = !Object.hasOwn(before, name) ? Object.hasOwn(after, name) ? "added" : "unchanged" : !Object.hasOwn(after, name) ? "deleted" : before[name] === after[name] ? "unchanged" : "modified";
        const external = previous && Object.hasOwn(previous, name) && previous[name] !== before[name] ? "Changed since last deployment"
            : status === "deleted" && (!previous || !Object.hasOwn(previous, name)) ? "Extra path will be deleted"
                : !previous && status === "modified" ? "Existing content has no deployment baseline" : undefined;
        return { path: name === "." ? path : `${path}/${name}`, status, ...(external ? { external } : {}) };
    });
}

/** Build a desired directory snapshot from generated relative file paths. */
function outputTree(files: Array<[string, Buffer]>): Record<string, string>
{
    const tree: Record<string, string> = { ".": "directory" };
    for (const [path, content] of files)
    {
        tree[path] = createHash("sha256").update(content).digest("hex");
    }
    return tree;
}

/** List files under a directory as `/`-separated relative paths. */
async function listRelativeFiles(directory: string): Promise<string[]>
{
    const files: string[] = [];
    const visit = async (current: string, prefix: string): Promise<void> =>
    {
        const entries = await fs.readdir(current, { withFileTypes: true });
        entries.sort((left, right) => codePointCompare(left.name, right.name));
        for (const entry of entries)
        {
            const child = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) await visit(join(current, entry.name), child);
            else if (entry.isFile()) files.push(child);
        }
    };
    await visit(directory, "");
    return files;
}

/** Join USERPROFILE with a harness `config_path` using `/` segments. */
function harnessDeploymentRoot(deploymentRoot: string, configPath: string): string
{
    return join(deploymentRoot, ...configPath.split("/"));
}

/** Resolve a configured harness root under USERPROFILE and require an existing regular directory. */
export async function resolveExistingHarnessRoot(rootPath: string, name: string, userProfile = process.env.USERPROFILE): Promise<string>
{
    const harness = (await loadConfig(resolve(rootPath))).harnesses.find((item) => item.name === name);
    if (!harness) throw new HalignError(`.harness-align/config.json: harness is not configured, got ${valueText(name)}`);
    const deploymentRoot = resolveUserHome(userProfile);
    await assertRegularDirectory(deploymentRoot, "USERPROFILE");
    const targetRoot = await assertNoReparseComponents(
        deploymentRoot,
        harnessDeploymentRoot(deploymentRoot, harness.configPath),
        `${harness.name} target root`,
    );
    await assertRegularDirectory(targetRoot, `${harness.name} target root`);
    return targetRoot;
}

/** Format the setup success report for the desktop log. */
export function reportSetup(result: SetupResult): string
{
    const files = [...result.outputs.keys()];
    const lines = [
        "Setup complete.",
        `Wrote ${files.length} files`,
        ...files.map((path) => `  ${path}`),
    ];
    for (const target of result.targets)
    {
        if (target.skipped)
        {
            lines.push(`Skipped ${target.harness}; target does not exist: ${target.root}`);
            continue;
        }
        lines.push(`Updated ${target.harness} at ${target.root}`);
        for (const file of target.files) lines.push(`  ${file}`);
    }
    lines.push(`Updated shared rules at ${result.sharedRules.target}`);
    for (const file of result.sharedRules.files) lines.push(`  ${file}`);
    if (result.skills.skipped)
    {
        lines.push(`Skipped skills; no project skills to deploy: ${result.skills.target}`);
    }
    else
    {
        lines.push(`Updated skills at ${result.skills.target}`);
        for (const id of result.skills.ids) lines.push(`  ${id}`);
    }
    return `${lines.join("\n")}\n`;
}

/** Validate sources and deployment targets without changing generated files or user directories. */
async function prepareSetup(rootPath: string, selection?: readonly LayerSelection[], userProfile = process.env.USERPROFILE)
{
    const root = resolve(rootPath);
    const baseline = await readDeploymentBaseline(root);
    const config = await loadConfig(root);
    const outputs = await buildOutputs(root, selection);
    const generatedRoot = join(root, ".harness-align", "generated");
    const deploymentRoot = resolveUserHome(userProfile);
    await assertRegularDirectory(deploymentRoot, "USERPROFILE");
    await assertNoReparseComponents(root, generatedRoot, "generated root");

    const targets: Array<{ harness: Harness; root: string }> = config.harnesses.map((harness) => ({
        harness: harness.name,
        root: harnessDeploymentRoot(deploymentRoot, harness.configPath),
    }));
    const installations: SetupInstallation[] = [];
    const reports: SetupTargetReport[] = [];

    for (const target of targets)
    {
        const targetRoot = await assertNoReparseComponents(deploymentRoot, target.root, `${target.harness} target root`);
        const targetStats = await lstatIfExists(targetRoot);
        if (!targetStats)
        {
            reports.push({ harness: target.harness, root: targetRoot, skipped: true, files: [] });
            continue;
        }
        await assertRegularDirectory(targetRoot, `${target.harness} target root`);
        const targetAgents = await assertNoReparseComponents(deploymentRoot, join(targetRoot, "agents"), `${target.harness} target agents`);
        const targetRules = await assertNoReparseComponents(deploymentRoot, join(targetRoot, "AGENTS.md"), `${target.harness} target AGENTS.md`);
        const agentsStats = await lstatIfExists(targetAgents);
        if (agentsStats)
        {
            if (!agentsStats.isDirectory()) throw new HalignError(`${target.harness} target agents: expected a directory: ${targetAgents}`);
            await assertNoReparseTree(targetAgents, `${target.harness} target agents`);
        }
        await assertRegularFileIfPresent(targetRules, `${target.harness} target AGENTS.md`);
        const prefix = `${target.harness}/agents/`;
        const agents: Array<[string, Buffer]> = [...outputs].filter(([path]) => path.startsWith(prefix)).map(([path, content]) => [path.slice(prefix.length), content]);
        const files = ["AGENTS.md", ...agents.map(([path]) => `agents/${path}`)];
        installations.push({ agents, rules: outputs.get(`${target.harness}/AGENTS.md`)!, targetAgents, targetRules });
        reports.push({ harness: target.harness, root: targetRoot, skipped: false, files });
    }

    const sourceSharedRules = await assertNoReparseComponents(root, join(root, ".harness-align", "rules", "shared"), "shared rules source");
    await assertRegularDirectory(sourceSharedRules, "shared rules source");
    await assertNoReparseTree(sourceSharedRules, "shared rules source");
    const targetAgentsRoot = await assertNoReparseComponents(deploymentRoot, join(deploymentRoot, ".agents"), "shared rules root");
    const targetSharedRules = await assertNoReparseComponents(deploymentRoot, join(targetAgentsRoot, "shared-rules"), "shared rules target");
    const sharedStats = await lstatIfExists(targetSharedRules);
    if (sharedStats)
    {
        if (!sharedStats.isDirectory()) throw new HalignError(`shared rules target: expected a directory: ${targetSharedRules}`);
        await assertNoReparseTree(targetSharedRules, "shared rules target");
    }

    const projectSkills = await loadSkills(root);
    const targetSkillsRoot = await assertNoReparseComponents(deploymentRoot, join(targetAgentsRoot, "skills"), "skills target");
    const skillInstallations: Array<{ id: string; source: string; target: string }> = [];
    for (const skill of projectSkills)
    {
        const source = await assertNoReparseComponents(root, join(root, ".harness-align", "skills", skill.id), `skill ${skill.id} source`);
        await assertRegularDirectory(source, `skill ${skill.id} source`);
        await assertNoReparseTree(source, `skill ${skill.id} source`);
        const target = await assertNoReparseComponents(deploymentRoot, join(targetSkillsRoot, skill.id), `skill ${skill.id} target`);
        const targetStats = await lstatIfExists(target);
        if (targetStats)
        {
            if (targetStats.isSymbolicLink()) throw deploymentReparseError(`skill ${skill.id} target`, target);
            if (!targetStats.isDirectory()) throw new HalignError(`skill ${skill.id} target: expected a directory: ${target}`);
            await assertNoReparseTree(target, `skill ${skill.id} target`);
        }
        skillInstallations.push({ id: skill.id, source, target });
    }
    const skillsSkipped = skillInstallations.length === 0;

    const sharedFiles = await listRelativeFiles(sourceSharedRules);
    const replacements = [
        ...installations.flatMap((installation) => [
            { target: installation.targetAgents, populate: async (path: string): Promise<void> =>
            {
                await fs.mkdir(path);
                for (const [name, content] of installation.agents) await fs.writeFile(join(path, name), content, { flag: "wx" });
            } },
            { target: installation.targetRules, populate: (path: string) => fs.writeFile(path, installation.rules, { flag: "wx" }) },
        ]),
        { target: targetSharedRules, populate: (path: string) => fs.cp(sourceSharedRules, path, { recursive: true, force: false, errorOnExist: true }) },
        ...skillInstallations.map((skill) => ({ target: skill.target, populate: (path: string) => copySkillTree(skill.source, path) })),
    ];

    const desired = [
        ...installations.flatMap((installation) => [outputTree(installation.agents), { ".": createHash("sha256").update(installation.rules).digest("hex") }]),
        await snapshotTree(root, sourceSharedRules),
        ...await Promise.all(skillInstallations.map((skill) => snapshotTree(root, skill.source, true))),
    ];
    const actual = await Promise.all(replacements.map((replacement) => snapshotTree(deploymentRoot, replacement.target)));
    const sources = await Promise.all(["config.json", "rules", "layers", "agents", "skills"].map((scope) => snapshotTree(root, join(root, ".harness-align", scope))));
    const scopeNames = replacements.map((replacement) => relative(deploymentRoot, replacement.target).split(sep).join("/"));
    const changes = replacements.flatMap((replacement, index) => scopeChanges(`~/${scopeNames[index]!}`, actual[index]!, desired[index]!, Object.hasOwn(baseline.scopes, scopeNames[index]!) ? baseline.scopes[scopeNames[index]!] : undefined));
    for (const target of reports.filter((item) => item.skipped)) changes.push({ path: `~/${relative(deploymentRoot, target.root).split(sep).join("/")}`, status: "skipped" });
    if (skillsSkipped) changes.push({ path: "~/.agents/skills", status: "skipped" });
    const revision = createHash("sha256").update(JSON.stringify({ sources, actual, desired, selection, reports, baseline })).digest("hex");

    const result: SetupResult = {
        outputs,
        generatedRoot,
        targets: reports,
        sharedRules: { target: targetSharedRules, files: sharedFiles },
        skills: {
            target: targetSkillsRoot,
            skipped: skillsSkipped,
            ids: skillInstallations.map((skill) => skill.id),
        },
    };
    const nextBaseline: DeploymentBaseline = { version: 1, scopes: Object.fromEntries(Object.entries({ ...baseline.scopes, ...Object.fromEntries(scopeNames.map((name, index) => [name, desired[index]!])) }).sort(([left], [right]) => codePointCompare(left, right))) };
    return { result, replacements, revision, changes, desired, nextBaseline };
}

/** Preview exact replacement scope and skipped targets using the same production setup plan. */
export async function previewSetup(rootPath: string, selection?: readonly LayerSelection[], userProfile = process.env.USERPROFILE): Promise<SetupPreview>
{
    const { revision, changes } = await prepareSetup(rootPath, selection, userProfile);
    return { revision, changes };
}

/** Generate and deploy only after validating the reviewed source and target revision. */
export async function setup(rootPath: string, selection?: readonly LayerSelection[], userProfile = process.env.USERPROFILE, expectedRevision?: string, overwriteExternal = false): Promise<SetupResult>
{
    await recoverDeployment(rootPath, userProfile);
    const plan = await prepareSetup(rootPath, selection, userProfile);
    if (expectedRevision !== undefined && plan.revision !== expectedRevision) throw new HalignError("Setup preview expired: sources or deployment targets changed; preview again before deploying");
    if (!overwriteExternal && plan.changes.some((change) => change.external && change.status !== "unchanged")) throw new HalignError("Setup requires explicit overwrite approval for externally modified targets or extra paths; review the preview before deploying");
    await generate(rootPath, selection);
    await deployReplacements(resolve(rootPath), resolveUserHome(userProfile), plan.replacements, plan.desired, plan.nextBaseline, async () =>
    {
        const current = await prepareSetup(rootPath, selection, userProfile);
        if (current.revision !== plan.revision) throw new HalignError("Setup preview expired: sources or deployment targets changed while staging; preview again before deploying");
    });
    return plan.result;
}
