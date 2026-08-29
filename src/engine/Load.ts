/**
 * Discover and validate untrusted `.halign` sources.
 * Re-check containment on every directory step, and promote parser output to domain types only after field checks.
 */

import { promises as fs } from "node:fs";
import { join, posix, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { display, ensureRegularSource, lstatIfExists, readUtf8, reparseError } from "./FsSafe.js";
import {
    AGENT_EXTENSION,
    AGENT_FIELDS,
    AGENT_NAME,
    type Agent,
    assertWindowsSafeName,
    type Config,
    FRONTMATTER,
    type Harness,
    type HarnessConfig,
    HARNESS_FIELDS,
    HARNESS_NAME,
    type LayerConfig,
    LAYER_FIELDS,
    LAYER_NAME,
    type LayerOption,
    type Metadata,
    RULE_FIELDS,
    type Rule,
    type SkillSource,
    SKILL_SOURCE_FIELDS,
    codePointCompare,
    errorText,
    firstSorted,
    HalignError,
    hasOwn,
    isRecord,
    normalizedBody,
    typeText,
    valueText,
} from "./Model.js";

/** List markdown files under `directory`, optionally recursing while skipping excluded names. */
async function markdownFiles(
    root: string,
    directory: string,
    recursive: boolean,
    excludedDirectories: readonly string[] = [],
): Promise<string[]>
{
    await ensureRegularSource(root, directory);
    const directoryStats = await lstatIfExists(directory);
    if (!directoryStats) return [];
    if (!directoryStats.isDirectory())
    {
        throw new HalignError(`${display(root, directory)}: expected a directory`);
    }

    const excluded = new Set(excludedDirectories.map((path) => resolve(path)));
    const files: string[] = [];

    const visit = async (current: string): Promise<void> =>
    {
        await ensureRegularSource(root, current);
        const entries = await fs.readdir(current, { withFileTypes: true });
        entries.sort((left, right) => codePointCompare(left.name, right.name));
        for (const entry of entries)
        {
            const path = join(current, entry.name);
            if (excluded.has(resolve(path))) continue;
            await ensureRegularSource(root, path);
            const stats = await lstatIfExists(path);
            if (!stats) continue;
            if (stats.isSymbolicLink()) throw reparseError(root, path, false);
            if (stats.isDirectory())
            {
                if (recursive) await visit(path);
            }
            else if (stats.isFile() && path.endsWith(".md"))
            {
                files.push(path);
            }
        }
    };

    await visit(directory);
    return files;
}

/** Split a rule or agent file into YAML frontmatter and a non-empty markdown body. */
async function parseFrontmatter(root: string, path: string): Promise<[Record<string, unknown>, string]>
{
    const text = await readUtf8(root, path);
    const match = FRONTMATTER.exec(text);
    if (!match)
    {
        throw new HalignError(`${display(root, path)}: frontmatter must start with a YAML mapping`);
    }
    let metadata: unknown;
    try
    {
        metadata = parseYaml(match[1] ?? "");
    }
    catch (error)
    {
        throw new HalignError(`${display(root, path)}: invalid YAML frontmatter: ${errorText(error)}`);
    }
    if (!isRecord(metadata))
    {
        throw new HalignError(`${display(root, path)}: frontmatter must be a mapping, got ${typeText(metadata)}`);
    }
    const body = text.slice(match[0].length);
    if (!body.trim())
    {
        throw new HalignError(`${display(root, path)}: Markdown body must be non-empty, got ${valueText(body)}`);
    }
    return [metadata, body];
}

/** Require a unique string array. */
function stringArray(value: unknown, path: string, field: string): string[]
{
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.length > 0))
    {
        throw new HalignError(`${path}: ${field} must be a string array, got ${valueText(value)}`);
    }
    if (new Set(value).size !== value.length)
    {
        throw new HalignError(`${path}: ${field} must not contain duplicates, got ${valueText(value)}`);
    }
    return value;
}

/** Require a normalized `/`-separated relative path with no `.` or `..` segments. */
function relativeConfigPath(value: unknown, path: string, field: string): string
{
    const configPath = validateString(path, field, value);
    const parts = configPath.split("/");
    if (configPath.includes("\\") || posix.isAbsolute(configPath) || /^[A-Za-z]:/u.test(configPath)
        || parts.some((part) => !part || part === "." || part === ".."))
    {
        throw new HalignError(`${path}: ${field} must be a normalized relative path, got ${valueText(value)}`);
    }
    return configPath;
}

/** Validate one harness object from `config.json`. */
function validateHarnessConfig(value: unknown, path: string, index: number): HarnessConfig
{
    const context = `${path}: harnesses[${index}]`;
    if (!isRecord(value)) throw new HalignError(`${context} must be a mapping, got ${typeText(value)}`);
    const unknown = Object.keys(value).filter((field) => !HARNESS_FIELDS.has(field));
    if (unknown.length > 0) throw new HalignError(`${context}: unknown field ${valueText(firstSorted(unknown))}`);
    for (const field of ["name", "config_path", "agent_format", "agent_extension"])
    {
        if (!hasOwn(value, field)) throw new HalignError(`${context}: ${field} is required`);
    }

    const name = validateString(context, "name", value.name);
    if (!HARNESS_NAME.test(name)) throw new HalignError(`${context}: name must match ${HARNESS_NAME.source}, got ${valueText(name)}`);
    assertWindowsSafeName(name, `${context}: name`);
    const configPath = relativeConfigPath(value.config_path, context, "config_path");
    const agentFormat = validateString(context, "agent_format", value.agent_format);
    if (agentFormat !== "toml" && agentFormat !== "yaml")
    {
        throw new HalignError(`${context}: agent_format must be toml or yaml, got ${valueText(agentFormat)}`);
    }
    const agentExtension = validateString(context, "agent_extension", value.agent_extension);
    if (!AGENT_EXTENSION.test(agentExtension))
    {
        throw new HalignError(`${context}: agent_extension must match ${AGENT_EXTENSION.source}, got ${valueText(agentExtension)}`);
    }

    let instructionsField: string | undefined;
    if (hasOwn(value, "instructions_field")) instructionsField = validateString(context, "instructions_field", value.instructions_field);
    if (instructionsField !== undefined && (!HARNESS_NAME.test(instructionsField) || instructionsField === "name" || instructionsField === "description"))
    {
        throw new HalignError(`${context}: instructions_field must match ${HARNESS_NAME.source} and be other than name or description, got ${valueText(instructionsField)}`);
    }
    if (agentFormat === "toml" && instructionsField === undefined)
    {
        throw new HalignError(`${context}: instructions_field is required when agent_format is toml`);
    }
    if (agentFormat === "yaml" && instructionsField !== undefined)
    {
        throw new HalignError(`${context}: instructions_field is only supported when agent_format is toml`);
    }
    return instructionsField === undefined
        ? { name, configPath, agentFormat, agentExtension }
        : { name, configPath, agentFormat, agentExtension, instructionsField };
}

/** Validate one skill source object from `config.json`. */
function validateSkillSource(value: unknown, path: string, index: number): SkillSource
{
    const context = `${path}: skill_sources[${index}]`;
    if (!isRecord(value)) throw new HalignError(`${context} must be a mapping, got ${typeText(value)}`);
    const unknown = Object.keys(value).filter((field) => !SKILL_SOURCE_FIELDS.has(field));
    if (unknown.length > 0) throw new HalignError(`${context}: unknown field ${valueText(firstSorted(unknown))}`);
    for (const field of ["owner", "name", "branch"])
    {
        if (!hasOwn(value, field)) throw new HalignError(`${context}: ${field} is required`);
    }
    const owner = validateString(context, "owner", value.owner);
    const name = validateString(context, "name", value.name);
    const branch = validateString(context, "branch", value.branch);
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u.test(owner))
    {
        throw new HalignError(`${context}: owner must be a GitHub owner name, got ${valueText(owner)}`);
    }
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u.test(name))
    {
        throw new HalignError(`${context}: name must be a GitHub repository name, got ${valueText(name)}`);
    }
    if (/[\r\n]/.test(branch) || branch.includes("\\") || branch.includes(".."))
    {
        throw new HalignError(`${context}: branch must be a single-line git ref, got ${valueText(branch)}`);
    }
    return { owner, name, branch };
}

/** Validate a parsed config.json value into a Config. */
export function validateConfig(value: unknown): Config
{
    const path = ".halign/config.json";
    if (!isRecord(value)) throw new HalignError(`${path}: expected a mapping`);
    const knownFields = new Set(["version", "name", "layers", "harnesses", "skill_sources"]);
    const unknownFields = Object.keys(value).filter((field) => !knownFields.has(field));
    if (unknownFields.length > 0) throw new HalignError(`${path}: unknown field ${valueText(firstSorted(unknownFields))}`);
    for (const field of ["version", "layers", "harnesses"])
    {
        if (!hasOwn(value, field)) throw new HalignError(`${path}: ${field} is required`);
    }
    if (typeof value.version !== "number" || !Number.isInteger(value.version) || value.version !== 1)
    {
        throw new HalignError(`${path}: version must be integer 1, got ${valueText(value.version)}`);
    }
    const name = hasOwn(value, "name") ? value.name : "AGENTS";
    if (typeof name !== "string" || !name.trim() || /[\r\n]/u.test(name))
    {
        throw new HalignError(`${path}: name must be a non-empty single-line string, got ${valueText(name)}`);
    }
    if (!Array.isArray(value.layers)) throw new HalignError(`${path}: layers must be a mapping array, got ${valueText(value.layers)}`);
    const layers: LayerConfig[] = value.layers.map((layer, index) =>
    {
        const context = `${path}: layers[${index}]`;
        if (!isRecord(layer)) throw new HalignError(`${context} must be a mapping, got ${typeText(layer)}`);
        const unknown = Object.keys(layer).filter((field) => field !== "name" && field !== "selected");
        if (unknown.length > 0) throw new HalignError(`${context}: unknown field ${valueText(firstSorted(unknown))}`);
        if (!hasOwn(layer, "name")) throw new HalignError(`${context}: name is required`);
        if (!hasOwn(layer, "selected")) throw new HalignError(`${context}: selected is required`);
        const layerName = validateString(context, "name", layer.name);
        const selected = validateString(context, "selected", layer.selected);
        if (!LAYER_NAME.test(layerName)) throw new HalignError(`${context}: name must match ${LAYER_NAME.source}, got ${valueText(layerName)}`);
        if (!LAYER_NAME.test(selected)) throw new HalignError(`${context}: selected must match ${LAYER_NAME.source}, got ${valueText(selected)}`);
        assertWindowsSafeName(layerName, `${context}: name`);
        assertWindowsSafeName(selected, `${context}: selected`);
        return { name: layerName, selected };
    });
    if (!Array.isArray(value.harnesses) || value.harnesses.length === 0)
    {
        throw new HalignError(`${path}: harnesses must be a non-empty mapping array, got ${valueText(value.harnesses)}`);
    }
    const harnesses = value.harnesses.map((harness, index) => validateHarnessConfig(harness, path, index));
    const skillSources: SkillSource[] = [];
    if (hasOwn(value, "skill_sources"))
    {
        if (!Array.isArray(value.skill_sources))
        {
            throw new HalignError(`${path}: skill_sources must be a mapping array, got ${valueText(value.skill_sources)}`);
        }
        for (let index = 0; index < value.skill_sources.length; index += 1)
        {
            skillSources.push(validateSkillSource(value.skill_sources[index], path, index));
        }
    }
    const layerNames = new Map<string, string>();
    for (const layer of layers)
    {
        const folded = layer.name.toLowerCase();
        const existing = layerNames.get(folded);
        if (existing !== undefined)
        {
            throw new HalignError(`${path}: layer names must be unique without case sensitivity, got ${valueText(layer.name)} after ${valueText(existing)}`);
        }
        layerNames.set(folded, layer.name);
    }
    const names = new Map<string, string>();
    const configPaths = new Map<string, string>();
    for (const harness of harnesses)
    {
        const foldedName = harness.name.toLowerCase();
        const existingName = names.get(foldedName);
        if (existingName !== undefined)
        {
            throw new HalignError(`${path}: harness names must be unique without case sensitivity, got ${valueText(harness.name)} after ${valueText(existingName)}`);
        }
        names.set(foldedName, harness.name);
        const foldedPath = harness.configPath.toLowerCase();
        const existingPath = configPaths.get(foldedPath);
        if (existingPath !== undefined)
        {
            throw new HalignError(`${path}: harness config_path values must be unique without case sensitivity, got ${valueText(harness.configPath)} after ${valueText(existingPath)}`);
        }
        configPaths.set(foldedPath, harness.configPath);
        if (foldedPath === ".agents/shared-rules" || foldedPath.startsWith(".agents/shared-rules/"))
        {
            throw new HalignError(`${path}: harness config_path must not use the managed shared rules target, got ${valueText(harness.configPath)}`);
        }
        if (foldedPath === ".agents/skills" || foldedPath.startsWith(".agents/skills/"))
        {
            throw new HalignError(`${path}: harness config_path must not use the managed skills target, got ${valueText(harness.configPath)}`);
        }
        if (foldedPath === ".halign" || foldedPath.startsWith(".halign/"))
        {
            throw new HalignError(`${path}: harness config_path must not use the managed config directory, got ${valueText(harness.configPath)}`);
        }
    }
    for (let leftIndex = 0; leftIndex < harnesses.length; leftIndex += 1)
    {
        const left = harnesses[leftIndex]!;
        for (let rightIndex = leftIndex + 1; rightIndex < harnesses.length; rightIndex += 1)
        {
            const right = harnesses[rightIndex]!;
            const leftPath = left.configPath.toLowerCase();
            const rightPath = right.configPath.toLowerCase();
            if (leftPath.startsWith(`${rightPath}/`) || rightPath.startsWith(`${leftPath}/`))
            {
                throw new HalignError(`${path}: harness config_path values must not overlap, got ${valueText(left.configPath)} and ${valueText(right.configPath)}`);
            }
        }
    }
    const skillRepos = new Map<string, string>();
    for (const source of skillSources)
    {
        const key = `${source.owner.toLowerCase()}/${source.name.toLowerCase()}`;
        const existing = skillRepos.get(key);
        if (existing !== undefined)
        {
            throw new HalignError(`${path}: skill_sources owner/name must be unique without case sensitivity, got ${valueText(`${source.owner}/${source.name}`)} after ${valueText(existing)}`);
        }
        skillRepos.set(key, `${source.owner}/${source.name}`);
    }
    return { version: 1, name, layers, harnesses, skillSources };
}

/** Read and validate `.halign/config.json`. */
export async function loadConfig(root: string): Promise<Config>
{
    const path = join(root, ".halign", "config.json");
    await ensureRegularSource(root, path);
    if (!(await lstatIfExists(path)))
    {
        throw new HalignError(".halign/config.json: file is required");
    }
    let parsed: unknown;
    try
    {
        parsed = JSON.parse(await readUtf8(root, path, ".halign/config.json")) as unknown;
    }
    catch (error)
    {
        if (error instanceof HalignError) throw error;
        throw new HalignError(`.halign/config.json: invalid JSON: ${errorText(error)}`);
    }
    return validateConfig(parsed);
}

/** Load root rules, filtered later by harness targets. */
export async function loadRules(root: string, harnesses: HarnessConfig[]): Promise<Rule[]>
{
    const halign = join(root, ".halign");
    const rulesDirectory = join(halign, "rules");
    const paths = (await markdownFiles(root, rulesDirectory, true, [join(rulesDirectory, "shared")]))
        .sort((left, right) => codePointCompare(display(root, left), display(root, right)));
    const folded = new Map<string, string>();
    const rules: Rule[] = [];

    for (const sourcePath of paths)
    {
        const path = display(root, sourcePath);
        const foldedPath = path.toLowerCase();
        const existing = folded.get(foldedPath);
        if (existing && existing !== path)
        {
            throw new HalignError(`${path}: path conflicts with ${existing}; paths may not differ only by case`);
        }
        folded.set(foldedPath, path);
        const [metadata, body] = await parseFrontmatter(root, sourcePath);
        const unknown = Object.keys(metadata).filter((field) => !RULE_FIELDS.has(field));
        if (unknown.length > 0) throw new HalignError(`${path}: unknown rule field ${valueText(firstSorted(unknown))}`);
        if (!hasOwn(metadata, "priority")) throw new HalignError(`${path}: priority is required`);
        const priority = metadata.priority;
        if (typeof priority !== "number" || !Number.isInteger(priority) || priority < 0)
        {
            throw new HalignError(`${path}: priority must be a non-negative integer, got ${valueText(priority)}`);
        }
        let targets: Harness[];
        if (!hasOwn(metadata, "targets"))
        {
            targets = [];
        }
        else
        {
            const rawTargets = stringArray(metadata.targets, path, "targets");
            const configured = new Set(harnesses.map((harness) => harness.name));
            const invalid = rawTargets.find((target) => !configured.has(target));
            if (invalid !== undefined)
            {
                throw new HalignError(`${path}: targets may only contain configured harness names, got ${valueText(invalid)}`);
            }
            targets = rawTargets;
        }
        rules.push({ path, priority, targets, body: normalizedBody(body) });
    }
    return rules;
}

/** Parse optional layer frontmatter while allowing an empty Markdown body. */
async function parseLayerSource(root: string, path: string): Promise<[Record<string, unknown>, string]>
{
    const text = await readUtf8(root, path);
    if (!/^---\r?\n/u.test(text)) return [{}, text];
    const match = FRONTMATTER.exec(text);
    if (!match) throw new HalignError(`${display(root, path)}: invalid YAML frontmatter`);
    let metadata: unknown;
    try
    {
        metadata = parseYaml(match[1] ?? "");
    }
    catch (error)
    {
        throw new HalignError(`${display(root, path)}: invalid YAML frontmatter: ${errorText(error)}`);
    }
    if (metadata === null) metadata = {};
    if (!isRecord(metadata))
    {
        throw new HalignError(`${display(root, path)}: frontmatter must be a mapping, got ${typeText(metadata)}`);
    }
    return [metadata, text.slice(match[0].length)];
}

/** Load one layer directory and validate every direct option file, allowing an empty catalog layer. */
async function loadLayerDirectory(root: string, directory: string, layer: string, selected: string | undefined, harnesses: HarnessConfig[]): Promise<LayerOption[]>
{
    await ensureRegularSource(root, directory);
    const stats = await lstatIfExists(directory);
    if (!stats) throw new HalignError(`${display(root, directory)}: layer directory is required`);
    if (!stats.isDirectory()) throw new HalignError(`${display(root, directory)}: expected a directory`);
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => codePointCompare(left.name, right.name));
    const foldedNames = new Map<string, string>();
    const options: LayerOption[] = [];
    for (const entry of entries)
    {
        const sourcePath = join(directory, entry.name);
        await ensureRegularSource(root, sourcePath);
        const entryStats = await lstatIfExists(sourcePath);
        if (!entryStats) continue;
        if (entryStats.isSymbolicLink()) throw reparseError(root, sourcePath, false);
        if (!entryStats.isFile() || !entry.name.endsWith(".md"))
        {
            throw new HalignError(`${display(root, sourcePath)}: layer directories may only contain direct Markdown files`);
        }
        const name = entry.name.slice(0, -3);
        if (!LAYER_NAME.test(name))
        {
            throw new HalignError(`${display(root, sourcePath)}: layer option name must match ${LAYER_NAME.source}, got ${valueText(name)}`);
        }
        assertWindowsSafeName(name, display(root, sourcePath));
        const folded = name.toLowerCase();
        const existing = foldedNames.get(folded);
        if (existing !== undefined)
        {
            throw new HalignError(`${display(root, sourcePath)}: option names must be unique without case sensitivity, got ${valueText(name)} after ${valueText(existing)}`);
        }
        foldedNames.set(folded, name);
        const path = display(root, sourcePath);
        const [metadata, body] = await parseLayerSource(root, sourcePath);
        const unknown = Object.keys(metadata).filter((field) => !LAYER_FIELDS.has(field));
        if (unknown.length > 0) throw new HalignError(`${path}: unknown layer field ${valueText(firstSorted(unknown))}`);
        const targets = hasOwn(metadata, "targets")
            ? stringArray(metadata.targets, path, "targets")
            : [];
        const configured = new Set(harnesses.map((harness) => harness.name));
        const invalid = targets.find((target) => !configured.has(target));
        if (invalid !== undefined)
        {
            throw new HalignError(`${path}: targets may only contain configured harness names, got ${valueText(invalid)}`);
        }
        options.push({ path, layer, name, targets, body: body ? normalizedBody(body) : "" });
    }
    if (selected !== undefined && !options.some((option) => option.name === selected))
    {
        throw new HalignError(`.halign/config.json: layer ${valueText(layer)} selected option does not exist, got ${valueText(selected)}`);
    }
    return options;
}

/** Discover every layer directory and require configured selections to exist. */
export async function loadLayerOptions(root: string, config: Config): Promise<Record<string, LayerOption[]>>
{
    const layersRoot = join(root, ".halign", "layers");
    await ensureRegularSource(root, layersRoot);
    const stats = await lstatIfExists(layersRoot);
    if (!stats)
    {
        if (config.layers.length === 0) return {};
        throw new HalignError(".halign/layers: directory is required when layers are configured");
    }
    if (!stats.isDirectory()) throw new HalignError(".halign/layers: expected a directory");
    const configured = new Map(config.layers.map((layer) => [layer.name, layer]));
    const entries = await fs.readdir(layersRoot, { withFileTypes: true });
    entries.sort((left, right) => codePointCompare(left.name, right.name));
    const discovered = new Set<string>();
    const options = Object.create(null) as Record<string, LayerOption[]>;
    for (const entry of entries)
    {
        const directory = join(layersRoot, entry.name);
        await ensureRegularSource(root, directory);
        const entryStats = await lstatIfExists(directory);
        if (!entryStats) continue;
        if (entryStats.isSymbolicLink()) throw reparseError(root, directory, false);
        if (!entryStats.isDirectory()) throw new HalignError(`${display(root, directory)}: expected a layer directory`);
        if (!LAYER_NAME.test(entry.name))
        {
            throw new HalignError(`${display(root, directory)}: layer name must match ${LAYER_NAME.source}, got ${valueText(entry.name)}`);
        }
        assertWindowsSafeName(entry.name, display(root, directory));
        discovered.add(entry.name);
        options[entry.name] = await loadLayerDirectory(root, directory, entry.name, configured.get(entry.name)?.selected, config.harnesses);
    }
    const missing = config.layers.find((layer) => !discovered.has(layer.name));
    if (missing) throw new HalignError(`.halign/layers/${missing.name}: configured layer directory is required`);
    return options;
}

/** Require a non-empty string field. */
function validateString(path: string, field: string, value: unknown): string
{
    if (typeof value !== "string" || !value.trim())
    {
        throw new HalignError(`${path}: ${field} must be a non-empty string, got ${valueText(value)}`);
    }
    return value;
}

/** Load subagent sources and validate harness metadata blocks. */
export async function loadAgents(root: string, configuredHarnesses: HarnessConfig[]): Promise<Agent[]>
{
    const paths = await markdownFiles(root, join(root, ".halign", "agents"), false);
    const agents: Agent[] = [];
    const names = new Map<string, string>();
    const harnessConfigs = new Map(configuredHarnesses.map((harness) => [harness.name, harness]));
    for (const sourcePath of paths)
    {
        const path = display(root, sourcePath);
        const [metadata, body] = await parseFrontmatter(root, sourcePath);
        const unknown = Object.keys(metadata).filter((field) => !AGENT_FIELDS.has(field));
        if (unknown.length > 0) throw new HalignError(`${path}: unknown agent field ${valueText(firstSorted(unknown))}`);
        for (const field of AGENT_FIELDS)
        {
            if (!hasOwn(metadata, field)) throw new HalignError(`${path}: ${field} is required`);
        }
        const name = validateString(path, "name", metadata.name);
        if (!AGENT_NAME.test(name)) throw new HalignError(`${path}: name must match ${AGENT_NAME.source}, got ${valueText(name)}`);
        assertWindowsSafeName(name, path);
        const foldedName = name.toLowerCase();
        if (names.has(foldedName))
        {
            throw new HalignError(`${path}: name must be unique without case sensitivity, got ${valueText(name)}`);
        }
        names.set(foldedName, name);
        const description = validateString(path, "description", metadata.description);
        if (!isRecord(metadata.harnesses))
        {
            throw new HalignError(`${path}: harnesses must be a mapping, got ${typeText(metadata.harnesses)}`);
        }
        const invalidHarness = Object.keys(metadata.harnesses).find((harness) => !harnessConfigs.has(harness));
        if (invalidHarness !== undefined)
        {
            throw new HalignError(`${path}: harnesses may only contain configured harness names, got ${valueText(invalidHarness)}`);
        }
        const rendered: Record<Harness, Metadata> = {};
        for (const [harnessName, rawValues] of Object.entries(metadata.harnesses))
        {
            const harness = harnessConfigs.get(harnessName)!;
            if (!isRecord(rawValues))
            {
                throw new HalignError(`${path}: ${harness.name} metadata must be a mapping, got ${typeText(rawValues)}`);
            }
            if (harness.instructionsField !== undefined && hasOwn(rawValues, harness.instructionsField))
            {
                throw new HalignError(`${path}: ${harness.name}.${harness.instructionsField} is reserved for the Markdown body`);
            }
            rendered[harness.name] = rawValues;
        }
        if (Object.keys(rendered).length === 0)
        {
            throw new HalignError(`${path}: at least one configured harness block is required`);
        }
        agents.push({ path, name, description, harnesses: rendered, body: normalizedBody(body) });
    }
    return agents;
}

/** Shared-rule markdown deployed independently of generated AGENTS.md. */
export interface SharedRule
{
    path: string;
    body: string;
}

/** Load `.halign/rules/shared` markdown files. */
export async function loadSharedRules(root: string): Promise<SharedRule[]>
{
    const paths = await markdownFiles(root, join(root, ".halign", "rules", "shared"), true);
    const rules: SharedRule[] = [];
    for (const sourcePath of paths)
    {
        rules.push({
            path: display(root, sourcePath),
            body: (await readUtf8(root, sourcePath)).replace(/\r\n?/gu, "\n"),
        });
    }
    return rules;
}
