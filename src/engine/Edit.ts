/**
 * Validated write-back for `.halign` sources used by the desktop shell and tests.
 * Encode and validate before `atomicWrite`. Multi-file updates are not a single disk transaction.
 */

import { promises as fs } from "node:fs";
import { join, posix, resolve } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { assertContained, atomicWrite, display, ensureRegularSource, lstatIfExists, reparseError } from "./FsSafe.js";
import { loadAgents, loadConfig, loadRules, loadSharedRules, type SharedRule, validateConfig } from "./Load.js";
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
    domainRules: Record<string, Rule[]>;
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

/** Sort editable rules by priority and use their paths as a deterministic tie-breaker. */
function sortEditableRules(rules: Rule[]): Rule[]
{
    return rules.sort((left, right) => left.priority - right.priority || codePointCompare(left.path, right.path));
}

/** Build the JSON document written to `config.json`. */
function configDocument(config: Config): Record<string, unknown>
{
    return {
        version: 2,
        name: config.name,
        default_profile: config.defaultProfile,
        profiles: config.profiles,
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
    if (value !== ".halign/config.json" && !value.startsWith(".halign/rules/") && !value.startsWith(".halign/domains/") && !value.startsWith(".halign/agents/"))
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

/** Require a rule path under the expected `.halign` subtree. */
function assertRulePath(path: string, kind: "root" | "domain" | "shared"): void
{
    if (!path.endsWith(".md")) throw new HalignError(`${path}: rule path must end with .md`);
    if (kind === "root" && (path.startsWith(".halign/rules/shared/") || !path.startsWith(".halign/rules/")))
    {
        throw new HalignError(`${path}: root rule path must stay under .halign/rules and outside shared`);
    }
    if (kind === "domain" && !/^\.halign\/domains\/[^/]+\/rules\/.+\.md$/u.test(path))
    {
        throw new HalignError(`${path}: domain rule path must stay under .halign/domains/<profile>/rules`);
    }
    if (kind === "shared" && !path.startsWith(".halign/rules/shared/"))
    {
        throw new HalignError(`${path}: shared rule path must stay under .halign/rules/shared`);
    }
}

/** Classify a rule path as root, domain, or shared. */
function ruleKind(path: string): "root" | "domain" | "shared"
{
    if (path.startsWith(".halign/rules/shared/")) return "shared";
    if (path.startsWith(".halign/domains/")) return "domain";
    return "root";
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

/** Load root and every profile's domain rules. */
async function loadAllRules(root: string, config: Config): Promise<Rule[]>
{
    const seen = new Set<string>();
    const rules: Rule[] = [];
    for (const profile of config.profiles)
    {
        for (const rule of await loadRules(root, profile, config.harnesses))
        {
            if (seen.has(rule.path)) continue;
            seen.add(rule.path);
            rules.push(rule);
        }
    }
    return rules;
}

/** Load config, rules, shared-rules, and agents from a config root. */
export async function loadWorkspace(rootPath: string): Promise<Workspace>
{
    const root = resolve(rootPath);
    const config = await loadConfig(root);
    const agents = await loadAgents(root, config.harnesses);
    const firstProfile = config.profiles[0]!;
    const rootRules = sortEditableRules((await loadRules(root, firstProfile, config.harnesses))
        .filter((rule) => rule.path.startsWith(".halign/rules/") && !rule.path.startsWith(".halign/rules/shared/")));
    const domainRules: Record<string, Rule[]> = {};
    for (const profile of config.profiles)
    {
        const prefix = `.halign/domains/${profile}/rules/`;
        domainRules[profile] = sortEditableRules((await loadRules(root, profile, config.harnesses)).filter((rule) => rule.path.startsWith(prefix)));
    }
    return { root, config, rootRules, domainRules, sharedRules: await loadSharedRules(root), agents };
}

/** Validate and atomically write `config.json`. */
export async function saveConfig(rootPath: string, config: Config): Promise<Config>
{
    const root = resolve(rootPath);
    const validated = validateConfig(configDocument(config));
    await writeManaged(root, ".halign/config.json", Buffer.from(`${JSON.stringify(configDocument(validated), null, 2)}\n`, "utf8"));
    for (const profile of validated.profiles)
    {
        const directory = join(root, ".halign", "domains", profile, "rules");
        await ensureRegularSource(root, directory);
        await fs.mkdir(directory, { recursive: true });
    }
    return validated;
}

/** Validate and atomically write a root or domain rule. */
export async function saveRule(rootPath: string, input: RuleInput): Promise<void>
{
    const root = resolve(rootPath);
    const config = await loadConfig(root);
    const path = managedRelative(input.path, input.path);
    const kind = ruleKind(path);
    if (kind === "shared") throw new HalignError(`${path}: shared rules are saved with saveSharedRule`);
    assertRulePath(path, kind);
    if (kind === "domain")
    {
        const profile = path.split("/")[2];
        if (!profile || !config.profiles.includes(profile))
        {
            throw new HalignError(`${path}: domain profile must be configured, got ${valueText(profile)}`);
        }
    }
    if (!Number.isInteger(input.priority) || input.priority < 0)
    {
        throw new HalignError(`${path}: priority must be a non-negative integer, got ${valueText(input.priority)}`);
    }
    const targets = assertTargets(path, input.targets, config.harnesses);
    const metadata: Record<string, unknown> = { priority: input.priority };
    if (targets !== undefined) metadata.targets = targets;
    await writeManaged(root, path, serializeFrontmatter(metadata, input.body, path));
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
    const path = await resolveManaged(root, relative, relative);
    const stats = await lstatIfExists(path);
    if (!stats) throw new HalignError(`${relative}: file does not exist`);
    if (stats.isSymbolicLink()) throw reparseError(root, path, false);
    if (!stats.isFile()) throw new HalignError(`${relative}: managed source must be a file`);
    await fs.unlink(path);
}

/** Create a profile directory and add it to config. */
export async function addProfile(rootPath: string, profile: string): Promise<Config>
{
    const root = resolve(rootPath);
    const config = await loadConfig(root);
    if (config.profiles.some((existing) => existing.toLowerCase() === profile.toLowerCase()))
    {
        throw new HalignError(`.halign/config.json: profile already exists, got ${valueText(profile)}`);
    }
    return saveConfig(root, { ...config, profiles: [...config.profiles, profile] });
}

/** Remove an unused profile from config. */
export async function removeProfile(rootPath: string, profile: string): Promise<Config>
{
    const root = resolve(rootPath);
    const config = await loadConfig(root);
    if (profile === config.defaultProfile)
    {
        throw new HalignError(`.halign/config.json: default_profile cannot be removed, got ${valueText(profile)}`);
    }
    if (!config.profiles.includes(profile))
    {
        throw new HalignError(`.halign/config.json: profile is not configured, got ${valueText(profile)}`);
    }
    const next = await saveConfig(root, { ...config, profiles: config.profiles.filter((existing) => existing !== profile) });
    const directory = join(root, ".halign", "domains", profile);
    await ensureRegularSource(root, directory);
    const stats = await lstatIfExists(directory);
    if (!stats) return next;
    if (stats.isSymbolicLink()) throw reparseError(root, directory, false);
    if (!stats.isDirectory()) throw new HalignError(`${display(root, directory)}: expected a directory`);
    await assertNoReparseTree(root, directory);
    await fs.rm(directory, { recursive: true, force: true });
    return next;
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
    const rules = await loadAllRules(root, config);
    const agents = await loadAgents(root, config.harnesses);
    const nextRules = rules.map((rule) => ({ ...rule, targets: replaceHarnessName(rule.targets, from, to) }));
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
    await saveConfig(root, nextConfig);
    for (const rule of nextRules) await saveRule(root, rule);
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
    const rules = await loadAllRules(root, config);
    const agents = await loadAgents(root, config.harnesses);
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
    await saveConfig(root, nextConfig);
    for (const rule of nextRules) await saveRule(root, rule);
    for (const agent of nextAgents) await saveAgent(root, agent);
}

/** Add a harness declaration to config. */
export async function addHarness(rootPath: string, harness: HarnessConfig): Promise<Config>
{
    const root = resolve(rootPath);
    const config = await loadConfig(root);
    return saveConfig(root, { ...config, harnesses: [...config.harnesses, harness] });
}
