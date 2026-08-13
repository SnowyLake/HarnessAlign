/*
setup 部署边界:

- deployment root 与 project root 是不同的信任边界.
- 预检必须在任何删除前完成. 缺失的 Harness 根目录被明确跳过.
*/

import { promises as fs } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { atomicWrite, lstatIfExists } from "./fs-safe.js";
import { generate } from "./generate.js";
import { loadConfig } from "./load.js";
import { type Harness, HalignError, valueText } from "./model.js";

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

function deploymentReparseError(label: string, path: string): HalignError
{
    return new HalignError(`${label}: reparse points are not allowed: ${path}`);
}

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

async function assertRegularDirectory(path: string, label: string): Promise<void>
{
    const stats = await lstatIfExists(path);
    if (!stats) throw new HalignError(`${label}: directory does not exist: ${path}`);
    if (stats.isSymbolicLink()) throw deploymentReparseError(label, path);
    if (!stats.isDirectory()) throw new HalignError(`${label}: expected a directory: ${path}`);
}

async function assertRegularFile(path: string, label: string): Promise<void>
{
    const stats = await lstatIfExists(path);
    if (!stats) throw new HalignError(`${label}: file does not exist: ${path}`);
    if (stats.isSymbolicLink()) throw deploymentReparseError(label, path);
    if (!stats.isFile()) throw new HalignError(`${label}: expected a file: ${path}`);
}

async function assertRegularFileIfPresent(path: string, label: string): Promise<void>
{
    const stats = await lstatIfExists(path);
    if (!stats) return;
    if (stats.isSymbolicLink()) throw deploymentReparseError(label, path);
    if (!stats.isFile()) throw new HalignError(`${label}: expected a file: ${path}`);
}

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

async function removeDeploymentDirectory(userProfile: string, path: string, label: string): Promise<void>
{
    const target = await assertNoReparseComponents(userProfile, path, label);
    const stats = await lstatIfExists(target);
    if (!stats) return;
    if (!stats.isDirectory()) throw new HalignError(`${label}: expected a directory: ${target}`);
    await assertNoReparseTree(target, label);
    await fs.rm(target, { recursive: true, force: true });
}

interface SetupInstallation
{
    harness: Harness;
    sourceAgents: string;
    sourceRules: string;
    targetAgents: string;
    targetRules: string;
}

export async function setup(rootPath: string, profile?: string, userProfile = process.env.USERPROFILE): Promise<void>
{
    const root = resolve(rootPath);
    const config = await loadConfig(root);
    await generate(root, profile);
    if (!userProfile || !isAbsolute(userProfile))
    {
        throw new HalignError(`USERPROFILE must be an absolute path, got ${valueText(userProfile)}`);
    }
    const deploymentRoot = resolve(userProfile);
    await assertRegularDirectory(deploymentRoot, "USERPROFILE");
    const generated = join(root, ".halign", "generated");
    await assertNoReparseComponents(root, generated, "generated root");

    const targets: Array<{ harness: Harness; root: string }> = config.harnesses.map((harness) => ({
        harness: harness.name,
        root: join(deploymentRoot, ...harness.configPath.split("/")),
    }));
    const installations: SetupInstallation[] = [];

    for (const target of targets)
    {
        const sourceRoot = await assertNoReparseComponents(root, join(generated, target.harness), `${target.harness} generated source`);
        const sourceAgents = await assertNoReparseComponents(root, join(sourceRoot, "agents"), `${target.harness} source agents`);
        const sourceRules = await assertNoReparseComponents(root, join(sourceRoot, "AGENTS.md"), `${target.harness} source AGENTS.md`);
        await assertRegularDirectory(sourceAgents, `${target.harness} source agents`);
        await assertNoReparseTree(sourceAgents, `${target.harness} source agents`);
        await assertRegularFile(sourceRules, `${target.harness} source AGENTS.md`);

        const targetRoot = await assertNoReparseComponents(deploymentRoot, target.root, `${target.harness} target root`);
        const targetStats = await lstatIfExists(targetRoot);
        if (!targetStats) continue;
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
        installations.push({ harness: target.harness, sourceAgents, sourceRules, targetAgents, targetRules });
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

    await fs.mkdir(targetAgentsRoot, { recursive: true });
    await removeDeploymentDirectory(deploymentRoot, targetSharedRules, "shared rules target");
    await fs.cp(sourceSharedRules, targetSharedRules, { recursive: true, force: false, errorOnExist: true });
}
