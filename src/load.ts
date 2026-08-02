/*
不可信源文件发现, 解析与 schema 验证:

- 目录遍历每进入一层都重新检查 source 边界.
- JSON/YAML parser 结果先经 `isRecord()` 与字段级检查, 才成为领域对象.
*/

import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { display, ensureRegularSource, lstatIfExists, readUtf8, reparseError } from "./fs-safe.js";
import {
    AGENT_FIELDS,
    AGENT_METADATA,
    AGENT_NAME,
    type Agent,
    type Config,
    type Harness,
    type Metadata,
    RULE_FIELDS,
    type Rule,
    codePointCompare,
    errorText,
    firstSorted,
    HalignError,
    hasOwn,
    isHarness,
    isRecord,
    normalizedBody,
    typeText,
    valueText,
} from "./model.js";

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

    if (recursive)
    {
        await visit(directory);
    }
    else
    {
        const entries = await fs.readdir(directory, { withFileTypes: true });
        entries.sort((left, right) => codePointCompare(left.name, right.name));
        for (const entry of entries)
        {
            const path = join(directory, entry.name);
            await ensureRegularSource(root, path);
            const stats = await lstatIfExists(path);
            if (!stats) continue;
            if (stats.isSymbolicLink()) throw reparseError(root, path, false);
            if (stats.isFile() && path.endsWith(".md")) files.push(path);
        }
    }
    return files;
}

async function parseFrontmatter(root: string, path: string): Promise<[Record<string, unknown>, string]>
{
    const text = await readUtf8(root, path);
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)(?:\r?\n)?/u.exec(text);
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

function stringArray(value: unknown, path: string, field: string): string[]
{
    if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === "string" && item.length > 0))
    {
        throw new HalignError(`${path}: ${field} must be a non-empty string array, got ${valueText(value)}`);
    }
    if (new Set(value).size !== value.length)
    {
        throw new HalignError(`${path}: ${field} must not contain duplicates, got ${valueText(value)}`);
    }
    return value;
}

// `exactOptionalPropertyTypes` 区分字段缺失与字段存在但值为 `undefined`.
export function validateConfig(value: unknown): Config
{
    const path = ".halign/config.json";
    if (!isRecord(value)) throw new HalignError(`${path}: expected a mapping`);
    for (const field of ["version", "default_profile", "profiles", "harnesses"])
    {
        if (!hasOwn(value, field)) throw new HalignError(`${path}: ${field} is required`);
    }
    if (typeof value.version !== "number" || !Number.isInteger(value.version) || value.version !== 1)
    {
        throw new HalignError(`${path}: version must be integer 1, got ${valueText(value.version)}`);
    }
    if (typeof value.default_profile !== "string" || !value.default_profile)
    {
        throw new HalignError(`${path}: default_profile must be a non-empty string, got ${valueText(value.default_profile)}`);
    }
    const name = hasOwn(value, "name") ? value.name : "AGENTS";
    if (typeof name !== "string" || !name.trim() || /[\r\n]/u.test(name))
    {
        throw new HalignError(`${path}: name must be a non-empty single-line string, got ${valueText(name)}`);
    }
    const profiles = stringArray(value.profiles, path, "profiles");
    const rawHarnesses = stringArray(value.harnesses, path, "harnesses");
    if (!profiles.includes(value.default_profile))
    {
        throw new HalignError(`${path}: default_profile must be included in profiles, got ${valueText(value.default_profile)}`);
    }
    const unsafeProfile = profiles.find((profile) => profile === "." || profile === ".." || /[\\/]/u.test(profile));
    if (unsafeProfile !== undefined)
    {
        throw new HalignError(`${path}: profiles must contain single directory names, got ${valueText(unsafeProfile)}`);
    }
    const unsupported = rawHarnesses.find((harness) => !isHarness(harness));
    if (unsupported !== undefined)
    {
        throw new HalignError(`${path}: harnesses may only contain codex, cursor, opencode, got ${valueText(unsupported)}`);
    }
    return { version: 1, name, defaultProfile: value.default_profile, profiles, harnesses: rawHarnesses as Harness[] };
}

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

export async function loadRules(root: string, profile: string, harnesses: Harness[]): Promise<Rule[]>
{
    const halign = join(root, ".halign");
    const rulesDirectory = join(halign, "rules");
    const paths = [
        ...(await markdownFiles(root, rulesDirectory, true, [join(rulesDirectory, "shared")])),
        ...(await markdownFiles(root, join(halign, "domains", profile, "rules"), true)),
    ].sort((left, right) => codePointCompare(display(root, left), display(root, right)));
    const folded = new Map<string, string>();
    const rules: Rule[] = [];

    for (const sourcePath of paths)
    {
        const path = display(root, sourcePath);
        const foldedPath = path.toUpperCase().toLowerCase();
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
            targets = [...harnesses];
        }
        else
        {
            const rawTargets = stringArray(metadata.targets, path, "targets");
            const invalid = rawTargets.find((target) => !isHarness(target));
            if (invalid !== undefined)
            {
                throw new HalignError(`${path}: targets may only contain codex, cursor, opencode, got ${valueText(invalid)}`);
            }
            targets = rawTargets as Harness[];
        }
        rules.push({ path, priority, targets, body: normalizedBody(body) });
    }
    return rules;
}

function validateString(path: string, field: string, value: unknown): string
{
    if (typeof value !== "string" || !value.trim())
    {
        throw new HalignError(`${path}: ${field} must be a non-empty string, got ${valueText(value)}`);
    }
    return value;
}

export async function loadAgents(root: string, configuredHarnesses: Harness[]): Promise<Agent[]>
{
    const paths = await markdownFiles(root, join(root, ".halign", "agents"), false);
    const agents: Agent[] = [];
    const names = new Map<string, string>();
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
        const invalidHarness = Object.keys(metadata.harnesses).find((harness) => !isHarness(harness));
        if (invalidHarness !== undefined)
        {
            throw new HalignError(`${path}: harnesses may only contain codex, cursor, opencode, got ${valueText(invalidHarness)}`);
        }
        const rendered: Partial<Record<Harness, Metadata>> = {};
        for (const [harnessName, rawValues] of Object.entries(metadata.harnesses))
        {
            const harness = harnessName as Harness;
            if (!isRecord(rawValues))
            {
                throw new HalignError(`${path}: ${harness} metadata must be a mapping, got ${typeText(rawValues)}`);
            }
            const allowed = new Set<string>(AGENT_METADATA[harness]);
            const invalidField = Object.keys(rawValues).filter((field) => !allowed.has(field));
            if (invalidField.length > 0)
            {
                throw new HalignError(`${path}: unknown ${harness} field ${valueText(firstSorted(invalidField))}`);
            }
            for (const [field, value] of Object.entries(rawValues))
            {
                const qualified = `${harness}.${field}`;
                if (harness === "cursor" && field === "readonly")
                {
                    if (typeof value !== "boolean") throw new HalignError(`${path}: ${qualified} must be a boolean, got ${typeText(value)}`);
                }
                else if (harness === "opencode" && field === "permission")
                {
                    if (!isRecord(value)) throw new HalignError(`${path}: ${qualified} must be a mapping, got ${typeText(value)}`);
                    for (const [permission, mode] of Object.entries(value))
                    {
                        if (typeof mode !== "string" || !["allow", "ask", "deny"].includes(mode))
                        {
                            throw new HalignError(`${path}: ${qualified}.${permission} must be allow, ask, or deny, got ${valueText(mode)}`);
                        }
                    }
                }
                else if (typeof value !== "string" || !value)
                {
                    throw new HalignError(`${path}: ${qualified} must be a non-empty string, got ${valueText(value)}`);
                }
            }
            if (configuredHarnesses.includes(harness)) rendered[harness] = rawValues;
        }
        if (Object.keys(rendered).length === 0)
        {
            throw new HalignError(`${path}: at least one configured harness block is required`);
        }
        agents.push({ path, name, description, harnesses: rendered, body: normalizedBody(body) });
    }
    return agents;
}
