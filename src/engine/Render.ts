/**
 * Deterministic markdown and subagent rendering for declared harness formats.
 * Heading and TOC walks share one fence state machine so `#` inside fenced code stays literal.
 */

import { stringify as stringifyYaml } from "yaml";
import { stringify as stringifyToml } from "smol-toml";
import {
    ATX_HEADING,
    type Agent,
    FENCE,
    type Harness,
    type HarnessConfig,
    HalignError,
    type LayerOption,
    MARKER,
    type Metadata,
    type Rule,
    codePointCompare,
    errorText,
} from "./Model.js";

/** Update fence tracking for one markdown line. */
function fenceState(line: string, character: string, length: number): [string, number]
{
    const fence = FENCE.exec(line);
    if (character)
    {
        if (fence && fence[1]?.[0] === character && fence[1].length >= length && !line.slice(fence[0].length).trim())
        {
            return ["", 0];
        }
        return [character, length];
    }
    if (fence) return [fence[1]?.[0] ?? "", fence[1]?.length ?? 0];
    return ["", 0];
}

/** Demote ATX headings outside fenced code by one level, keeping h6 unchanged. */
export function downgradeMarkdownHeadings(body: string): string
{
    const lines: string[] = [];
    let fenceCharacter = "";
    let fenceLength = 0;
    for (let line of body.split("\n"))
    {
        const wasFenced = fenceCharacter !== "";
        [fenceCharacter, fenceLength] = fenceState(line, fenceCharacter, fenceLength);
        if (!wasFenced && fenceCharacter === "")
        {
            const heading = ATX_HEADING.exec(line);
            if (heading && heading[2]!.length < 6) line = `${line.slice(0, heading[1]!.length)}#${line.slice(heading[1]!.length)}`;
        }
        lines.push(line);
    }
    return lines.join("\n");
}

/** Build a GitHub-style heading anchor, lowercasing letters and replacing spaces. */
function markdownAnchor(title: string): string
{
    return title
        .toLowerCase()
        .replace(/[^\p{L}\p{N}_\s-]/gu, "")
        .replace(/\s/gu, "-");
}

/** Build the generated AGENTS.md table of contents. */
export function renderMarkdownToc(bodies: string[], name: string): string
{
    const anchors = new Set<string>();
    const counts = new Map<string, number>();
    const items: string[] = [];
    const anchorFor = (title: string): string =>
    {
        const base = markdownAnchor(title);
        let count = counts.get(base) ?? 0;
        let anchor = count === 0 ? base : `${base}-${count}`;
        while (anchors.has(anchor))
        {
            count += 1;
            anchor = `${base}-${count}`;
        }
        counts.set(base, count + 1);
        anchors.add(anchor);
        return anchor;
    };
    anchorFor(name);
    anchorFor("目录");
    for (const body of bodies)
    {
        let fenceCharacter = "";
        let fenceLength = 0;
        for (const line of body.split("\n"))
        {
            const wasFenced = fenceCharacter !== "";
            [fenceCharacter, fenceLength] = fenceState(line, fenceCharacter, fenceLength);
            if (wasFenced || fenceCharacter !== "") continue;
            const heading = ATX_HEADING.exec(line);
            if (!heading) continue;
            const title = line.slice(heading[0].length).trim().replace(/[ \t]+#+[ \t]*$/u, "");
            if (!title) continue;
            const anchor = anchorFor(title);
            if (heading[2]!.length === 2) items.push(`- [${title}](#${anchor})`);
        }
    }
    return `## 目录\n\n${items.join("\n")}`;
}

/** Render one harness AGENTS.md from ordered root rules and selected layer files. */
export function renderAgentsMarkdown(rules: Rule[], layers: LayerOption[], harness: Harness, name: string): Buffer
{
    const rootBodies = rules
        .slice()
        .sort((left, right) => left.priority - right.priority || codePointCompare(left.path, right.path))
        .filter((rule) => rule.targets.includes(harness))
        .map((rule) => downgradeMarkdownHeadings(rule.body.replace(/\n+$/u, "")));
    const layerBodies = layers
        .filter((layer) => layer.targets.includes(harness) && layer.body.trim())
        .map((layer) => downgradeMarkdownHeadings(layer.body.replace(/\n+$/u, "")));
    const bodies = [...rootBodies, ...layerBodies];
    let content = `${MARKER}\n\n# ${name}\n\n${renderMarkdownToc(bodies, name)}`;
    if (bodies.length > 0) content += `\n\n${bodies.join("\n\n")}`;
    return Buffer.from(`${content}\n`, "utf8");
}

/** JSON-encode a value so TOML multiline strings can reuse escaped line text. */
function jsonString(value: unknown): string
{
    return JSON.stringify(value);
}

/** Serialize one TOML subagent, storing the shared body in `instructions_field`. */
function renderTomlAgent(agent: Agent, harness: HarnessConfig, metadata: Metadata): Buffer
{
    const instructionsField = harness.instructionsField;
    if (instructionsField === undefined)
    {
        throw new HalignError(`${agent.path}: ${harness.name} TOML output requires instructions_field`);
    }
    const placeholder = "__HALIGN_MARKDOWN_BODY__";
    const values: Metadata = { name: agent.name, description: agent.description, ...metadata, [instructionsField]: placeholder };
    let content: string;
    let assignment: string;
    try
    {
        content = stringifyToml(values);
        assignment = stringifyToml({ [instructionsField]: placeholder }).trimEnd();
    }
    catch (error)
    {
        throw new HalignError(`${agent.path}: ${harness.name} metadata cannot be serialized as TOML: ${errorText(error)}`);
    }
    const assignmentLine = `${assignment}\n`;
    if (!content.includes(assignmentLine)) throw new HalignError(`${agent.path}: ${harness.name} instructions field could not be rendered`);
    const body = agent.body.split("\n").map((line) => jsonString(line).slice(1, -1)).join("\n");
    const key = assignment.slice(0, assignment.indexOf(" = "));
    return Buffer.from(content.replace(assignmentLine, `${key} = """\n${body}"""\n`), "utf8");
}

/** Serialize one YAML subagent with frontmatter plus the shared markdown body. */
function renderYamlAgent(agent: Agent, metadata: Metadata): Buffer
{
    const values: Metadata = { name: agent.name, description: agent.description, ...metadata };
    return Buffer.from(`---\n${stringifyYaml(values, { lineWidth: 0, sortMapEntries: false })}---\n\n${agent.body}`, "utf8");
}

/** Render one subagent file for a harness using TOML or YAML metadata. */
export function renderAgent(agent: Agent, harness: HarnessConfig, metadata: Metadata): Buffer
{
    return harness.agentFormat === "toml"
        ? renderTomlAgent(agent, harness, metadata)
        : renderYamlAgent(agent, metadata);
}
