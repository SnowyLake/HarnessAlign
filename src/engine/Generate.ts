/**
 * Canonical generate lifecycle: build an in-memory map, preflight, write files, then commit the manifest.
 * `buildOutputs` is read-only. Keep the old manifest if a stale delete fails.
 * Only manifest-owned shape blockers are removed before writes; unrelated stale files follow them.
 */

import { promises as fs } from "node:fs";
import { dirname, join, posix, resolve, sep } from "node:path";
import { assertContained, atomicWrite, display, ensureRegularSource, lstatIfExists, pathKey, readUtf8, reparseError } from "./FsSafe.js";
import { loadAgents, loadConfig, loadLayerOptions, loadRules } from "./Load.js";
import {
    type Config,
    type LayerOption,
    type LayerSelection,
    type OutputMap,
    assertWindowsSafeName,
    codePointCompare,
    errorText,
    HalignError,
    harnessOutputPaths,
    isRecord,
    valueText,
} from "./Model.js";
import { renderAgent, renderAgentsMarkdown } from "./Render.js";

/** Resolve a complete ordered layer selection and return its source files. */
function selectedLayerOptions(config: Config, options: Record<string, LayerOption[]>, requested?: readonly LayerSelection[]): [LayerSelection[], LayerOption[]]
{
    const selections = requested
        ? requested.map((selection) => ({ ...selection }))
        : config.layers.map((layer) => ({ name: layer.name, option: layer.selected }));
    const seen = new Set<string>();
    const selected: LayerOption[] = [];
    for (const selection of selections)
    {
        if (!Object.hasOwn(options, selection.name)) throw new HalignError(`unknown layer selection ${valueText(selection.name)}`);
        if (seen.has(selection.name)) throw new HalignError(`layer selection must not contain duplicate ${valueText(selection.name)}`);
        seen.add(selection.name);
        const option = options[selection.name]?.find((candidate) => candidate.name === selection.option);
        if (!option)
        {
            throw new HalignError(`layer ${valueText(selection.name)} option does not exist, got ${valueText(selection.option)}`);
        }
        selected.push(option);
    }
    return [selections, selected];
}

/** Build the in-memory generated file map for a workspace. */
export async function buildOutputs(rootPath: string, selection?: readonly LayerSelection[]): Promise<OutputMap>
{
    const root = resolve(rootPath);
    const config = await loadConfig(root);
    const [rules, agents, layerOptions] = await Promise.all([
        loadRules(root, config.harnesses),
        loadAgents(root, config.harnesses),
        loadLayerOptions(root, config),
    ]);
    const [selections, selectedLayers] = selectedLayerOptions(config, layerOptions, selection);
    const orderedAgents = agents.slice().sort((left, right) => codePointCompare(left.name, right.name));
    const outputs: OutputMap = new Map();
    for (const harness of config.harnesses)
    {
        const { instructionsFile, agentsDir } = harnessOutputPaths(harness);
        outputs.set(`${harness.name}/${instructionsFile}`, renderAgentsMarkdown(rules, selectedLayers, harness.name, config.name));
        for (const agent of orderedAgents)
        {
            if (!agent.targets.includes(harness.name)) continue;
            const metadata = Object.hasOwn(agent.harnesses, harness.name) ? agent.harnesses[harness.name]! : {};
            const destinationPath = `${harness.name}/${agentsDir}/${agent.name}.${harness.agentExtension}`;
            outputs.set(destinationPath, renderAgent(agent, harness, metadata));
        }
    }
    const files = [...outputs.keys()];
    outputs.set(
        ".manifest.json",
        Buffer.from(`${JSON.stringify({ version: 1, layers: selections, files }, null, 2)}\n`, "utf8"),
    );
    return outputs;
}

/** Return the generated directory after ensuring it is not a reparse point. */
async function outputRoot(root: string): Promise<string>
{
    await ensureRegularSource(root, join(root, ".harness-align"));
    const path = join(root, ".harness-align", "generated");
    const stats = await lstatIfExists(path);
    if (stats?.isSymbolicLink()) throw new HalignError(".harness-align/generated: symbolic link output directories are not allowed");
    if (stats && !stats.isDirectory()) throw new HalignError(".harness-align/generated: expected a directory");
    return path;
}

/** Validate a generated relative path against the manifest containment rules. */
export function safeOutputRelative(value: unknown): string
{
    if (typeof value !== "string" || !value || value.includes("\\") || posix.isAbsolute(value) || /^[A-Za-z]:/u.test(value))
    {
        throw new HalignError(`.harness-align/generated/.manifest.json: invalid managed path ${valueText(value)}`);
    }
    const parts = value.split("/");
    if (parts.some((part) => !part || part === "." || part === ".."))
    {
        throw new HalignError(`.harness-align/generated/.manifest.json: invalid managed path ${valueText(value)}`);
    }
    for (const part of parts) assertWindowsSafeName(part, `.harness-align/generated/.manifest.json: ${value}`);
    return value;
}

/** Manifest evidence and the strictly bounded removals needed to change output shapes. */
interface OutputTransitions
{
    staleFiles: ReadonlySet<string>;
    staleDirectories: ReadonlySet<string>;
    files: Map<string, string>;
    directories: Map<string, string>;
}

/** Authorize a collapsing directory only when every entry has stale manifest evidence. */
async function inspectCollapsingDirectory(root: string, path: string, transitions: OutputTransitions): Promise<void>
{
    const stats = await lstatIfExists(path);
    if (!stats) return;
    if (stats.isSymbolicLink()) throw reparseError(root, path, true);
    const identity = pathKey(path);
    if (stats.isFile() && transitions.staleFiles.has(identity)) transitions.files.set(identity, path);
    else if (stats.isDirectory() && transitions.staleDirectories.has(identity))
    {
        transitions.directories.set(identity, path);
        for (const child of (await fs.readdir(path)).sort(codePointCompare)) await inspectCollapsingDirectory(root, join(path, child), transitions);
    }
    else throw new HalignError(`${display(root, path)}: cannot replace an output directory containing a path not managed by the previous manifest`);
}

/** Resolve an output safely, optionally collecting manifest-owned shape blockers. */
async function destination(root: string, outputRelative: string, transitions?: OutputTransitions): Promise<string>
{
    safeOutputRelative(outputRelative);
    const generated = await outputRoot(root);
    const parts = outputRelative.split("/");
    const path = resolve(generated, ...parts);
    assertContained(generated, path, ".harness-align/generated");
    let current = generated;
    for (const part of parts.slice(0, -1))
    {
        current = join(current, part);
        const stats = await lstatIfExists(current);
        if (!stats) return path;
        if (stats.isSymbolicLink()) throw reparseError(root, current, true);
        if (stats.isFile() && transitions?.staleFiles.has(pathKey(current)))
        {
            transitions.files.set(pathKey(current), current);
            return path;
        }
        if (!stats.isDirectory()) throw new HalignError(`${display(root, current)}: expected an output directory`);
    }
    const stats = await lstatIfExists(path);
    if (stats?.isSymbolicLink()) throw reparseError(root, path, true);
    if (stats && !stats.isFile())
    {
        if (!stats.isDirectory() || !transitions?.staleDirectories.has(pathKey(path))) throw new HalignError(`${display(root, path)}: managed output must be a file`);
        await inspectCollapsingDirectory(root, path, transitions);
    }
    return path;
}

/** Read the current manifest, or an empty list when the file is missing. */
async function loadManifest(root: string): Promise<string[]>
{
    const generated = await outputRoot(root);
    const path = join(generated, ".manifest.json");
    const stats = await lstatIfExists(path);
    if (!stats) return [];
    if (stats.isSymbolicLink()) throw new HalignError(".harness-align/generated/.manifest.json: symbolic link outputs are not allowed");
    if (!stats.isFile()) throw new HalignError(".harness-align/generated/.manifest.json: managed output must be a file");
    let manifest: unknown;
    try
    {
        manifest = JSON.parse(await readUtf8(root, path, ".harness-align/generated/.manifest.json")) as unknown;
    }
    catch (error)
    {
        if (error instanceof HalignError) throw error;
        throw new HalignError(`.harness-align/generated/.manifest.json: invalid manifest: ${errorText(error)}`);
    }
    if (!isRecord(manifest) || manifest.version !== 1)
    {
        throw new HalignError(".harness-align/generated/.manifest.json: version must be integer 1");
    }
    if (!Array.isArray(manifest.files) || !manifest.files.every((file) => typeof file === "string"))
    {
        throw new HalignError(".harness-align/generated/.manifest.json: files must be a string array");
    }
    const files = manifest.files.map((file) => safeOutputRelative(file));
    if (new Set(files.map((file) => pathKey(join(generated, file)))).size !== files.length)
    {
        throw new HalignError(".harness-align/generated/.manifest.json: files must not contain duplicates");
    }
    if (files.some((file) => pathKey(join(generated, file)) === pathKey(path)))
    {
        throw new HalignError(".harness-align/generated/.manifest.json: files must not manage the manifest itself");
    }
    return files;
}

/** Collect generated paths that will be written or deleted, after containment checks. */
async function preflightOutputChanges(root: string, expected: OutputMap): Promise<{
    stalePaths: string[]; resolved: Map<string, string>; earlyFiles: string[]; earlyDirectories: string[]; cleanupDirectories: string[];
}>
{
    const oldFiles = await loadManifest(root);
    const generated = await outputRoot(root);
    const generatedKey = pathKey(generated);
    /** Resolve manifest-relative paths before using them to authorize any removal. */
    const resolveOutput = (path: string): string =>
    {
        safeOutputRelative(path);
        const absolute = resolve(generated, ...path.split("/"));
        assertContained(generated, absolute, ".harness-align/generated");
        return absolute;
    };
    const resolved = new Map([...expected.keys()].map((path) => [path, resolveOutput(path)]));
    const currentFiles = new Set([...resolved.values()].map(pathKey));
    const outputFiles = [...resolved].filter(([path]) => path !== ".manifest.json").map(([, path]) => path);
    const outputKeys = new Set(outputFiles.map(pathKey));
    const stale = oldFiles.map(resolveOutput).filter((path) => !currentFiles.has(pathKey(path)));
    const outputDirectories = new Set<string>();
    const staleDirectories = new Set<string>();
    for (const [paths, directories] of [[outputFiles, outputDirectories], [stale, staleDirectories]] as const)
    {
        for (const path of paths) for (let parent = dirname(path); pathKey(parent) !== generatedKey; parent = dirname(parent)) directories.add(pathKey(parent));
    }
    const transitions: OutputTransitions = { staleFiles: new Set(stale.map(pathKey)), staleDirectories, files: new Map(), directories: new Map() };
    for (const path of expected.keys()) await destination(root, path, path === ".manifest.json" ? undefined : transitions);
    const stalePaths: string[] = [];
    for (const path of stale)
    {
        if (outputDirectories.has(pathKey(path))) continue;
        let outputAncestor = false;
        for (let parent = dirname(path); pathKey(parent) !== generatedKey; parent = dirname(parent))
        {
            if (outputKeys.has(pathKey(parent))) { outputAncestor = true; break; }
        }
        if (!outputAncestor) stalePaths.push(await destination(root, display(generated, path)));
    }
    const cleanupDirectories = new Map<string, string>();
    for (const path of stalePaths) for (let parent = dirname(path); pathKey(parent) !== generatedKey; parent = dirname(parent))
    {
        if (!outputDirectories.has(pathKey(parent))) cleanupDirectories.set(pathKey(parent), parent);
    }
    return { stalePaths, resolved, earlyFiles: [...transitions.files.values()].sort(codePointCompare),
        cleanupDirectories: [...cleanupDirectories.values()].sort((left, right) => right.split(sep).length - left.split(sep).length || codePointCompare(left, right)),
        earlyDirectories: [...transitions.directories.values()].sort((left, right) => right.split(sep).length - left.split(sep).length || codePointCompare(left, right)) };
}

/** Recheck managed file paths immediately before deleting them without following links. */
async function removeOutputFiles(root: string, paths: readonly string[]): Promise<void>
{
    const generated = await outputRoot(root);
    for (const path of paths)
    {
        await destination(root, display(generated, path));
        if (await lstatIfExists(path)) await fs.unlink(path);
    }
}

/** Write generated files and replace the manifest after a successful preflight. */
export async function generate(rootPath: string, selection?: readonly LayerSelection[]): Promise<OutputMap>
{
    const expected = await buildOutputs(rootPath, selection);
    const root = resolve(rootPath);
    const { stalePaths, resolved, earlyFiles, earlyDirectories, cleanupDirectories } = await preflightOutputChanges(root, expected);
    const generated = await outputRoot(root);
    await fs.mkdir(generated, { recursive: true });
    await removeOutputFiles(root, earlyFiles);
    for (const path of earlyDirectories)
    {
        await ensureRegularSource(root, path);
        const stats = await lstatIfExists(path);
        if (!stats) continue;
        if (stats.isSymbolicLink()) throw reparseError(root, path, true);
        if (!stats.isDirectory()) throw new HalignError(`${display(root, path)}: expected an empty managed output directory`);
        await fs.rmdir(path);
    }
    for (const [path, content] of expected)
    {
        if (path !== ".manifest.json") await atomicWrite(resolved.get(path)!, content);
    }
    await removeOutputFiles(root, stalePaths);
    // Remove retired empty parents before the new manifest discards their ownership evidence.
    for (const path of cleanupDirectories)
    {
        await ensureRegularSource(root, path);
        const stats = await lstatIfExists(path);
        if (!stats) continue;
        if (stats.isSymbolicLink()) throw reparseError(root, path, true);
        if (!stats.isDirectory()) throw new HalignError(`${display(root, path)}: expected a retired output directory`);
        if ((await fs.readdir(path)).length === 0) await fs.rmdir(path);
    }
    await atomicWrite(resolved.get(".manifest.json")!, expected.get(".manifest.json")!);
    return expected;
}

/** Format the generate success report for the desktop log. */
export function reportGenerate(outputs: OutputMap): string
{
    const files = [...outputs.keys()];
    return `Generation complete.\nWrote ${files.length} files\n${files.map((path) => `  ${path}`).join("\n")}\n`;
}

/** Read every file currently under the generated directory. */
export async function readGeneratedFiles(rootPath: string): Promise<Map<string, Buffer>>
{
    const root = resolve(rootPath);
    const generated = await outputRoot(root);
    if (!(await lstatIfExists(generated))) return new Map();
    const files = new Map<string, Buffer>();
    const visit = async (current: string): Promise<void> =>
    {
        const currentStats = await lstatIfExists(current);
        if (currentStats?.isSymbolicLink()) throw reparseError(root, current, true);
        const entries = await fs.readdir(current, { withFileTypes: true });
        entries.sort((left, right) => codePointCompare(left.name, right.name));
        for (const entry of entries)
        {
            const path = join(current, entry.name);
            const stats = await lstatIfExists(path);
            if (!stats) continue;
            if (stats.isSymbolicLink()) throw reparseError(root, path, true);
            if (stats.isDirectory()) await visit(path);
            else if (stats.isFile()) files.set(display(generated, path), await fs.readFile(path));
        }
    };
    await visit(generated);
    return files;
}

/** Content-derived state compared with saved sources and the saved Layer selection. */
export interface GenerationStatus
{
    state: "current" | "stale" | "missing" | "partial" | "error";
    changes: Array<{ path: string; status: "missing" | "modified" | "obsolete" }>;
    error?: string;
}

/** Compare managed output bytes using platform path casing rather than a previous button result. */
export async function inspectGenerated(rootPath: string, actual?: Map<string, Buffer>): Promise<GenerationStatus>
{
    const files = actual ?? await readGeneratedFiles(rootPath);
    let expected: OutputMap;
    try { expected = await buildOutputs(rootPath); }
    catch (error) { return { state: "error", changes: [], error: errorText(error) }; }
    const generated = join(resolve(rootPath), ".harness-align", "generated");
    const currentFiles = new Map([...files].map(([path, content]) => [pathKey(join(generated, path)), content]));
    const expectedPaths = new Set([...expected.keys()].map((path) => pathKey(join(generated, path))));
    const changes: GenerationStatus["changes"] = [];
    for (const [path, content] of expected)
    {
        const current = currentFiles.get(pathKey(join(generated, path)));
        if (!current) changes.push({ path, status: "missing" });
        else if (!current.equals(content)) changes.push({ path, status: "modified" });
    }
    let managed: string[];
    try { managed = await loadManifest(resolve(rootPath)); }
    catch (error)
    {
        if (!(error instanceof HalignError) || !/invalid manifest|version must|files must/u.test(error.message)) throw error;
        return { state: "partial", changes };
    }
    for (const path of managed) if (!expectedPaths.has(pathKey(join(generated, path)))) changes.push({ path, status: "obsolete" });
    changes.sort((left, right) => codePointCompare(left.path, right.path));
    const state = changes.length === 0 ? "current" : files.size === 0 ? "missing" : changes.some((change) => change.status === "missing") ? "partial" : "stale";
    return { state, changes };
}
