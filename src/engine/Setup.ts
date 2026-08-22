/**
 * Deploy generated harness files into existing USERPROFILE roots, shared-rules, and skills.
 * Missing harness roots are skipped. Preflight every target before any delete.
 */

import { promises as fs } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { atomicWrite, lstatIfExists, resolveUserHome } from "./FsSafe.js";
import { generate } from "./Generate.js";
import { loadConfig } from "./Load.js";
import { type Harness, type LayerSelection, type OutputMap, codePointCompare, HalignError, valueText } from "./Model.js";
import { hasHiddenSegment, loadSkills } from "./Skills.js";

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

/** Require an existing regular file. */
async function assertRegularFile(path: string, label: string): Promise<void>
{
    const stats = await lstatIfExists(path);
    if (!stats) throw new HalignError(`${label}: file does not exist: ${path}`);
    if (stats.isSymbolicLink()) throw deploymentReparseError(label, path);
    if (!stats.isFile()) throw new HalignError(`${label}: expected a file: ${path}`);
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

/** Delete a deploy directory after containment and reparse checks. */
async function removeDeploymentDirectory(userProfile: string, path: string, label: string): Promise<void>
{
    const target = await assertNoReparseComponents(userProfile, path, label);
    const stats = await lstatIfExists(target);
    if (!stats) return;
    if (!stats.isDirectory()) throw new HalignError(`${label}: expected a directory: ${target}`);
    await assertNoReparseTree(target, label);
    await fs.rm(target, { recursive: true, force: true });
}

/** Resolved source and target paths for one harness deploy. */
interface SetupInstallation
{
    harness: Harness;
    sourceAgents: string | undefined;
    sourceRules: string;
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

/** Copy one skill directory while skipping hidden path segments. */
async function copySkillDirectory(source: string, destination: string): Promise<void>
{
    const visit = async (current: string, prefix: string): Promise<void> =>
    {
        const entries = await fs.readdir(current, { withFileTypes: true });
        entries.sort((left, right) => codePointCompare(left.name, right.name));
        for (const entry of entries)
        {
            if (entry.name.startsWith(".")) continue;
            const child = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (hasHiddenSegment(child)) continue;
            const from = join(current, entry.name);
            const to = join(destination, ...child.split("/"));
            const stats = await lstatIfExists(from);
            if (!stats) continue;
            if (stats.isSymbolicLink()) throw new HalignError(`${from}: symbolic link skill sources are not allowed`);
            if (stats.isDirectory())
            {
                await fs.mkdir(to, { recursive: true });
                await visit(from, child);
            }
            else if (stats.isFile())
            {
                await fs.mkdir(join(to, ".."), { recursive: true });
                await fs.copyFile(from, to);
            }
        }
    };
    await fs.mkdir(destination, { recursive: true });
    await visit(source, "");
}

/** Format the setup success report for CLI and the desktop log. */
export function reportSetup(result: SetupResult): string
{
    const files = [...result.outputs.keys()];
    const lines = [
        "Setup complete.",
        `Wrote ${files.length} files to ${result.generatedRoot}`,
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
    const generatedRoot = join(root, ".halign", "generated");
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
        const sourceRoot = await assertNoReparseComponents(root, join(generatedRoot, target.harness), `${target.harness} generated source`);
        const sourceAgentsPath = await assertNoReparseComponents(root, join(sourceRoot, "agents"), `${target.harness} source agents`);
        const sourceRules = await assertNoReparseComponents(root, join(sourceRoot, "AGENTS.md"), `${target.harness} source AGENTS.md`);
        await assertRegularFile(sourceRules, `${target.harness} source AGENTS.md`);
        const sourceAgentsStats = await lstatIfExists(sourceAgentsPath);
        let sourceAgents: string | undefined;
        if (sourceAgentsStats)
        {
            await assertRegularDirectory(sourceAgentsPath, `${target.harness} source agents`);
            await assertNoReparseTree(sourceAgentsPath, `${target.harness} source agents`);
            sourceAgents = sourceAgentsPath;
        }

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
        const agentFiles = sourceAgents === undefined ? [] : (await listRelativeFiles(sourceAgents)).map((file) => `agents/${file}`);
        const files = ["AGENTS.md", ...agentFiles];
        installations.push({ harness: target.harness, sourceAgents, sourceRules, targetAgents, targetRules });
        reports.push({ harness: target.harness, root: targetRoot, skipped: false, files });
    }

    const sourceSharedRules = await assertNoReparseComponents(root, join(root, ".halign", "rules", "shared"), "shared rules source");
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
        const source = await assertNoReparseComponents(root, join(root, ".halign", "skills", skill.id), `skill ${skill.id} source`);
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

    for (const installation of installations)
    {
        await removeDeploymentDirectory(deploymentRoot, installation.targetAgents, `${installation.harness} target agents`);
        await atomicWrite(installation.targetRules, await fs.readFile(installation.sourceRules));
        if (installation.sourceAgents !== undefined)
        {
            await fs.cp(installation.sourceAgents, installation.targetAgents, { recursive: true, force: false, errorOnExist: true });
        }
        else
        {
            await fs.mkdir(installation.targetAgents, { recursive: true });
        }
    }

    const sharedFiles = await listRelativeFiles(sourceSharedRules);
    await fs.mkdir(targetAgentsRoot, { recursive: true });
    await removeDeploymentDirectory(deploymentRoot, targetSharedRules, "shared rules target");
    await fs.cp(sourceSharedRules, targetSharedRules, { recursive: true, force: false, errorOnExist: true });

    if (!skillsSkipped)
    {
        await fs.mkdir(targetSkillsRoot, { recursive: true });
        for (const skill of skillInstallations)
        {
            await removeDeploymentDirectory(deploymentRoot, skill.target, `skill ${skill.id} target`);
            await copySkillDirectory(skill.source, skill.target);
        }
    }

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
