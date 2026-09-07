/**
 * Canonical generate lifecycle: build an in-memory map, preflight, write files, then commit the manifest.
 * `buildOutputs` is read-only. Keep the old manifest if a stale delete fails.
 */

import { promises as fs } from "node:fs";
import { join, posix, resolve } from "node:path";
import { assertContained, atomicWrite, display, lstatIfExists, readUtf8, reparseError } from "./FsSafe.js";
import { loadAgents, loadConfig, loadLayerOptions, loadRules } from "./Load.js";
import {
    type Config,
    type LayerOption,
    type LayerSelection,
    type OutputMap,
    codePointCompare,
    errorText,
    HalignError,
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
    if (!requested)
    {
        const missing = config.layers.find((layer) => !seen.has(layer.name));
        if (missing) throw new HalignError(`layer selection is missing ${valueText(missing.name)}`);
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
        outputs.set(`${harness.name}/AGENTS.md`, renderAgentsMarkdown(rules, selectedLayers, harness.name, config.name));
        for (const agent of orderedAgents)
        {
            const metadata = agent.harnesses[harness.name];
            if (!metadata) continue;
            const destinationPath = `${harness.name}/agents/${agent.name}.${harness.agentExtension}`;
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
    if (parts.includes(".") || parts.includes(".."))
    {
        throw new HalignError(`.harness-align/generated/.manifest.json: invalid managed path ${valueText(value)}`);
    }
    return value;
}

/** Resolve a generated relative path and reject reparse points along it. */
async function destination(root: string, outputRelative: string): Promise<string>
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
        if (stats?.isSymbolicLink()) throw reparseError(root, current, true);
        if (stats && !stats.isDirectory()) throw new HalignError(`${display(root, current)}: expected an output directory`);
    }
    const stats = await lstatIfExists(path);
    if (stats?.isSymbolicLink()) throw reparseError(root, path, true);
    if (stats && !stats.isFile()) throw new HalignError(`${display(root, path)}: managed output must be a file`);
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
    if (!isRecord(manifest) || typeof manifest.version !== "number" || !Number.isInteger(manifest.version) || manifest.version !== 1)
    {
        throw new HalignError(".harness-align/generated/.manifest.json: version must be integer 1");
    }
    if (!Array.isArray(manifest.files) || !manifest.files.every((file) => typeof file === "string"))
    {
        throw new HalignError(".harness-align/generated/.manifest.json: files must be a string array");
    }
    if (new Set(manifest.files).size !== manifest.files.length)
    {
        throw new HalignError(".harness-align/generated/.manifest.json: files must not contain duplicates");
    }
    if (manifest.files.includes(".manifest.json"))
    {
        throw new HalignError(".harness-align/generated/.manifest.json: files must not manage the manifest itself");
    }
    return manifest.files.map((file) => safeOutputRelative(file));
}

/** Collect generated paths that will be written or deleted, after containment checks. */
async function preflightOutputChanges(root: string, expected: OutputMap): Promise<{ stalePaths: string[]; resolved: Map<string, string> }>
{
    const oldFiles = await loadManifest(root);
    const currentFiles = new Set([...expected.keys()].filter((path) => path !== ".manifest.json"));
    const stale = oldFiles.filter((path) => !currentFiles.has(path));
    const resolved = new Map<string, string>();
    for (const path of expected.keys()) resolved.set(path, await destination(root, path));
    const stalePaths: string[] = [];
    for (const path of stale) stalePaths.push(await destination(root, path));
    return { stalePaths, resolved };
}

/** Write generated files and replace the manifest after a successful preflight. */
export async function generate(rootPath: string, selection?: readonly LayerSelection[]): Promise<OutputMap>
{
    const expected = await buildOutputs(rootPath, selection);
    const root = resolve(rootPath);
    const { stalePaths, resolved } = await preflightOutputChanges(root, expected);
    const generated = await outputRoot(root);
    await fs.mkdir(generated, { recursive: true });
    for (const [path, content] of expected)
    {
        if (path !== ".manifest.json") await atomicWrite(resolved.get(path)!, content);
    }
    for (const path of stalePaths)
    {
        const stats = await lstatIfExists(path);
        if (stats) await fs.unlink(path);
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
