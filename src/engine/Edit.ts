/**
 * Validated write-back for `.harness-align` sources used by the desktop shell and tests.
 * Encode and validate before `atomicWrite`. Multi-file updates are not a single disk transaction.
 */

import { promises as fs } from "node:fs";
import { join, posix, resolve } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { assertContained, assertNoReparseTree, atomicWrite, display, ensureRegularSource, lstatIfExists, reparseError, resolveUserHome } from "./FsSafe.js";
import { loadAgents, loadConfig, loadLayerOptions, loadRules, loadSharedRules, type SharedRule, validateConfig } from "./Load.js";
import {
    AGENT_NAME,
    type Agent,
    assertWindowsSafeName,
    codePointCompare,
    type Config,
    errorText,
    type Harness,
    type HarnessConfig,
    HalignError,
    hasOwn,
    isRecord,
    LAYER_NAME,
    type LayerOption,
    type Metadata,
    normalizedBody,
    type ProjectSkill,
    type Rule,
    typeText,
    valueText,
} from "./Model.js";
import { importUserSkills as importUserSkillsEngine, listUserSkills as listUserSkillsEngine, loadSkills, parseGitHubSkillSource, removeSkill as removeSkillEngine } from "./Skills.js";

export type { SharedRule };
export { listUserSkillsEngine as listUserSkills, importUserSkillsEngine as importUserSkills, removeSkillEngine as removeSkill };

/** Default `.harness-align/config.json` written when the user workspace does not exist yet. */
const DEFAULT_USER_CONFIG = {
    version: 1,
    name: "AGENTS",
    layers: [],
    harnesses: [
        { name: "codex", config_path: ".codex", agent_format: "toml", agent_extension: "toml", instructions_field: "developer_instructions" },
        { name: "cursor", config_path: ".cursor", agent_format: "yaml", agent_extension: "md" },
        { name: "opencode", config_path: ".config/opencode", agent_format: "yaml", agent_extension: "md" },
    ],
};

/** Loaded `.harness-align` workspace for the desktop editor and tests. */
export interface Workspace
{
    config: Config;
    rootRules: Rule[];
    layerOptions: Record<string, LayerOption[]>;
    sharedRules: SharedRule[];
    agents: Agent[];
    skills: ProjectSkill[];
}

/** Editor payload for creating or updating a rule source file. */
export interface RuleInput
{
    path: string;
    priority: number;
    targets: string[];
    body: string;
}

/** Editor payload for creating or updating a layer option source file. */
export interface LayerOptionInput
{
    path: string;
    targets: string[];
    body: string;
}

/** Sort editable rules by priority and use their paths as a deterministic tie-breaker. */
function sortEditableRules(rules: Rule[]): Rule[]
{
    return rules.slice().sort((left, right) => left.priority - right.priority || codePointCompare(left.path, right.path));
}

/** Build the JSON document written to `config.json`. */
function configDocument(config: Config): Record<string, unknown>
{
    const document: Record<string, unknown> = {
        version: 1,
        name: config.name,
        layers: config.layers.map((layer) => ({ name: layer.name, selected: layer.selected })),
        harnesses: config.harnesses.map((harness) =>
        {
            const item: Record<string, unknown> = {
                name: harness.name,
                config_path: harness.configPath,
                agent_format: harness.agentFormat,
                agent_extension: harness.agentExtension,
            };
            if (harness.instructionsField !== undefined) item.instructions_field = harness.instructionsField;
            return item;
        }),
    };
    if (config.skillSources.length > 0)
    {
        document.skill_sources = config.skillSources.map((source) => ({
            owner: source.owner,
            name: source.name,
            branch: source.branch,
        }));
    }
    return document;
}

/** Normalize and contain a managed `.harness-align` relative path. */
function managedRelative(value: string, label: string): string
{
    if (!value || value.includes("\\") || posix.isAbsolute(value) || /^[A-Za-z]:/u.test(value))
    {
        throw new HalignError(`${label}: path must stay inside .harness-align, got ${valueText(value)}`);
    }
    const parts = value.split("/");
    if (parts.some((part) => !part || part === "." || part === ".."))
    {
        throw new HalignError(`${label}: path must stay inside .harness-align, got ${valueText(value)}`);
    }
    for (const part of parts) assertWindowsSafeName(part, label);
    if (value === ".harness-align/generated" || value.startsWith(".harness-align/generated/"))
    {
        throw new HalignError(`${label}: path must stay inside managed .harness-align sources, got ${valueText(value)}`);
    }
    if (value !== ".harness-align/config.json" && !value.startsWith(".harness-align/rules/") && !value.startsWith(".harness-align/layers/") && !value.startsWith(".harness-align/agents/") && !value.startsWith(".harness-align/skills/"))
    {
        throw new HalignError(`${label}: path must stay inside managed .harness-align sources, got ${valueText(value)}`);
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

/** Atomically write a managed source file after reparse checks. */
async function writeManaged(root: string, relativePath: string, content: Buffer): Promise<void>
{
    const path = await resolveManaged(root, relativePath, relativePath);
    const existing = await lstatIfExists(path);
    if (existing?.isSymbolicLink()) throw reparseError(root, path, false);
    if (existing && !existing.isFile()) throw new HalignError(`${relativePath}: managed source must be a file`);
    await atomicWrite(path, content);
}

/** Preflight a source batch and restore completed writes if a later write fails. */
async function writeManagedBatch(root: string, writes: Array<{ path: string; content: Buffer }>): Promise<void>
{
    const prepared = await Promise.all(writes.map(async (write) => ({
        ...write,
        original: await fs.readFile(await resolveManaged(root, write.path, write.path)),
    })));
    const written: typeof prepared = [];
    try
    {
        for (const write of prepared)
        {
            await writeManaged(root, write.path, write.content);
            written.push(write);
        }
    }
    catch (error)
    {
        const failures: string[] = [];
        for (const write of written.reverse())
        {
            try
            {
                await writeManaged(root, write.path, write.original);
            }
            catch (rollbackError)
            {
                failures.push(`${write.path}: ${errorText(rollbackError)}`);
            }
        }
        if (failures.length > 0) throw new HalignError(`Source update failed: ${errorText(error)}; rollback failed: ${failures.join("; ")}`);
        throw error;
    }
}

/** Serialize YAML frontmatter plus a markdown body. */
function serializeFrontmatter(metadata: Record<string, unknown>, body: string, path: string): Buffer
{
    const markdown = normalizedBody(body);
    if (!markdown.trim()) throw new HalignError(`${path}: Markdown body must be non-empty, got ${valueText(body)}`);
    const yamlText = stringifyYaml(metadata, { lineWidth: 0, sortMapEntries: false }).trimEnd();
    return Buffer.from(`---\n${yamlText}\n---\n\n${markdown}`, "utf8");
}

/** Serialize layer targets plus a possibly empty Markdown body. */
function serializeLayerOption(targets: string[], body: string): Buffer
{
    const markdown = body.trim() ? normalizedBody(body) : "";
    const yamlText = stringifyYaml({ targets }, { lineWidth: 0, sortMapEntries: false }).trimEnd();
    return Buffer.from(`---\n${yamlText}\n---\n\n${markdown}`, "utf8");
}

/** Require a rule path under the expected `.harness-align` subtree. */
function assertRulePath(path: string, kind: "root" | "shared"): void
{
    if (!path.endsWith(".md")) throw new HalignError(`${path}: rule path must end with .md`);
    const comparison = process.platform === "win32" ? path.toLowerCase() : path;
    if (kind === "root" && (comparison.startsWith(".harness-align/rules/shared/") || !comparison.startsWith(".harness-align/rules/")))
    {
        throw new HalignError(`${path}: root rule path must stay under .harness-align/rules and outside shared`);
    }
    if (kind === "shared" && !comparison.startsWith(".harness-align/rules/shared/"))
    {
        throw new HalignError(`${path}: shared rule path must stay under .harness-align/rules/shared`);
    }
}

/** Classify a root or shared rule path. */
function ruleKind(path: string): "root" | "shared"
{
    const comparison = process.platform === "win32" ? path.toLowerCase() : path;
    if (comparison.startsWith(".harness-align/rules/shared/")) return "shared";
    return "root";
}

/** Classify editable rule and agent source paths. */
function editableSourceKind(path: string): "root-rule" | "shared-rule" | "agent" | undefined
{
    if (path.startsWith(".harness-align/agents/")) return "agent";
    if (ruleKind(path) === "shared") return "shared-rule";
    if (path.startsWith(".harness-align/rules/")) return "root-rule";
    return undefined;
}

/** Return whether a discovered layer directory exists. */
function hasCatalogLayer(options: Record<string, LayerOption[]>, name: string): boolean
{
    return options[name] !== undefined;
}

/** Return whether any catalog layer matches `name` without case sensitivity. */
function catalogHasFoldedName(options: Record<string, LayerOption[]>, name: string): boolean
{
    const folded = name.toLowerCase();
    return Object.keys(options).some((existing) => existing.toLowerCase() === folded);
}

/** Require a direct option path under one layer directory. */
function layerOptionParts(path: string): { layer: string; option: string }
{
    const match = /^\.harness-align\/layers\/([^/]+)\/([^/]+)\.md$/u.exec(path);
    if (!match || !LAYER_NAME.test(match[1]!) || !LAYER_NAME.test(match[2]!))
    {
        throw new HalignError(`${path}: layer option path must match .harness-align/layers/<layer>/<option>.md`);
    }
    return { layer: match[1]!, option: match[2]! };
}

/** Require a subagent path under `.harness-align/agents`. */
function assertAgentPath(path: string): void
{
    if (!/^\.harness-align\/agents\/[^/]+\.md$/u.test(path))
    {
        throw new HalignError(`${path}: agent path must be a Markdown file directly under .harness-align/agents`);
    }
}

/** Collect configured harness names. */
function configuredNames(harnesses: HarnessConfig[]): Set<string>
{
    return new Set(harnesses.map((harness) => harness.name));
}

/** Validate a target allowlist against configured harness names. */
function assertTargets(path: string, targets: string[], harnesses: HarnessConfig[]): string[]
{
    if (!Array.isArray(targets) || targets.some((target) => typeof target !== "string"))
    {
        throw new HalignError(`${path}: targets must be an array of configured harness names, got ${valueText(targets)}`);
    }
    if (new Set(targets).size !== targets.length)
    {
        throw new HalignError(`${path}: targets must be a unique array, got ${valueText(targets)}`);
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
    assertWindowsSafeName(agent.name, agent.path);
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

/** Load config, root rules, layer options, shared-rules, agents, and skills from a config root. */
export async function loadWorkspace(rootPath: string): Promise<Workspace>
{
    const root = resolve(rootPath);
    const config = await loadConfig(root);
    const [agents, rules, layerOptions, sharedRules, skills] = await Promise.all([
        loadAgents(root, config.harnesses),
        loadRules(root, config.harnesses),
        loadLayerOptions(root, config),
        loadSharedRules(root),
        loadSkills(root),
    ]);
    return { config, rootRules: sortEditableRules(rules), layerOptions, sharedRules, agents, skills };
}

/** Initialize the fixed user workspace, moving a safe legacy directory only when the destination is absent. */
export async function ensureUserWorkspace(userProfile = process.env.USERPROFILE): Promise<string>
{
    const root = resolveUserHome(userProfile);
    const homeStats = await lstatIfExists(root);
    if (!homeStats) throw new HalignError(`USERPROFILE must be an existing directory, got ${valueText(root)}`);
    if (homeStats.isSymbolicLink()) throw reparseError(root, root, false);
    if (!homeStats.isDirectory()) throw new HalignError(`USERPROFILE must be a directory, got ${valueText(root)}`);
    const halign = join(root, ".harness-align");
    const stats = await lstatIfExists(halign);
    if (stats?.isSymbolicLink()) throw reparseError(root, halign, false);
    if (stats && !stats.isDirectory()) throw new HalignError(".harness-align: expected a directory");
    if (!stats)
    {
        const legacy = join(root, ".halign");
        const legacyStats = await lstatIfExists(legacy);
        if (legacyStats)
        {
            assertContained(root, legacy, "legacy workspace");
            assertContained(root, halign, "workspace migration destination");
            await assertNoReparseTree(root, legacy);
            if (!legacyStats.isDirectory()) throw new HalignError(`${legacy}: expected a directory for migration`);
            await fs.rename(legacy, halign);
        }
    }
    const configPath = join(halign, "config.json");
    if (!(await lstatIfExists(configPath)))
    {
        await fs.mkdir(join(halign, "rules", "shared"), { recursive: true });
        await writeConfig(root, validateConfig(DEFAULT_USER_CONFIG));
    }
    return root;
}

/** Atomically write an already validated config document. */
async function writeConfig(root: string, config: Config): Promise<void>
{
    await writeManaged(root, ".harness-align/config.json", Buffer.from(`${JSON.stringify(configDocument(config), null, 2)}\n`, "utf8"));
}

/** Validate sources and atomically write `config.json`. */
export async function saveConfig(rootPath: string, config: Config): Promise<Config>
{
    const root = resolve(rootPath);
    const validated = validateConfig(configDocument(config));
    await Promise.all([loadLayerOptions(root, validated), loadRules(root, validated.harnesses), loadAgents(root, validated.harnesses)]);
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
    await writeManaged(root, path, serializeFrontmatter({ priority: input.priority, targets }, input.body, path));
}

/** Validate and atomically write a layer option Markdown file. */
export async function saveLayerOption(rootPath: string, input: LayerOptionInput): Promise<void>
{
    const root = resolve(rootPath);
    const config = await loadConfig(root);
    const path = managedRelative(input.path, input.path);
    const { layer } = layerOptionParts(path);
    const directory = join(root, ".harness-align", "layers", layer);
    await ensureRegularSource(root, directory);
    const stats = await lstatIfExists(directory);
    if (!stats?.isDirectory())
    {
        throw new HalignError(`${path}: layer does not exist, got ${valueText(layer)}`);
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

/** Delete a `.harness-align` source file after containment and reparse checks. */
export async function deleteSource(rootPath: string, relativePath: string): Promise<void>
{
    const root = resolve(rootPath);
    const relative = managedRelative(relativePath, relativePath);
    if (relative === ".harness-align/config.json") throw new HalignError(`${relative}: config.json cannot be deleted`);
    if (relative.startsWith(".harness-align/layers/")) throw new HalignError(`${relative}: layer options are deleted with removeLayerOption`);
    if (relative.startsWith(".harness-align/skills/")) throw new HalignError(`${relative}: skills are deleted with removeSkill`);
    const path = await resolveManaged(root, relative, relative);
    const stats = await lstatIfExists(path);
    if (!stats) throw new HalignError(`${relative}: file does not exist`);
    if (stats.isSymbolicLink()) throw reparseError(root, path, false);
    if (!stats.isFile()) throw new HalignError(`${relative}: managed source must be a file`);
    await fs.unlink(path);
}

/** Atomically move one rule or agent Markdown source within its source kind. */
export async function renameSource(rootPath: string, from: string, to: string): Promise<void>
{
    const root = resolve(rootPath);
    const sourceRelative = managedRelative(from, from);
    const destinationRelative = managedRelative(to, to);
    const sourceKind = editableSourceKind(sourceRelative);
    const destinationKind = editableSourceKind(destinationRelative);
    if (!sourceKind || sourceKind !== destinationKind)
    {
        throw new HalignError(`${from}: source rename must stay within one root-rule, shared-rule, or agent type, got ${valueText(to)}`);
    }
    if (sourceKind === "agent")
    {
        assertAgentPath(sourceRelative);
        assertAgentPath(destinationRelative);
    }
    else
    {
        assertRulePath(sourceRelative, sourceKind === "shared-rule" ? "shared" : "root");
        assertRulePath(destinationRelative, sourceKind === "shared-rule" ? "shared" : "root");
    }
    const source = await resolveManaged(root, sourceRelative, sourceRelative);
    const destination = await resolveManaged(root, destinationRelative, destinationRelative);
    const sourceStats = await lstatIfExists(source);
    if (!sourceStats) throw new HalignError(`${sourceRelative}: file does not exist`);
    if (sourceStats.isSymbolicLink()) throw reparseError(root, source, false);
    if (!sourceStats.isFile()) throw new HalignError(`${sourceRelative}: managed source must be a file`);
    if (await lstatIfExists(destination)) throw new HalignError(`${destinationRelative}: destination already exists`);
    await fs.rename(source, destination);
}

/** Create an empty catalog layer without adding it to the project selection. */
export async function addLayer(rootPath: string, name: string): Promise<Config>
{
    const root = resolve(rootPath);
    const config = await loadConfig(root);
    const options = await loadLayerOptions(root, config);
    if (!LAYER_NAME.test(name)) throw new HalignError(`.harness-align/layers/${name}: layer name must match ${LAYER_NAME.source}, got ${valueText(name)}`);
    assertWindowsSafeName(name, `.harness-align/layers/${name}`);
    if (catalogHasFoldedName(options, name))
    {
        throw new HalignError(`.harness-align/layers/${name}: layer already exists, got ${valueText(name)}`);
    }
    const layersRoot = join(root, ".harness-align", "layers");
    const directory = join(layersRoot, name);
    await ensureRegularSource(root, directory);
    if (await lstatIfExists(directory)) throw new HalignError(`${display(root, directory)}: path already exists`);
    await fs.mkdir(layersRoot, { recursive: true });
    await fs.mkdir(directory);
    return config;
}

/** Remove a layer directory and drop it from the project selection when present. */
export async function removeLayer(rootPath: string, name: string): Promise<Config>
{
    const root = resolve(rootPath);
    const config = await loadConfig(root);
    const options = await loadLayerOptions(root, config);
    if (!hasCatalogLayer(options, name))
    {
        throw new HalignError(`.harness-align/layers/${name}: layer does not exist, got ${valueText(name)}`);
    }
    const directory = join(root, ".harness-align", "layers", name);
    await assertNoReparseTree(root, directory);
    const temporary = join(root, ".harness-align", `.remove-layer-${name}-${process.pid}`);
    if (await lstatIfExists(temporary)) throw new HalignError(`${display(root, temporary)}: temporary path already exists`);
    const nextLayers = config.layers.filter((layer) => layer.name !== name);
    const next = nextLayers.length === config.layers.length
        ? config
        : validateConfig(configDocument({ ...config, layers: nextLayers }));
    await fs.rename(directory, temporary);
    try
    {
        if (next !== config) await writeConfig(root, next);
    }
    catch (error)
    {
        await fs.rename(temporary, directory);
        throw error;
    }
    await fs.rm(temporary, { recursive: true, force: true });
    return next;
}

/** Rename a layer directory and cascade its project selection when present. */
export async function renameLayer(rootPath: string, from: string, to: string): Promise<Config>
{
    const root = resolve(rootPath);
    const config = await loadConfig(root);
    const options = await loadLayerOptions(root, config);
    if (!hasCatalogLayer(options, from)) throw new HalignError(`.harness-align/layers/${from}: layer does not exist, got ${valueText(from)}`);
    if (!LAYER_NAME.test(to)) throw new HalignError(`.harness-align/layers/${to}: layer name must match ${LAYER_NAME.source}, got ${valueText(to)}`);
    assertWindowsSafeName(to, `.harness-align/layers/${to}`);
    if (from.toLowerCase() !== to.toLowerCase() && catalogHasFoldedName(options, to))
    {
        throw new HalignError(`.harness-align/layers/${to}: layer names must be unique without case sensitivity, got ${valueText(to)}`);
    }
    const source = join(root, ".harness-align", "layers", from);
    const destination = join(root, ".harness-align", "layers", to);
    await ensureRegularSource(root, source);
    await ensureRegularSource(root, destination);
    if (from !== to && await lstatIfExists(destination)) throw new HalignError(`${display(root, destination)}: path already exists`);
    const nextLayers = config.layers.map((layer) => (layer.name === from ? { ...layer, name: to } : layer));
    const next = nextLayers.some((layer, index) => layer !== config.layers[index])
        ? validateConfig(configDocument({ ...config, layers: nextLayers }))
        : config;
    if (source !== destination) await fs.rename(source, destination);
    try
    {
        if (next !== config) await writeConfig(root, next);
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
    if (!hasCatalogLayer(options, layer)) throw new HalignError(`.harness-align/layers/${layer}: layer does not exist, got ${valueText(layer)}`);
    if (!LAYER_NAME.test(option)) throw new HalignError(`layer option name must match ${LAYER_NAME.source}, got ${valueText(option)}`);
    assertWindowsSafeName(option, `layer option ${option}`);
    if (options[layer]!.some((candidate) => candidate.name.toLowerCase() === option.toLowerCase()))
    {
        throw new HalignError(`.harness-align/layers/${layer}: option already exists, got ${valueText(option)}`);
    }
    await writeManaged(root, `.harness-align/layers/${layer}/${option}.md`, Buffer.alloc(0));
}

/** Delete a non-selected layer option, allowing an unconfigured layer to become empty. */
export async function removeLayerOption(rootPath: string, layer: string, option: string): Promise<void>
{
    const root = resolve(rootPath);
    const config = await loadConfig(root);
    const options = await loadLayerOptions(root, config);
    if (!hasCatalogLayer(options, layer)) throw new HalignError(`.harness-align/layers/${layer}: layer does not exist, got ${valueText(layer)}`);
    const layerConfig = config.layers.find((candidate) => candidate.name === layer);
    const layerOptions = options[layer]!;
    if (!layerOptions.some((candidate) => candidate.name === option)) throw new HalignError(`.harness-align/layers/${layer}: option does not exist, got ${valueText(option)}`);
    if (layerConfig?.selected === option) throw new HalignError(`.harness-align/config.json: selected layer option cannot be removed, got ${valueText(option)}`);
    const relative = `.harness-align/layers/${layer}/${option}.md`;
    const path = await resolveManaged(root, relative, relative);
    const stats = await lstatIfExists(path);
    if (!stats) throw new HalignError(`${relative}: file does not exist`);
    if (stats.isSymbolicLink()) throw reparseError(root, path, false);
    if (!stats.isFile()) throw new HalignError(`${relative}: managed source must be a file`);
    await fs.unlink(path);
}

/** Rename a layer option and cascade the saved selection when necessary. */
export async function renameLayerOption(rootPath: string, layer: string, from: string, to: string): Promise<Config>
{
    const root = resolve(rootPath);
    const config = await loadConfig(root);
    const options = await loadLayerOptions(root, config);
    if (!hasCatalogLayer(options, layer)) throw new HalignError(`.harness-align/layers/${layer}: layer does not exist, got ${valueText(layer)}`);
    const layerConfig = config.layers.find((candidate) => candidate.name === layer);
    if (!options[layer]!.some((candidate) => candidate.name === from)) throw new HalignError(`.harness-align/layers/${layer}: option does not exist, got ${valueText(from)}`);
    if (!LAYER_NAME.test(to)) throw new HalignError(`layer option name must match ${LAYER_NAME.source}, got ${valueText(to)}`);
    assertWindowsSafeName(to, `layer option ${to}`);
    if (from.toLowerCase() !== to.toLowerCase() && options[layer]!.some((candidate) => candidate.name.toLowerCase() === to.toLowerCase()))
    {
        throw new HalignError(`.harness-align/layers/${layer}: option names must be unique without case sensitivity, got ${valueText(to)}`);
    }
    const source = join(root, ".harness-align", "layers", layer, `${from}.md`);
    const destination = join(root, ".harness-align", "layers", layer, `${to}.md`);
    await ensureRegularSource(root, source);
    await ensureRegularSource(root, destination);
    if (source !== destination && await lstatIfExists(destination)) throw new HalignError(`${display(root, destination)}: path already exists`);
    const next = validateConfig(configDocument({
        ...config,
        layers: config.layers.map((candidate) => candidate.name === layer && candidate.selected === from ? { ...candidate, selected: to } : candidate),
    }));
    if (source !== destination) await fs.rename(source, destination);
    try
    {
        if (layerConfig?.selected === from) await writeConfig(root, next);
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

/** Update a harness and restore original sources if any cascaded write fails. */
export async function updateHarness(rootPath: string, from: string, harness: HarnessConfig): Promise<Config>
{
    const root = resolve(rootPath);
    const config = await loadConfig(root);
    const existing = config.harnesses.find((candidate) => candidate.name === from);
    if (!existing)
    {
        throw new HalignError(`.harness-align/config.json: harness is not configured, got ${valueText(from)}`);
    }
    const nextConfig = validateConfig(configDocument({
        ...config,
        harnesses: config.harnesses.map((candidate) => (candidate.name === from ? harness : candidate)),
    }));
    const [rules, layerOptions, agents] = await Promise.all([
        loadRules(root, config.harnesses),
        loadLayerOptions(root, config),
        loadAgents(root, config.harnesses),
    ]);
    const nextRules = rules.map((rule) => ({ ...rule, targets: replaceHarnessName(rule.targets, from, harness.name) }));
    const nextLayerOptions = Object.values(layerOptions).flat().map((option) => ({ ...option, targets: replaceHarnessName(option.targets, from, harness.name) }));
    const nextAgents = agents.map((agent) =>
    {
        const harnesses: Record<string, Metadata> = {};
        for (const [name, metadata] of Object.entries(agent.harnesses))
        {
            harnesses[name === from ? harness.name : name] = metadata;
        }
        return { ...agent, harnesses };
    });
    const writes: Array<{ path: string; content: Buffer }> = [{
        path: ".harness-align/config.json",
        content: Buffer.from(`${JSON.stringify(configDocument(nextConfig), null, 2)}\n`, "utf8"),
    }];
    for (const rule of nextRules) assertTargets(rule.path, rule.targets, nextConfig.harnesses);
    for (const option of nextLayerOptions) assertTargets(option.path, option.targets, nextConfig.harnesses);
    for (const agent of nextAgents) assertAgentInput(agent, nextConfig.harnesses);
    if (from !== harness.name)
    {
        for (const rule of nextRules)
        {
            writes.push({ path: rule.path, content: serializeFrontmatter({ priority: rule.priority, targets: rule.targets }, rule.body, rule.path) });
        }
        for (const option of nextLayerOptions)
        {
            writes.push({ path: option.path, content: serializeLayerOption(option.targets, option.body) });
        }
        for (const agent of nextAgents)
        {
            writes.push({
                path: agent.path,
                content: serializeFrontmatter({ name: agent.name, description: agent.description, harnesses: agent.harnesses }, agent.body, agent.path),
            });
        }
    }
    await writeManagedBatch(root, writes);
    return nextConfig;
}

/** Remove a harness and cascade target allowlists plus agent metadata. */
export async function removeHarness(rootPath: string, name: string): Promise<void>
{
    const root = resolve(rootPath);
    const config = await loadConfig(root);
    if (!config.harnesses.some((harness) => harness.name === name))
    {
        throw new HalignError(`.harness-align/config.json: harness is not configured, got ${valueText(name)}`);
    }
    if (config.harnesses.length === 1)
    {
        throw new HalignError(`.harness-align/config.json: harnesses must be a non-empty mapping array, got []`);
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
        nextRules.push({ ...rule, targets });
    }
    const nextLayerOptions: LayerOptionInput[] = [];
    for (const option of Object.values(layerOptions).flat())
    {
        const targets = option.targets.filter((target) => target !== name);
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
    for (const agent of nextAgents) assertAgentInput(agent, nextConfig.harnesses);
    await writeManagedBatch(root, [
        { path: ".harness-align/config.json", content: Buffer.from(`${JSON.stringify(configDocument(nextConfig), null, 2)}\n`, "utf8") },
        ...nextRules.map((rule) => ({ path: rule.path, content: serializeFrontmatter({ priority: rule.priority, targets: rule.targets }, rule.body, rule.path) })),
        ...nextLayerOptions.map((option) => ({ path: option.path, content: serializeLayerOption(option.targets, option.body) })),
        ...nextAgents.map((agent) => ({ path: agent.path,
            content: serializeFrontmatter({ name: agent.name, description: agent.description, harnesses: agent.harnesses }, agent.body, agent.path) })),
    ]);
}

/** Add a harness declaration to config. */
export async function addHarness(rootPath: string, harness: HarnessConfig): Promise<Config>
{
    const root = resolve(rootPath);
    const config = await loadConfig(root);
    return saveConfig(root, { ...config, harnesses: [...config.harnesses, harness] });
}

/** Register a GitHub skill source URL in config. */
export async function addSkillSource(rootPath: string, input: { url: string; branch?: string }): Promise<Config>
{
    const root = resolve(rootPath);
    const config = await loadConfig(root);
    const source = input.branch === undefined
        ? parseGitHubSkillSource(input.url)
        : parseGitHubSkillSource(input.url, input.branch);
    const key = `${source.owner.toLowerCase()}/${source.name.toLowerCase()}`;
    if (config.skillSources.some((item) => `${item.owner.toLowerCase()}/${item.name.toLowerCase()}` === key))
    {
        throw new HalignError(`.harness-align/config.json: skill_sources owner/name must be unique without case sensitivity, got ${valueText(`${source.owner}/${source.name}`)}`);
    }
    return saveConfig(root, { ...config, skillSources: [...config.skillSources, source] });
}

/** Remove a registered GitHub skill source from config. */
export async function removeSkillSource(rootPath: string, owner: string, name: string): Promise<Config>
{
    const root = resolve(rootPath);
    const config = await loadConfig(root);
    const nextSources = config.skillSources.filter((source) =>
        !(source.owner.toLowerCase() === owner.toLowerCase() && source.name.toLowerCase() === name.toLowerCase()));
    if (nextSources.length === config.skillSources.length)
    {
        throw new HalignError(`.harness-align/config.json: skill source is not configured, got ${valueText(`${owner}/${name}`)}`);
    }
    return saveConfig(root, { ...config, skillSources: nextSources });
}
