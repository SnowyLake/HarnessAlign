/**
 * Deploy generated harness files into existing USERPROFILE roots, shared-rules, and skills.
 * Missing harness roots are skipped. Preflight every target before any delete.
 */

import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { lstatIfExists, resolveUserHome } from "./FsSafe.js";
import { generate } from "./Generate.js";
import { loadConfig } from "./Load.js";
import { type Harness, type LayerSelection, type OutputMap, codePointCompare, errorText, HalignError, valueText } from "./Model.js";
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

/** Stage all replacements before swapping targets, restoring backups if a swap fails. */
async function deployReplacements(userProfile: string, replacements: Array<{ target: string; populate: (path: string) => Promise<void> }>): Promise<void>
{
    const staged: Array<{ target: string; temporary: string; backup: string; hasBackup: boolean; installed: boolean }> = [];
    try
    {
        for (const replacement of replacements)
        {
            const target = await assertNoReparseComponents(userProfile, replacement.target, "deployment target");
            const parent = dirname(target);
            await fs.mkdir(parent, { recursive: true });
            const entry = { target, temporary: join(parent, `.harness-align-stage-${randomUUID()}`),
                backup: join(parent, `.harness-align-backup-${randomUUID()}`), hasBackup: false, installed: false };
            staged.push(entry);
            await replacement.populate(entry.temporary);
            await assertNoReparseTree(entry.temporary, "staged deployment");
        }
        for (const entry of staged)
        {
            await assertNoReparseComponents(userProfile, entry.target, "deployment target");
            if (await lstatIfExists(entry.target))
            {
                await assertNoReparseTree(entry.target, "deployment target");
                await fs.rename(entry.target, entry.backup);
                entry.hasBackup = true;
            }
            await fs.rename(entry.temporary, entry.target);
            entry.installed = true;
        }
    }
    catch (error)
    {
        const failures: string[] = [];
        for (const entry of [...staged].reverse())
        {
            try
            {
                if (entry.installed) await removeDeploymentPath(userProfile, entry.target);
                if (entry.hasBackup)
                {
                    await assertNoReparseComponents(userProfile, entry.backup, "deployment backup");
                    await assertNoReparseTree(entry.backup, "deployment backup");
                    await fs.rename(entry.backup, entry.target);
                }
            }
            catch (rollbackError)
            {
                failures.push(`${entry.target} (backup: ${entry.backup}): ${errorText(rollbackError)}`);
            }
        }
        if (failures.length > 0) throw new HalignError(`Setup failed: ${errorText(error)}; rollback failed: ${failures.join("; ")}`);
        throw error;
    }
    finally
    {
        for (const entry of staged) await removeDeploymentPath(userProfile, entry.temporary);
    }
    for (const entry of staged)
    {
        if (entry.hasBackup) await removeDeploymentPath(userProfile, entry.backup);
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

/** Generate then deploy into existing USERPROFILE harness roots, shared-rules, and skills. */
export async function setup(rootPath: string, selection?: readonly LayerSelection[], userProfile = process.env.USERPROFILE): Promise<SetupResult>
{
    const root = resolve(rootPath);
    const config = await loadConfig(root);
    const outputs = await generate(root, selection);
    const generatedRoot = join(root, ".harness-align", "generated");
    const deploymentRoot = resolveUserHome(userProfile);
    await assertRegularDirectory(deploymentRoot, "USERPROFILE");
    await assertNoReparseComponents(root, generatedRoot, "generated root");

    const targets: Array<{ harness: Harness; root: string }> = config.harnesses.map((harness) => ({
        harness: harness.name,
        root: join(deploymentRoot, ...harness.configPath.split("/")),
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
    await deployReplacements(deploymentRoot, [
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
    ]);

    return {
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
}
