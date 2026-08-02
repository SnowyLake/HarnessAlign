/*
Markdown 状态机与确定性渲染:

- 标题转换和 TOC 必须共享同一 fence 状态机. fenced code 内的 `#` 属于示例代码.
- renderer 只消费已验证 Rule/Agent, 返回 Buffer 而非 string.
*/

import { stringify as stringifyYaml } from "yaml";
import {
    AGENT_METADATA,
    ATX_HEADING,
    type Agent,
    FENCE,
    type Harness,
    MARKER,
    type Metadata,
    type Rule,
    codePointCompare,
    hasOwn,
} from "./model.js";

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

export function downgradeMarkdownHeadings(body: string): string
{
    const lines: string[] = [];
    let fenceCharacter = "";
    let fenceLength = 0;
    for (let line of body.split("\n"))
    {
        if (fenceCharacter)
        {
            [fenceCharacter, fenceLength] = fenceState(line, fenceCharacter, fenceLength);
            lines.push(line);
            continue;
        }
        const fence = FENCE.exec(line);
        if (fence)
        {
            fenceCharacter = fence[1]?.[0] ?? "";
            fenceLength = fence[1]?.length ?? 0;
            lines.push(line);
            continue;
        }
        const heading = ATX_HEADING.exec(line);
        if (heading && heading[2]!.length < 6) line = `${line.slice(0, heading[1]!.length)}#${line.slice(heading[1]!.length)}`;
        lines.push(line);
    }
    return lines.join("\n");
}

function markdownAnchor(title: string): string
{
    return title
        .toLowerCase()
        .replace(/[^\p{L}\p{N}_\s-]/gu, "")
        .replace(/\s/gu, "-");
}

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
            if (fenceCharacter)
            {
                [fenceCharacter, fenceLength] = fenceState(line, fenceCharacter, fenceLength);
                continue;
            }
            const fence = FENCE.exec(line);
            if (fence)
            {
                fenceCharacter = fence[1]?.[0] ?? "";
                fenceLength = fence[1]?.length ?? 0;
                continue;
            }
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

export function renderAgentsMarkdown(rules: Rule[], harness: Harness, name: string): Buffer
{
    const bodies = rules
        .slice()
        .sort((left, right) => left.priority - right.priority || codePointCompare(left.path, right.path))
        .filter((rule) => rule.targets.includes(harness))
        .map((rule) => downgradeMarkdownHeadings(rule.body.replace(/\n+$/u, "")));
    let content = `${MARKER}\n\n# ${name}\n\n${renderMarkdownToc(bodies, name)}`;
    if (bodies.length > 0) content += `\n\n${bodies.join("\n\n")}`;
    return Buffer.from(`${content}\n`, "utf8");
}

function jsonString(value: unknown): string
{
    return JSON.stringify(value);
}

export function renderCodexAgent(agent: Agent, metadata: Metadata): Buffer
{
    const fields: Metadata = { name: agent.name, description: agent.description };
    for (const field of AGENT_METADATA.codex)
    {
        if (hasOwn(metadata, field)) fields[field] = metadata[field];
    }
    const body = agent.body.split("\n").map((line) => jsonString(line).slice(1, -1)).join("\n");
    let content = "";
    for (const [field, value] of Object.entries(fields)) content += `${field} = ${jsonString(value)}\n`;
    return Buffer.from(`${content}developer_instructions = """\n${body}"""\n`, "utf8");
}

export function renderYamlAgent(agent: Agent, harness: Exclude<Harness, "codex">, metadata: Metadata): Buffer
{
    const order = harness === "cursor"
        ? ["name", "description", "model", "readonly"]
        : ["name", "description", "mode", "model", "variant", "permission"];
    const values: Metadata = { name: agent.name, description: agent.description, ...metadata };
    const ordered: Metadata = {};
    for (const field of order) if (hasOwn(values, field)) ordered[field] = values[field];
    return Buffer.from(`---\n${stringifyYaml(ordered, { lineWidth: 0, sortMapEntries: false })}---\n\n${agent.body}`, "utf8");
}
