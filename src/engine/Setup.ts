/**
 * Deploy generated harness files into existing USERPROFILE roots and shared-rules.
 * Missing harness roots are skipped. Preflight every target before any delete.
 */

import { promises as fs } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { atomicWrite, lstatIfExists } from "./FsSafe.js";
import { generate } from "./Generate.js";
import { loadConfig } from "./Load.js";
import { type Harness, type OutputMap, codePointCompare, HalignError, valueText } from "./Model.js";

/** Resolve `path` and throw if it escapes `root`. */
function assertContainedWithin(root: string, path: string, label: string): string
{
    const rootFull = resolve(root);
    const pathFull = resolve(path);
    const pathRelative = relative(rootFull, pathFull);
    if (!pathRelative || pathRelative === ".." || pathRelative.startsWith(`..${sep}`) || isAbsolute(pathRelative))
    {
        throw new HalignError(`${label}: path must stay inside its allowed root`);
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
    sourceAgents: string;
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

/** Outcome of generating and deploying into existing harness roots. */
export interface SetupResult
{
    outputs: OutputMap;
    generatedRoot: string;
    targets: SetupTargetReport[];
    sharedRules: { target: string; files: string[] };
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
    return `${lines.join("\n")}\n`;
}

/** Generate then deploy into existing USERPROFILE harness roots and shared-rules. */
export async function setup(rootPath: string, profile?: string, userProfile = process.env.USERPROFILE): Promise<SetupResult>
{
    const root = resolve(rootPath);
    const config = await loadConfig(root);
    const outputs = await generate(root, profile);
    const generatedRoot = join(root, ".halign", "generated");
    if (!userProfile || !isAbsolute(userProfile))
    {
        throw new HalignError(`USERPROFILE must be an absolute path, got ${valueText(userProfile)}`);
    }
    const deploymentRoot = resolve(userProfile);
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
        const sourceAgents = await assertNoReparseComponents(root, join(sourceRoot, "agents"), `${target.harness} source agents`);
        const sourceRules = await assertNoReparseComponents(root, join(sourceRoot, "AGENTS.md"), `${target.harness} source AGENTS.md`);
        await assertRegularDirectory(sourceAgents, `${target.harness} source agents`);
        await assertNoReparseTree(sourceAgents, `${target.harness} source agents`);
        await assertRegularFile(sourceRules, `${target.harness} source AGENTS.md`);

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
        const files = ["AGENTS.md", ...(await listRelativeFiles(sourceAgents)).map((file) => `agents/${file}`)];
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

    for (const installation of installations)
    {
        await removeDeploymentDirectory(deploymentRoot, installation.targetAgents, `${installation.harness} target agents`);
        await atomicWrite(installation.targetRules, await fs.readFile(installation.sourceRules));
        await fs.cp(installation.sourceAgents, installation.targetAgents, { recursive: true, force: false, errorOnExist: true });
    }

    const sharedFiles = await listRelativeFiles(sourceSharedRules);
    await fs.mkdir(targetAgentsRoot, { recursive: true });
    await removeDeploymentDirectory(deploymentRoot, targetSharedRules, "shared rules target");
    await fs.cp(sourceSharedRules, targetSharedRules, { recursive: true, force: false, errorOnExist: true });
    return {
        outputs,
        generatedRoot,
        targets: reports,
        sharedRules: { target: targetSharedRules, files: sharedFiles },
    };
}
