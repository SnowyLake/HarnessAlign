/**
 * Validated write-back for `.halign` sources used by the desktop shell and tests.
 * Encode and validate before `atomicWrite`. Multi-file updates are not a single disk transaction.
 */

import { promises as fs } from "node:fs";
import { join, posix, resolve } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { assertContained, atomicWrite, display, ensureRegularSource, lstatIfExists, reparseError } from "./FsSafe.js";
import { loadAgents, loadConfig, loadLayerOptions, loadRules, loadSharedRules, type SharedRule, validateConfig } from "./Load.js";
import {
    AGENT_NAME,
    type Agent,
    codePointCompare,
    type Config,
    type Harness,
    type HarnessConfig,
    HARNESS_NAME,
    HalignError,
    hasOwn,
    isRecord,
    LAYER_NAME,
    type LayerOption,
    type Metadata,
    normalizedBody,
    type Rule,
    typeText,
    valueText,
} from "./Model.js";

export type { SharedRule };

/** Loaded `.halign` workspace for the desktop editor and tests. */
export interface Workspace
{
    root: string;
    config: Config;
    rootRules: Rule[];
    layerOptions: Record<string, LayerOption[]>;
    sharedRules: SharedRule[];
    agents: Agent[];
}

/** Editor payload for creating or updating a rule source file. */
export interface RuleInput
{
    path: string;
    priority: number;
    targets?: string[];
    body: string;
}

/** Editor payload for creating or updating a layer option source file. */
export interface LayerOptionInput
{
    path: string;
    targets?: string[];
    body: string;
}

/** Sort editable rules by priority and use their paths as a deterministic tie-breaker. */
function sortEditableRules(rules: Rule[]): Rule[]
{
    return rules.sort((left, right) => left.priority - right.priority || codePointCompare(left.path, right.path));
}

/** Build the JSON document written to `config.json`. */
function configDocument(config: Config): Record<string, unknown>
{
    return {
        version: 1,
        name: config.name,
        layers: config.layers.map((layer) => ({ name: layer.name, selected: layer.selected })),
        harnesses: config.harnesses.map((harness) =>
        {
            const document: Record<string, unknown> = {
                name: harness.name,
                config_path: harness.configPath,
                agent_format: harness.agentFormat,
                agent_extension: harness.agentExtension,
            };
            if (harness.instructionsField !== undefined) document.instructions_field = harness.instructionsField;
            return document;
        }),
    };
}

/** Normalize and contain a managed `.halign` relative path. */
function managedRelative(value: string, label: string): string
{
    if (!value || value.includes("\\") || posix.isAbsolute(value) || /^[A-Za-z]:/u.test(value))
    {
        throw new HalignError(`${label}: path must stay inside .halign, got ${valueText(value)}`);
    }
    const parts = value.split("/");
    if (parts.some((part) => !part || part === "." || part === ".."))
    {
        throw new HalignError(`${label}: path must stay inside .halign, got ${valueText(value)}`);
    }
    if (value === ".halign/generated" || value.startsWith(".halign/generated/"))
    {
        throw new HalignError(`${label}: path must stay inside managed .halign sources, got ${valueText(value)}`);
    }
    if (value !== ".halign/config.json" && !value.startsWith(".halign/rules/") && !value.startsWith(".halign/layers/") && !value.startsWith(".halign/agents/"))
    {
        throw new HalignError(`${label}: path must stay inside managed .halign sources, got ${valueText(value)}`);
    }
    return value;
}

/** Resolve a managed source path and ensure it stays inside the config root. */
async function resolveManaged(root: string, relativePath: string, label: string): Promise<string>
{
    const relative = managedRelative(relativePath, label);
    const path = resolve(root, ...relative.split("/"));
    assertContained(root, path, label);
    await ensureRegularSource(root, path);
    return path;
}

/** Reject reparse points from the config root down to `path`. */
async function assertNoReparseTree(root: string, path: string): Promise<void>
{
    const stats = await lstatIfExists(path);
    if (!stats) return;
    if (stats.isSymbolicLink()) throw reparseError(root, path, false);
    if (!stats.isDirectory()) return;
    for (const entry of await fs.readdir(path, { withFileTypes: true }))
    {
        await assertNoReparseTree(root, join(path, entry.name));
    }
}

/** Atomically write a managed source file after reparse checks. */
async function writeManaged(root: string, relativePath: string, content: Buffer): Promise<void>
{
    const path = await resolveManaged(root, relativePath, relativePath);
    const existing = await lstatIfExists(path);
    if (existing?.isSymbolicLink()) throw reparseError(root, path, false);
    if (existing && !existing.isFile()) throw new HalignError(`${relativePath}: managed source must be a file`);
    await atomicWrite(path, content);
}

/** Serialize YAML frontmatter plus a markdown body. */
function serializeFrontmatter(metadata: Record<string, unknown>, body: string, path: string): Buffer
{
    const markdown = normalizedBody(body);
    if (!markdown.trim()) throw new HalignError(`${path}: Markdown body must be non-empty, got ${valueText(body)}`);
    const yamlText = stringifyYaml(metadata, { lineWidth: 0, sortMapEntries: false }).trimEnd();
    return Buffer.from(`---\n${yamlText}\n---\n\n${markdown}`, "utf8");
}

/** Serialize optional layer targets plus a possibly empty Markdown body. */
function serializeLayerOption(targets: string[] | undefined, body: string): Buffer
{
    const markdown = body.trim() ? normalizedBody(body) : "";
    if (targets === undefined) return Buffer.from(markdown, "utf8");
    const yamlText = stringifyYaml({ targets }, { lineWidth: 0, sortMapEntries: false }).trimEnd();
    return Buffer.from(`---\n${yamlText}\n---\n\n${markdown}`, "utf8");
}

/** Require a rule path under the expected `.halign` subtree. */
function assertRulePath(path: string, kind: "root" | "shared"): void
{
    if (!path.endsWith(".md")) throw new HalignError(`${path}: rule path must end with .md`);
    if (kind === "root" && (path.startsWith(".halign/rules/shared/") || !path.startsWith(".halign/rules/")))
    {
        throw new HalignError(`${path}: root rule path must stay under .halign/rules and outside shared`);
    }
    if (kind === "shared" && !path.startsWith(".halign/rules/shared/"))
    {
        throw new HalignError(`${path}: shared rule path must stay under .halign/rules/shared`);
    }
}

/** Classify a root or shared rule path. */
function ruleKind(path: string): "root" | "shared"
{
    if (path.startsWith(".halign/rules/shared/")) return "shared";
    return "root";
}

/** Require a direct option path under one configured layer directory. */
function layerOptionParts(path: string): { layer: string; option: string }
{
    const match = /^\.halign\/layers\/([^/]+)\/([^/]+)\.md$/u.exec(path);
    if (!match || !LAYER_NAME.test(match[1]!) || !LAYER_NAME.test(match[2]!))
    {
        throw new HalignError(`${path}: layer option path must match .halign/layers/<layer>/<option>.md`);
    }
    return { layer: match[1]!, option: match[2]! };
}

/** Require a subagent path under `.halign/agents`. */
function assertAgentPath(path: string): void
{
    if (!/^\.halign\/agents\/[^/]+\.md$/u.test(path))
    {
        throw new HalignError(`${path}: agent path must be a Markdown file directly under .halign/agents`);
    }
}

/** Collect configured harness names. */
function configuredNames(harnesses: HarnessConfig[]): Set<string>
{
    return new Set(harnesses.map((harness) => harness.name));
}

/** Validate optional rule targets against configured harness names. */
function assertTargets(path: string, targets: string[] | undefined, harnesses: HarnessConfig[]): string[] | undefined
{
    if (targets === undefined) return undefined;
    if (targets.length === 0 || new Set(targets).size !== targets.length)
    {
        throw new HalignError(`${path}: targets must be a non-empty unique array, got ${valueText(targets)}`);
    }
    const configured = configuredNames(harnesses);
    const invalid = targets.find((target) => !configured.has(target));
    if (invalid !== undefined)
    {
        throw new HalignError(`${path}: targets may only contain configured harness names, got ${valueText(invalid)}`);
    }
    return targets;
}

/** Validate a subagent payload before writing it. */
function assertAgentInput(agent: Agent, harnesses: HarnessConfig[]): void
{
    assertAgentPath(agent.path);
    if (!agent.name.trim() || !AGENT_NAME.test(agent.name))
    {
        throw new HalignError(`${agent.path}: name must match ${AGENT_NAME.source}, got ${valueText(agent.name)}`);
    }
    if (!agent.description.trim())
    {
        throw new HalignError(`${agent.path}: description must be a non-empty string, got ${valueText(agent.description)}`);
    }
    const harnessConfigs = new Map(harnesses.map((harness) => [harness.name, harness]));
    const keys = Object.keys(agent.harnesses);
    if (keys.length === 0) throw new HalignError(`${agent.path}: at least one configured harness block is required`);
    const invalid = keys.find((name) => !harnessConfigs.has(name));
    if (invalid !== undefined)
    {
        throw new HalignError(`${agent.path}: harnesses may only contain configured harness names, got ${valueText(invalid)}`);
    }
    for (const [name, metadata] of Object.entries(agent.harnesses))
    {
        if (!isRecord(metadata))
        {
            throw new HalignError(`${agent.path}: ${name} metadata must be a mapping, got ${typeText(metadata)}`);
        }
        const harness = harnessConfigs.get(name)!;
        if (harness.instructionsField !== undefined && hasOwn(metadata, harness.instructionsField))
        {
            throw new HalignError(`${agent.path}: ${name}.${harness.instructionsField} is reserved for the Markdown body`);
        }
    }
}

/** Load config, root rules, layer options, shared-rules, and agents from a config root. */
export async function loadWorkspace(rootPath: string): Promise<Workspace>
{
    const root = resolve(rootPath);
    const config = await loadConfig(root);
    const [agents, rules, layerOptions, sharedRules] = await Promise.all([
        loadAgents(root, config.harnesses),
        loadRules(root, config.harnesses),
        loadLayerOptions(root, config),
        loadSharedRules(root),
    ]);
    return { root, config, rootRules: sortEditableRules(rules), layerOptions, sharedRules, agents };
}

/** Atomically write an already validated config document. */
async function writeConfig(root: string, config: Config): Promise<void>
{
    await writeManaged(root, ".halign/config.json", Buffer.from(`${JSON.stringify(configDocument(config), null, 2)}\n`, "utf8"));
}

/** Validate sources and atomically write `config.json`. */
export async function saveConfig(rootPath: string, config: Config): Promise<Config>
{
    const root = resolve(rootPath);
    const validated = validateConfig(configDocument(config));
    await loadLayerOptions(root, validated);
    await writeConfig(root, validated);
    return validated;
}

/** Validate and atomically write a root rule. */
export async function saveRule(rootPath: string, input: RuleInput): Promise<void>
{
    const root = resolve(rootPath);
    const config = await loadConfig(root);
    const path = managedRelative(input.path, input.path);
    const kind = ruleKind(path);
    if (kind === "shared") throw new HalignError(`${path}: shared rules are saved with saveSharedRule`);
    assertRulePath(path, kind);
    if (!Number.isInteger(input.priority) || input.priority < 0)
    {
        throw new HalignError(`${path}: priority must be a non-negative integer, got ${valueText(input.priority)}`);
    }
    const targets = assertTargets(path, input.targets, config.harnesses);
    const metadata: Record<string, unknown> = { priority: input.priority };
    if (targets !== undefined) metadata.targets = targets;
    await writeManaged(root, path, serializeFrontmatter(metadata, input.body, path));
}

/** Validate and atomically write a layer option Markdown file. */
export async function saveLayerOption(rootPath: string, input: LayerOptionInput): Promise<void>
{
    const root = resolve(rootPath);
    const config = await loadConfig(root);
    const path = managedRelative(input.path, input.path);
    const { layer } = layerOptionParts(path);
    if (!config.layers.some((candidate) => candidate.name === layer))
    {
        throw new HalignError(`${path}: layer must be configured, got ${valueText(layer)}`);
    }
    const targets = assertTargets(path, input.targets, config.harnesses);
    await writeManaged(root, path, serializeLayerOption(targets, input.body));
}

/** Validate and atomically write a shared-rule markdown file. */
export async function saveSharedRule(rootPath: string, path: string, body: string): Promise<void>
{
    const root = resolve(rootPath);
    const relative = managedRelative(path, path);
    assertRulePath(relative, "shared");
    await writeManaged(root, relative, Buffer.from(normalizedBody(body), "utf8"));
}

/** Validate and atomically write a subagent source file. */
export async function saveAgent(rootPath: string, agent: Agent): Promise<void>
{
    const root = resolve(rootPath);
    const config = await loadConfig(root);
    const path = managedRelative(agent.path, agent.path);
    const next: Agent = { ...agent, path, body: normalizedBody(agent.body) };
    assertAgentInput(next, config.harnesses);
    await writeManaged(root, path, serializeFrontmatter({
        name: next.name,
        description: next.description,
        harnesses: next.harnesses,
    }, next.body, path));
}

/** Delete a `.halign` source file after containment and reparse checks. */
export async function deleteSource(rootPath: string, relativePath: string): Promise<void>
{
    const root = resolve(rootPath);
    const relative = managedRelative(relativePath, relativePath);
    if (relative === ".halign/config.json") throw new HalignError(`${relative}: config.json cannot be deleted`);
    if (relative.startsWith(".halign/layers/")) throw new HalignError(`${relative}: layer options are deleted with removeLayerOption`);
    const path = await resolveManaged(root, relative, relative);
    const stats = await lstatIfExists(path);
    if (!stats) throw new HalignError(`${relative}: file does not exist`);
    if (stats.isSymbolicLink()) throw reparseError(root, path, false);
    if (!stats.isFile()) throw new HalignError(`${relative}: managed source must be a file`);
    await fs.unlink(path);
}

/** Create a layer with its first empty option and select it. */
export async function addLayer(rootPath: string, name: string, initialOption: string): Promise<Config>
{
    const root = resolve(rootPath);
    const config = await loadConfig(root);
    await loadLayerOptions(root, config);
    if (!LAYER_NAME.test(name)) throw new HalignError(`.halign/config.json: layer name must match ${LAYER_NAME.source}, got ${valueText(name)}`);
    if (!LAYER_NAME.test(initialOption)) throw new HalignError(`.halign/config.json: selected must match ${LAYER_NAME.source}, got ${valueText(initialOption)}`);
    if (config.layers.some((layer) => layer.name.toLowerCase() === name.toLowerCase()))
    {
        throw new HalignError(`.halign/config.json: layer already exists, got ${valueText(name)}`);
    }
    const layersRoot = join(root, ".halign", "layers");
    const directory = join(layersRoot, name);
    await ensureRegularSource(root, directory);
    if (await lstatIfExists(directory)) throw new HalignError(`${display(root, directory)}: path already exists`);
    const next = validateConfig(configDocument({ ...config, layers: [...config.layers, { name, selected: initialOption }] }));
    await fs.mkdir(layersRoot, { recursive: true });
    await fs.mkdir(directory);
    try
    {
        await atomicWrite(join(directory, `${initialOption}.md`), Buffer.alloc(0));
        await writeConfig(root, next);
        return next;
    }
    catch (error)
    {
        await fs.rm(directory, { recursive: true, force: true });
        throw error;
    }
}

/** Remove a layer declaration and its entire validated source directory. */
export async function removeLayer(rootPath: string, name: string): Promise<Config>
{
    const root = resolve(rootPath);
    const config = await loadConfig(root);
    await loadLayerOptions(root, config);
    if (!config.layers.some((layer) => layer.name === name))
    {
        throw new HalignError(`.halign/config.json: layer is not configured, got ${valueText(name)}`);
    }
    const directory = join(root, ".halign", "layers", name);
    await assertNoReparseTree(root, directory);
    const temporary = join(root, ".halign", `.remove-layer-${name}-${process.pid}`);
    if (await lstatIfExists(temporary)) throw new HalignError(`${display(root, temporary)}: temporary path already exists`);
    const next = validateConfig(configDocument({ ...config, layers: config.layers.filter((layer) => layer.name !== name) }));
    await fs.rename(directory, temporary);
    try
    {
        await writeConfig(root, next);
    }
    catch (error)
    {
        await fs.rename(temporary, directory);
        throw error;
    }
    await fs.rm(temporary, { recursive: true, force: true });
    return next;
}

/** Rename a layer directory and cascade its config declaration. */
export async function renameLayer(rootPath: string, from: string, to: string): Promise<Config>
{
    const root = resolve(rootPath);
    const config = await loadConfig(root);
    await loadLayerOptions(root, config);
    if (!config.layers.some((layer) => layer.name === from)) throw new HalignError(`.halign/config.json: layer is not configured, got ${valueText(from)}`);
    if (!LAYER_NAME.test(to)) throw new HalignError(`.halign/config.json: layer name must match ${LAYER_NAME.source}, got ${valueText(to)}`);
    if (from.toLowerCase() !== to.toLowerCase() && config.layers.some((layer) => layer.name.toLowerCase() === to.toLowerCase()))
    {
        throw new HalignError(`.halign/config.json: layer names must be unique without case sensitivity, got ${valueText(to)}`);
    }
    const source = join(root, ".halign", "layers", from);
    const destination = join(root, ".halign", "layers", to);
    await ensureRegularSource(root, destination);
    if (from !== to && await lstatIfExists(destination)) throw new HalignError(`${display(root, destination)}: path already exists`);
    const next = validateConfig(configDocument({
        ...config,
        layers: config.layers.map((layer) => (layer.name === from ? { ...layer, name: to } : layer)),
    }));
    if (source !== destination) await fs.rename(source, destination);
    try
    {
        await writeConfig(root, next);
        return next;
    }
    catch (error)
    {
        if (source !== destination) await fs.rename(destination, source);
        throw error;
    }
}

/** Create an empty option file under an existing layer. */
export async function addLayerOption(rootPath: string, layer: string, option: string): Promise<void>
{
    const root = resolve(rootPath);
    const config = await loadConfig(root);
    const options = await loadLayerOptions(root, config);
    if (!config.layers.some((candidate) => candidate.name === layer)) throw new HalignError(`.halign/config.json: layer is not configured, got ${valueText(layer)}`);
    if (!LAYER_NAME.test(option)) throw new HalignError(`layer option name must match ${LAYER_NAME.source}, got ${valueText(option)}`);
    if (options[layer]!.some((candidate) => candidate.name.toLowerCase() === option.toLowerCase()))
    {
        throw new HalignError(`.halign/layers/${layer}: option already exists, got ${valueText(option)}`);
    }
    await writeManaged(root, `.halign/layers/${layer}/${option}.md`, Buffer.alloc(0));
}

/** Delete a non-selected layer option while preserving the layer invariant. */
export async function removeLayerOption(rootPath: string, layer: string, option: string): Promise<void>
{
    const root = resolve(rootPath);
    const config = await loadConfig(root);
    const options = await loadLayerOptions(root, config);
    const layerConfig = config.layers.find((candidate) => candidate.name === layer);
    if (!layerConfig) throw new HalignError(`.halign/config.json: layer is not configured, got ${valueText(layer)}`);
    const layerOptions = options[layer]!;
    if (!layerOptions.some((candidate) => candidate.name === option)) throw new HalignError(`.halign/layers/${layer}: option does not exist, got ${valueText(option)}`);
    if (layerOptions.length === 1) throw new HalignError(`.halign/layers/${layer}: the final layer option cannot be removed`);
    if (layerConfig.selected === option) throw new HalignError(`.halign/config.json: selected layer option cannot be removed, got ${valueText(option)}`);
    await fs.unlink(join(root, ".halign", "layers", layer, `${option}.md`));
}

/** Rename a layer option and cascade the saved selection when necessary. */
export async function renameLayerOption(rootPath: string, layer: string, from: string, to: string): Promise<Config>
{
    const root = resolve(rootPath);
    const config = await loadConfig(root);
    const options = await loadLayerOptions(root, config);
    const layerConfig = config.layers.find((candidate) => candidate.name === layer);
    if (!layerConfig) throw new HalignError(`.halign/config.json: layer is not configured, got ${valueText(layer)}`);
    if (!options[layer]!.some((candidate) => candidate.name === from)) throw new HalignError(`.halign/layers/${layer}: option does not exist, got ${valueText(from)}`);
    if (!LAYER_NAME.test(to)) throw new HalignError(`layer option name must match ${LAYER_NAME.source}, got ${valueText(to)}`);
    if (from.toLowerCase() !== to.toLowerCase() && options[layer]!.some((candidate) => candidate.name.toLowerCase() === to.toLowerCase()))
    {
        throw new HalignError(`.halign/layers/${layer}: option names must be unique without case sensitivity, got ${valueText(to)}`);
    }
    const source = join(root, ".halign", "layers", layer, `${from}.md`);
    const destination = join(root, ".halign", "layers", layer, `${to}.md`);
    await ensureRegularSource(root, destination);
    if (source !== destination && await lstatIfExists(destination)) throw new HalignError(`${display(root, destination)}: path already exists`);
    const next = validateConfig(configDocument({
        ...config,
        layers: config.layers.map((candidate) => candidate.name === layer && candidate.selected === from ? { ...candidate, selected: to } : candidate),
    }));
    if (source !== destination) await fs.rename(source, destination);
    try
    {
        if (layerConfig.selected === from) await writeConfig(root, next);
        return next;
    }
    catch (error)
    {
        if (source !== destination) await fs.rename(destination, source);
        throw error;
    }
}

/** Replace a harness name inside a rule target list. */
function replaceHarnessName(targets: Harness[], from: string, to: string): Harness[]
{
    return targets.map((target) => (target === from ? to : target));
}

/** Rename a harness and cascade rule targets plus agent metadata keys. */
export async function renameHarness(rootPath: string, from: string, to: string): Promise<void>
{
    const root = resolve(rootPath);
    const config = await loadConfig(root);
    if (!config.harnesses.some((harness) => harness.name === from))
    {
        throw new HalignError(`.halign/config.json: harness is not configured, got ${valueText(from)}`);
    }
    if (!HARNESS_NAME.test(to))
    {
        throw new HalignError(`.halign/config.json: name must match ${HARNESS_NAME.source}, got ${valueText(to)}`);
    }
    if (from.toLowerCase() !== to.toLowerCase() && config.harnesses.some((harness) => harness.name.toLowerCase() === to.toLowerCase()))
    {
        throw new HalignError(`.halign/config.json: harness names must be unique without case sensitivity, got ${valueText(to)}`);
    }
    const nextConfig: Config = {
        ...config,
        harnesses: config.harnesses.map((harness) => (harness.name === from ? { ...harness, name: to } : harness)),
    };
    validateConfig(configDocument(nextConfig));
    const [rules, layerOptions, agents] = await Promise.all([
        loadRules(root, config.harnesses),
        loadLayerOptions(root, config),
        loadAgents(root, config.harnesses),
    ]);
    const nextRules = rules.map((rule) => ({ ...rule, targets: replaceHarnessName(rule.targets, from, to) }));
    const nextLayerOptions = Object.values(layerOptions).flat().map((option) => ({ ...option, targets: replaceHarnessName(option.targets, from, to) }));
    const nextAgents = agents.map((agent) =>
    {
        const harnesses: Record<string, Metadata> = {};
        for (const [name, metadata] of Object.entries(agent.harnesses))
        {
            harnesses[name === from ? to : name] = metadata;
        }
        return { ...agent, harnesses };
    });
    for (const agent of nextAgents) assertAgentInput(agent, nextConfig.harnesses);
    await writeConfig(root, nextConfig);
    for (const rule of nextRules) await saveRule(root, rule);
    for (const option of nextLayerOptions) await saveLayerOption(root, option);
    for (const agent of nextAgents) await saveAgent(root, agent);
}

/** Remove a harness after it is unused by rules and agents. */
export async function removeHarness(rootPath: string, name: string): Promise<void>
{
    const root = resolve(rootPath);
    const config = await loadConfig(root);
    if (!config.harnesses.some((harness) => harness.name === name))
    {
        throw new HalignError(`.halign/config.json: harness is not configured, got ${valueText(name)}`);
    }
    if (config.harnesses.length === 1)
    {
        throw new HalignError(`.halign/config.json: harnesses must be a non-empty mapping array, got []`);
    }
    const nextConfig: Config = { ...config, harnesses: config.harnesses.filter((harness) => harness.name !== name) };
    validateConfig(configDocument(nextConfig));
    const [rules, layerOptions, agents] = await Promise.all([
        loadRules(root, config.harnesses),
        loadLayerOptions(root, config),
        loadAgents(root, config.harnesses),
    ]);
    const nextRules: RuleInput[] = [];
    for (const rule of rules)
    {
        const targets = rule.targets.filter((target) => target !== name);
        if (targets.length === 0)
        {
            throw new HalignError(`${rule.path}: targets would be empty after removing ${valueText(name)}`);
        }
        nextRules.push({ ...rule, targets });
    }
    const nextLayerOptions: LayerOptionInput[] = [];
    for (const option of Object.values(layerOptions).flat())
    {
        const targets = option.targets.filter((target) => target !== name);
        if (targets.length === 0)
        {
            throw new HalignError(`${option.path}: targets would be empty after removing ${valueText(name)}`);
        }
        nextLayerOptions.push({ ...option, targets });
    }
    const nextAgents: Agent[] = [];
    for (const agent of agents)
    {
        const harnesses = { ...agent.harnesses };
        delete harnesses[name];
        if (Object.keys(harnesses).length === 0)
        {
            throw new HalignError(`${agent.path}: at least one configured harness block is required`);
        }
        nextAgents.push({ ...agent, harnesses });
    }
    await writeConfig(root, nextConfig);
    for (const rule of nextRules) await saveRule(root, rule);
    for (const option of nextLayerOptions) await saveLayerOption(root, option);
    for (const agent of nextAgents) await saveAgent(root, agent);
}

/** Add a harness declaration to config. */
export async function addHarness(rootPath: string, harness: HarnessConfig): Promise<Config>
{
    const root = resolve(rootPath);
    const config = await loadConfig(root);
    return saveConfig(root, { ...config, harnesses: [...config.harnesses, harness] });
}
