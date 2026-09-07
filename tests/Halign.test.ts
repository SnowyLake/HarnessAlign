/**
 * Engine tests against temporary directories.
 * Do not use this repository as a `.harness-align` config root, and do not open Electron windows here.
 */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import { workspaceService } from "../src/main/services/WorkspaceService.js";
import { uniqueAgentPath, uniqueRulePath } from "../src/renderer/src/lib/Utils.js";
import { discoverSkills, installSkills } from "../src/main/services/SkillRemoteService.js";
import { AGENT_SCHEMA, CONFIG_SCHEMA, LAYER_SELECTION_SCHEMA, RULE_INPUT_SCHEMA, SKILL_IDS_SCHEMA } from "../src/shared/models/Schemas.js";
import { atomicWrite } from "../src/engine/FsSafe.js";
import { buildOutputs, generate, reportGenerate, safeOutputRelative } from "../src/engine/Generate.js";
import { loadConfig, validateConfig } from "../src/engine/Load.js";
import { HalignError } from "../src/engine/Model.js";
import { downgradeMarkdownHeadings, renderMarkdownToc } from "../src/engine/Render.js";
import { reportSetup, setup } from "../src/engine/Setup.js";
import { assertSafeZipEntry, hashSkillDirectory, installSkillFromDirectory, loadSkills, parseGitHubSkillSource } from "../src/engine/Skills.js";
import {
    addHarness, addLayer, addLayerOption, addSkillSource, deleteSource, ensureUserWorkspace, importUserSkills,
    listUserSkills, loadWorkspace, removeHarness, removeLayer, removeLayerOption, removeSkill, removeSkillSource,
    renameLayer, renameLayerOption, renameSource, saveAgent, saveConfig, saveLayerOption, saveRule, saveSharedRule, updateHarness,
} from "../src/engine/Edit.js";

const config = {
    version: 1,
    name: "AGENTS",
    layers: [{ name: "soul", selected: "arona" }],
    harnesses: [
        { name: "codex", config_path: ".codex", agent_format: "toml", agent_extension: "toml", instructions_field: "developer_instructions" },
        { name: "cursor", config_path: ".cursor", agent_format: "yaml", agent_extension: "md" },
        { name: "opencode", config_path: ".config/opencode", agent_format: "yaml", agent_extension: "md" },
    ],
};

/** Harness allowlist shared by fixtures that should render everywhere. */
const ALL_HARNESS_NAMES = config.harnesses.map((harness) => harness.name);

/** Small valid GitHub-shaped archive used by remote discovery checks. */
const TEST_SKILL_ARCHIVE = Buffer.from(
    "UEsDBBQAAAAIAFgSKF30xqGHCQAAAAcAAAAXAAAAcmVwby1tYWluL2RlbW8vU0tJTEwubWRTVnBJzc3nAgBQSwECFAAUAAAACABYEihd9MahhwkAAAAHAAAAFwAAAAAAAAAAAAAAAAAAAAAAcmVwby1tYWluL2RlbW8vU0tJTEwubWRQSwUGAAAAAAEAAQBFAAAAPgAAAAAA",
    "base64",
);

/** Create a temporary `.harness-align` project, run the case, then delete the directory. */
async function withProject(run: (root: string) => Promise<void>): Promise<void>
{
    const root = await mkdtemp(join(tmpdir(), "halign-ts-"));
    try
    {
        await mkdir(join(root, ".harness-align", "rules"), { recursive: true });
        await mkdir(join(root, ".harness-align", "layers", "soul"), { recursive: true });
        await mkdir(join(root, ".harness-align", "agents"), { recursive: true });
        await writeFile(join(root, ".harness-align", "config.json"), JSON.stringify(config), "utf8");
        await writeLayerOption(root, "soul", "arona", "# Soul\n\narona soul");
        await writeLayerOption(root, "soul", "kei", "# Soul\n\nkei soul");
        await writeRule(root, "base.md", 100, "# Base\n\nbase");
        await writeAgent(root);
        await run(root);
    }
    finally
    {
        await rm(root, { recursive: true, force: true });
    }
}

/** Write one selectable Layer option with an explicit target allowlist. */
async function writeLayerOption(root: string, layer: string, option: string, body: string, targets: string[] = ALL_HARNESS_NAMES): Promise<void>
{
    const targetLines = targets.length === 0 ? "targets: []\n" : `targets:\n${targets.map((target) => `  - ${target}\n`).join("")}`;
    const frontmatter = `---\n${targetLines}---\n\n`;
    await writeFile(join(root, ".harness-align", "layers", layer, `${option}.md`), `${frontmatter}${body}`, "utf8");
}

/** Write a root rule markdown file under `.harness-align/rules`. */
async function writeRule(root: string, name: string, priority: number, body: string, targets: string[] = ALL_HARNESS_NAMES): Promise<void>
{
    const targetLines = targets.length === 0 ? "targets: []\n" : "targets:\n" + targets.map((target) => "  - " + target + "\n").join("");
    await writeFile(join(root, ".harness-align", "rules", name), "---\npriority: " + priority + "\n" + targetLines + "---\n\n" + body + "\n", "utf8");
}

/** Write a sample subagent with per-harness metadata. */
async function writeAgent(root: string, name = "explorer"): Promise<void>
{
    const content = [
        "---",
        `name: ${name}`,
        "description: Read only.",
        "harnesses:",
        "  codex:",
        "    model: test-codex",
        "    sandbox_mode: read-only",
        "    web_search: disabled",
        "    temperature: 0.25",
        "    tags:",
        "      - audit",
        "      - safe",
        "    limits:",
        "      requests: 3",
        "  cursor:",
        "    model: test-cursor",
        "    readonly: true",
        "    custom_number: 42",
        "    capabilities:",
        "      review: true",
        "  opencode:",
        "    model: test-opencode",
        "    variant: max",
        "    mode: subagent",
        "    permission:",
        "      edit: deny",
        "      bash: deny",
        "---",
        "",
        "Read evidence.",
        "",
    ].join("\n");
    await writeFile(join(root, ".harness-align", "agents", name + ".md"), content, "utf8");
}

/** Decode one generated path from an output map. */
function output(outputs: Map<string, Buffer>, path: string): string
{
    const content = outputs.get(path);
    assert.ok(content, "missing " + path);
    return content.toString("utf8");
}

/** Recursively read every file under `root` as `/`-separated relative paths. */
async function snapshot(root: string): Promise<Map<string, Buffer>>
{
    const files = new Map<string, Buffer>();
    /** Walk one directory and record regular files. */
    const visit = async (directory: string, prefix: string): Promise<void> =>
    {
        for (const entry of await readdir(directory, { withFileTypes: true }))
        {
            const path = join(directory, entry.name);
            const child = prefix ? prefix + "/" + entry.name : entry.name;
            if (entry.isDirectory()) await visit(path, child);
            if (entry.isFile()) files.set(child, await readFile(path));
        }
    };
    await visit(root, "");
    return files;
}

test("mixed-case names survive editing and generation while folded duplicates remain invalid", async () =>
{
    await withProject(async (root) =>
    {
        await addLayer(root, "CustomLayer");
        await addLayerOption(root, "CustomLayer", "DefaultOption");
        await saveLayerOption(root, { path: ".harness-align/layers/CustomLayer/DefaultOption.md", targets: ["codex"], body: "Mixed case layer." });
        await saveAgent(root, { path: ".harness-align/agents/MixedAgent.md", name: "MixedAgent", description: "Mixed case agent.", body: "Read evidence.", harnesses: { codex: {} } });
        const current = await loadConfig(root);
        await updateHarness(root, "codex", { ...current.harnesses[0]!, name: "Codex" });
        const outputs = await generate(root, [{ name: "CustomLayer", option: "DefaultOption" }]);
        assert.match(output(outputs, "Codex/AGENTS.md"), /Mixed case layer\./u);
        assert.equal(parseToml(output(outputs, "Codex/agents/MixedAgent.toml")).name, "MixedAgent");
        await assert.rejects(addLayer(root, "customlayer"), /already exists/u);
        await assert.rejects(addLayerOption(root, "CustomLayer", "defaultoption"), /already exists/u);
        const updated = await loadConfig(root);
        await assert.rejects(addHarness(root, { ...updated.harnesses[0]!, name: "codex", configPath: ".other" }), /harness names must be unique/u);
        await updateHarness(root, "Codex", { ...updated.harnesses[0]!, agentExtension: "TOML", instructionsField: "Instructions" });
        const uppercaseOutputs = await generate(root);
        assert.equal(parseToml(output(uppercaseOutputs, "Codex/agents/MixedAgent.TOML")).Instructions, "Read evidence.\n");
        assert.equal((await loadConfig(root)).harnesses[0]!.agentExtension, "TOML");
        await assert.rejects(updateHarness(root, "Codex", { ...updated.harnesses[0]!, agentExtension: "../TOML" }), /agent_extension must match/u);
        await assert.rejects(updateHarness(root, "Codex", { ...updated.harnesses[0]!, instructionsField: "name" }), /instructions_field must match/u);
        await writeFile(join(root, ".harness-align", "agents", "duplicate.md"), "---\nname: mixedagent\ndescription: Duplicate.\nharnesses:\n  Codex: {}\n---\n\nRead evidence.\n", "utf8");
        await assert.rejects(buildOutputs(root), /name must be unique without case sensitivity/u);
    });
});

test("case-only Layer and option renames preserve disk spelling, selections, and collision protection", async () =>
{
    await withProject(async (root) =>
    {
        const original = await readFile(join(root, ".harness-align", "layers", "soul", "arona.md"), "utf8");
        await renameLayer(root, "soul", "Soul");
        await renameLayerOption(root, "Soul", "arona", "Arona");
        assert.deepEqual((await loadConfig(root)).layers, [{ name: "Soul", selected: "Arona" }]);
        assert.deepEqual(await readdir(join(root, ".harness-align", "layers")), ["Soul"]);
        assert.ok((await readdir(join(root, ".harness-align", "layers", "Soul"))).includes("Arona.md"));
        assert.equal(await readFile(join(root, ".harness-align", "layers", "Soul", "Arona.md"), "utf8"), original);
        assert.match(output(await buildOutputs(root), "codex/AGENTS.md"), /arona soul/u);
        await addLayer(root, "Other");
        await assert.rejects(renameLayer(root, "Soul", "OTHER"), /unique without case sensitivity/u);
        await assert.rejects(renameLayerOption(root, "Soul", "Arona", "KEI"), /unique without case sensitivity/u);
        await renameLayerOption(root, "Soul", "Arona", "arona");
        await renameLayer(root, "Soul", "soul");
        assert.deepEqual((await loadConfig(root)).layers, config.layers);
        assert.ok((await readdir(join(root, ".harness-align", "layers"))).includes("soul"));
        assert.ok((await readdir(join(root, ".harness-align", "layers", "soul"))).includes("arona.md"));
    });
});

test("Agent and Rule case-only renames exclude themselves while protecting other sources", async () =>
{
    await withProject(async (root) =>
    {
        await saveSharedRule(root, ".harness-align/rules/shared/common.md", "Shared content.");
        for (const [from, name, agent] of [
            [".harness-align/rules/base.md", "Base", false],
            [".harness-align/rules/shared/common.md", "Common", false],
            [".harness-align/agents/explorer.md", "Explorer", true],
        ] as const)
        {
            const next = agent ? uniqueAgentPath(from, name, [from]) : uniqueRulePath(from, name, [from]);
            const before = await readFile(join(root, from), "utf8");
            await renameSource(root, from, next);
            assert.equal(await readFile(join(root, next), "utf8"), before);
            const parent = next.slice(0, next.lastIndexOf("/"));
            assert.ok((await readdir(join(root, parent))).includes(`${name}.md`));
            const other = `${parent}/other.md`;
            await writeFile(join(root, other), "Keep me.\n", "utf8");
            assert.throws(() => agent ? uniqueAgentPath(next, "Other", [next, other]) : uniqueRulePath(next, "Other", [next, other]), /already exists/u);
            await assert.rejects(renameSource(root, next, other), /destination already exists/u);
            assert.equal(await readFile(join(root, other), "utf8"), "Keep me.\n");
            await renameSource(root, next, from);
            assert.equal(await readFile(join(root, from), "utf8"), before);
        }
        assert.throws(() => uniqueAgentPath(undefined, "Explorer", [".harness-align/agents/explorer.md"]), /already exists/u);
    });
});

test("config and metadata validation reject unsafe input", async () =>
{
    await withProject(async (root) =>
    {
        await writeFile(join(root, ".harness-align", "config.json"), JSON.stringify({ ...config, layers: [{ name: "../x", selected: "arona" }] }), "utf8");
        await assert.rejects(buildOutputs(root), /name must match/u);
        await writeFile(join(root, ".harness-align", "config.json"), JSON.stringify({ ...config, harnesses: [{ ...config.harnesses[0], config_path: "../escape" }] }), "utf8");
        await assert.rejects(buildOutputs(root), /normalized relative path/u);
        await writeFile(join(root, ".harness-align", "config.json"), JSON.stringify({ ...config, harnesses: [
            { ...config.harnesses[0], config_path: ".tools" },
            { ...config.harnesses[1], config_path: ".tools/nested" },
        ] }), "utf8");
        await assert.rejects(buildOutputs(root), /must not overlap/u);
        await writeFile(join(root, ".harness-align", "config.json"), JSON.stringify({ ...config, harnesses: [
            { ...config.harnesses[0], config_path: ".agents/shared-rules/custom" },
        ] }), "utf8");
        await assert.rejects(buildOutputs(root), /managed shared rules target/u);
        await writeFile(join(root, ".harness-align", "config.json"), JSON.stringify({ ...config, harnesses: [
            { ...config.harnesses[0], config_path: ".harness-align" },
        ] }), "utf8");
        await assert.rejects(buildOutputs(root), /managed config directory/u);
        await writeFile(join(root, ".harness-align", "config.json"), JSON.stringify({ ...config, harnesses: [
            { ...config.harnesses[0], config_path: ".harness-align/extra" },
        ] }), "utf8");
        await assert.rejects(buildOutputs(root), /managed config directory/u);
        await writeFile(join(root, ".harness-align", "config.json"), JSON.stringify({ ...config, harnesses: [
            { ...config.harnesses[0], name: "con" },
        ] }), "utf8");
        await assert.rejects(buildOutputs(root), /Windows reserved device name/u);
        await writeFile(join(root, ".harness-align", "config.json"), JSON.stringify({ ...config, version: 2 }), "utf8");
        await assert.rejects(buildOutputs(root), /version must be integer 1/u);
        await writeFile(join(root, ".harness-align", "config.json"), JSON.stringify({ ...config, profiles: ["legacy"] }), "utf8");
        await assert.rejects(buildOutputs(root), /unknown field "profiles"/u);
        await writeFile(join(root, ".harness-align", "config.json"), JSON.stringify({ ...config, harnesses: [{ ...config.harnesses[1], extra: true }] }), "utf8");
        await assert.rejects(buildOutputs(root), /unknown field/u);
        await writeFile(join(root, ".harness-align", "config.json"), JSON.stringify({ ...config, harnesses: [{ ...config.harnesses[1], agent_format: "json" }] }), "utf8");
        await assert.rejects(buildOutputs(root), /agent_format must be toml or yaml/u);
        await writeFile(join(root, ".harness-align", "config.json"), JSON.stringify({ ...config, harnesses: [{ ...config.harnesses[1], agent_extension: ".md" }] }), "utf8");
        await assert.rejects(buildOutputs(root), /agent_extension must match/u);
        await writeFile(join(root, ".harness-align", "config.json"), JSON.stringify({ ...config, harnesses: [{ ...config.harnesses[0], instructions_field: undefined }] }), "utf8");
        await assert.rejects(buildOutputs(root), /instructions_field is required/u);
        await writeFile(join(root, ".harness-align", "config.json"), JSON.stringify({ ...config, harnesses: [{ ...config.harnesses[1], instructions_field: "developer_instructions" }] }), "utf8");
        await assert.rejects(buildOutputs(root), /instructions_field is only supported when agent_format is toml/u);
        await writeFile(join(root, ".harness-align", "config.json"), JSON.stringify({ ...config, harnesses: [{ ...config.harnesses[0], instructions_field: "name" }] }), "utf8");
        await assert.rejects(buildOutputs(root), /other than name or description/u);
        await writeFile(join(root, ".harness-align", "config.json"), JSON.stringify({
            ...config,
            harnesses: [config.harnesses[0], { ...config.harnesses[0], config_path: ".other" }],
        }), "utf8");
        await assert.rejects(buildOutputs(root), /harness names must be unique/u);
        await writeFile(join(root, ".harness-align", "config.json"), JSON.stringify(config), "utf8");
        await writeFile(join(root, ".harness-align", "agents", "explorer.md"), "---\nname: explorer\ndescription: Read only.\nharnesses:\n  codex:\n    developer_instructions: stolen\n---\n\nbody\n", "utf8");
        await assert.rejects(buildOutputs(root), /reserved for the Markdown body/u);
        await writeAgent(root);
        await writeFile(join(root, ".harness-align", "agents", "explorer.md"), "---\nname: explorer\ndescription: Read only.\nharnesses:\n  missing:\n    model: x\n---\n\nbody\n", "utf8");
        await assert.rejects(buildOutputs(root), /configured harness names/u);
        await writeAgent(root);
        await writeFile(join(root, ".harness-align", "rules", "bad.md"), "---\npriority: high\n---\n\n# Bad\n\nbad\n", "utf8");
        await assert.rejects(buildOutputs(root), /priority/u);
        await unlink(join(root, ".harness-align", "rules", "bad.md"));
        await writeFile(join(root, ".harness-align", "layers", "soul", "arona.md"), "---\npriority: 3\n---\n\n# Soul\n", "utf8");
        await assert.rejects(buildOutputs(root), /unknown layer field "priority"/u);
    });
});

test("Layer discovery is strict and empty layers and options are valid", async () =>
{
    await withProject(async (root) =>
    {
        await saveLayerOption(root, { path: ".harness-align/layers/soul/arona.md", targets: [], body: "" });
        assert.ok(!output(await buildOutputs(root), "codex/AGENTS.md").includes("arona soul"));
        await mkdir(join(root, ".harness-align", "layers", "soul", "nested"));
        await assert.rejects(buildOutputs(root), /only contain direct Markdown files/u);
        await rm(join(root, ".harness-align", "layers", "soul", "nested"), { recursive: true });
        await mkdir(join(root, ".harness-align", "layers", "orphan"));
        assert.deepEqual((await loadWorkspace(root)).layerOptions.orphan, []);
        await writeLayerOption(root, "orphan", "x", "x");
        const catalog = await loadWorkspace(root);
        assert.ok(Object.keys(catalog.layerOptions).includes("orphan"));
        assert.ok(!output(await buildOutputs(root), "codex/AGENTS.md").includes("x"));
        const withOrphan = await buildOutputs(root, [{ name: "soul", option: "kei" }, { name: "orphan", option: "x" }]);
        assert.ok(output(withOrphan, "codex/AGENTS.md").includes("x"));
        assert.ok(output(withOrphan, "codex/AGENTS.md").includes("kei soul"));
        const withoutSoul = await buildOutputs(root, []);
        assert.ok(!output(withoutSoul, "codex/AGENTS.md").includes("kei soul"));
        await assert.rejects(buildOutputs(root, [{ name: "missing", option: "x" }]), /unknown layer selection/u);
        await rm(join(root, ".harness-align", "layers", "orphan"), { recursive: true });
        await writeFile(join(root, ".harness-align", "config.json"), JSON.stringify({ ...config, layers: [{ name: "soul", selected: "missing" }] }), "utf8");
        await assert.rejects(buildOutputs(root), /selected option does not exist/u);
        await writeFile(join(root, ".harness-align", "config.json"), JSON.stringify(config), "utf8");
        await assert.rejects(buildOutputs(root, [{ name: "soul", option: "missing" }]), /option does not exist/u);
    });
});

test("root rules, ordered Layer selection, targets, Markdown, and renderers are deterministic", async () =>
{
    await withProject(async (root) =>
    {
        await writeRule(root, "zeta.md", 10, "# Zeta\n\nzeta");
        await writeRule(root, "alpha.md", 10, "# Alpha\n\nalpha");
        await writeRule(root, "cursor.md", 1, "# Cursor\n\ncursor only", ["cursor"]);
        await writeRule(root, "disabled.md", 0, "# Disabled\n\nempty target rule", []);
        await writeFile(join(root, ".harness-align", "rules", "missing-targets.md"), "---\npriority: 0\n---\n\n# Missing Targets\n\nmissing target rule\n", "utf8");
        await mkdir(join(root, ".harness-align", "layers", "workflow"));
        await writeLayerOption(root, "workflow", "strict", "# Workflow\n\nstrict workflow");
        await mkdir(join(root, ".harness-align", "layers", "disabled"));
        await writeLayerOption(root, "disabled", "off", "# Disabled Layer\n\nempty target layer", []);
        await writeFile(join(root, ".harness-align", "config.json"), JSON.stringify({
            ...config,
            layers: [...config.layers, { name: "workflow", selected: "strict" }, { name: "disabled", selected: "off" }],
        }), "utf8");
        const first = await buildOutputs(root);
        const second = await buildOutputs(root);
        assert.deepEqual([...first].map(([path, value]) => [path, value.toString("hex")]), [...second].map(([path, value]) => [path, value.toString("hex")]));
        const codex = output(first, "codex/AGENTS.md");
        assert.ok(codex.indexOf("alpha") < codex.indexOf("zeta"));
        assert.ok(!codex.includes("cursor only"));
        assert.ok(codex.indexOf("base") < codex.indexOf("arona soul"));
        assert.ok(codex.indexOf("arona soul") < codex.indexOf("strict workflow"));
        assert.ok(output(first, "cursor/AGENTS.md").includes("cursor only"));
        for (const harness of config.harnesses)
        {
            const markdown = output(first, `${harness.name}/AGENTS.md`);
            assert.ok(!markdown.includes("empty target rule"));
            assert.ok(!markdown.includes("missing target rule"));
            assert.ok(!markdown.includes("empty target layer"));
        }
        const overridden = output(await buildOutputs(root, [
            { name: "workflow", option: "strict" },
            { name: "soul", option: "kei" },
        ]), "codex/AGENTS.md");
        assert.ok(overridden.includes("kei soul"));
        assert.ok(overridden.indexOf("strict workflow") < overridden.indexOf("kei soul"));
        assert.equal(downgradeMarkdownHeadings("# One\n\n~~~md\n# Hidden\n~~~"), "## One\n\n~~~md\n# Hidden\n~~~");
        assert.ok(!renderMarkdownToc(["## Same\n\n~~~md\n## Hidden\n~~~"], "AGENTS").includes("Hidden"));
        const tomlText = output(first, "codex/agents/explorer.toml");
        assert.ok(tomlText.includes("developer_instructions = \"\"\"\nRead evidence.\n\"\"\""));
        const toml = parseToml(tomlText);
        assert.ok(String(toml.developer_instructions).includes("Read evidence.\n"));
        assert.equal(toml.temperature, 0.25);
        assert.deepEqual(toml.tags, ["audit", "safe"]);
        assert.deepEqual(toml.limits, { requests: 3 });
        const yaml = parseYaml(output(first, "cursor/agents/explorer.md").split("---\n")[1] ?? "");
        assert.equal(yaml.readonly, true);
        assert.equal(yaml.custom_number, 42);
        assert.deepEqual(yaml.capabilities, { review: true });
        for (const content of first.values())
        {
            assert.ok(!content.includes(0x0d));
            assert.ok(content.toString("utf8").endsWith("\n"));
        }
    });
});

test("generate, stale ownership, and preflight keep valid output safe", async () =>
{
    await withProject(async (root) =>
    {
        await writeAgent(root, "second");
        await generate(root);
        const generated = join(root, ".harness-align", "generated");
        const first = await snapshot(generated);
        await generate(root);
        assert.deepEqual(await snapshot(generated), first);
        await writeFile(join(generated, "unmanaged.txt"), "keep", "utf8");
        await unlink(join(root, ".harness-align", "agents", "second.md"));
        await generate(root);
        await assert.rejects(readFile(join(generated, "codex", "agents", "second.toml")));
        assert.equal(await readFile(join(generated, "unmanaged.txt"), "utf8"), "keep");
        await unlink(join(generated, "unmanaged.txt"));
        await unlink(join(generated, "codex", "AGENTS.md"));
        await generate(root);
        await rm(join(generated, "codex", "AGENTS.md"));
        await mkdir(join(generated, "codex", "AGENTS.md"));
        const before = await snapshot(generated);
        await assert.rejects(generate(root), /managed output must be a file/u);
        assert.deepEqual(await snapshot(generated), before);
    });
});

test("manifest path, encoding, atomic failure, and reparse boundaries are rejected", async () =>
{
    await withProject(async (root) =>
    {
        for (const path of ["../escape", "C:/escape", "a\\b", "."]) assert.throws(() => safeOutputRelative(path), HalignError);
        await writeFile(join(root, ".harness-align", "rules", "bad.md"), Buffer.from([0xff, 0xfe]));
        await assert.rejects(buildOutputs(root), /UTF-8/u);
        await unlink(join(root, ".harness-align", "rules", "bad.md"));
        const target = join(root, "atomic.txt");
        await writeFile(target, "old", "utf8");
        await assert.rejects(atomicWrite(target, Buffer.from("new"), async () =>
        { throw new Error("replace failed"); }), /replace failed/u);
        assert.equal(await readFile(target, "utf8"), "old");
        const rules = join(root, ".harness-align", "rules");
        const redirectedRules = join(root, "redirected-rules");
        await rename(rules, redirectedRules);
        await symlink(redirectedRules, rules, "junction");
        await assert.rejects(buildOutputs(root), /symbolic link sources/u);
        await unlink(rules);
        await rename(redirectedRules, rules);
        await generate(root);
        await rm(join(root, ".harness-align", "generated", "codex"), { recursive: true });
        const redirected = join(root, "redirected");
        await mkdir(redirected);
        await symlink(redirected, join(root, ".harness-align", "generated", "codex"), "junction");
        await assert.rejects(generate(root), /symbolic link outputs/u);
    });
});
test("setup deploys generated harness content into existing roots and shared rules", async () =>
{
    await withProject(async (root) =>
    {
        const userProfile = join(root, "isolated-userprofile");
        await mkdir(join(root, ".harness-align", "rules", "shared"), { recursive: true });
        await writeFile(join(root, ".harness-align", "rules", "shared", "shared.md"), "shared rule\n", "utf8");
        await mkdir(join(userProfile, ".codex", "agents"), { recursive: true });
        await mkdir(join(userProfile, ".config", "opencode", "agents"), { recursive: true });
        await writeFile(join(userProfile, ".codex", "AGENTS.md"), "old codex\n", "utf8");
        await writeFile(join(userProfile, ".codex", "agents", "old.toml"), "old codex agent\n", "utf8");
        await writeFile(join(userProfile, ".config", "opencode", "AGENTS.md"), "old opencode\n", "utf8");
        await writeFile(join(userProfile, ".config", "opencode", "agents", "old.md"), "old opencode agent\n", "utf8");

        await setup(root, undefined, userProfile);

        assert.deepEqual(await snapshot(join(userProfile, ".codex")), await snapshot(join(root, ".harness-align", "generated", "codex")));
        assert.deepEqual(await snapshot(join(userProfile, ".config", "opencode")), await snapshot(join(root, ".harness-align", "generated", "opencode")));
        assert.deepEqual(await snapshot(join(userProfile, ".agents", "shared-rules")), await snapshot(join(root, ".harness-align", "rules", "shared")));
        await assert.rejects(readFile(join(userProfile, ".cursor", "AGENTS.md")));
    });
});

test("setup follows configurable harness names, formats, extensions, and deployment paths", async () =>
{
    await withProject(async (root) =>
    {
        const customConfig = {
            ...config,
            harnesses: [{ name: "atlas", config_path: ".tools/atlas", agent_format: "yaml", agent_extension: "agent" }],
        };
        await writeFile(join(root, ".harness-align", "config.json"), JSON.stringify(customConfig), "utf8");
        await writeRule(root, "base.md", 100, "# Base\n\nbase", ["atlas"]);
        await writeLayerOption(root, "soul", "arona", "# Soul\n\narona soul", ["atlas"]);
        await writeLayerOption(root, "soul", "kei", "# Soul\n\nkei soul", ["atlas"]);
        const agent = [
            "---",
            "name: explorer",
            "description: Read only.",
            "harnesses:",
            "  atlas:",
            "    arbitrary_flag: true",
            "    nested:",
            "      retries: 3",
            "---",
            "",
            "Read custom evidence.",
            "",
        ].join("\n");
        await writeFile(join(root, ".harness-align", "agents", "explorer.md"), agent, "utf8");
        await mkdir(join(root, ".harness-align", "rules", "shared"), { recursive: true });
        await writeFile(join(root, ".harness-align", "rules", "shared", "shared.md"), "shared rule\n", "utf8");

        const userProfile = join(root, "isolated-userprofile");
        const targetRoot = join(userProfile, ".tools", "atlas");
        await mkdir(join(targetRoot, "agents"), { recursive: true });

        await setup(root, undefined, userProfile);

        assert.deepEqual(await snapshot(targetRoot), await snapshot(join(root, ".harness-align", "generated", "atlas")));
        const generatedAgent = await readFile(join(targetRoot, "agents", "explorer.agent"), "utf8");
        const metadata = parseYaml(generatedAgent.split("---\n")[1] ?? "");
        assert.equal(metadata.arbitrary_flag, true);
        assert.deepEqual(metadata.nested, { retries: 3 });
        await assert.rejects(readFile(join(userProfile, ".codex", "AGENTS.md")));
    });
});

test("setup rejects target reparse points before replacing an existing root", async () =>
{
    await withProject(async (root) =>
    {
        const userProfile = join(root, "isolated-userprofile");
        const targetRoot = join(userProfile, ".codex");
        const redirected = join(root, "redirected-target");
        await mkdir(join(root, ".harness-align", "rules", "shared"), { recursive: true });
        await writeFile(join(root, ".harness-align", "rules", "shared", "shared.md"), "shared rule\n", "utf8");
        await mkdir(targetRoot, { recursive: true });
        await writeFile(join(targetRoot, "AGENTS.md"), "keep this file\n", "utf8");
        await mkdir(redirected, { recursive: true });
        await writeFile(join(redirected, "sentinel.txt"), "must remain\n", "utf8");
        await symlink(redirected, join(targetRoot, "agents"), "junction");

        await assert.rejects(setup(root, undefined, userProfile), /reparse points are not allowed/u);
        assert.equal(await readFile(join(targetRoot, "AGENTS.md"), "utf8"), "keep this file\n");
        assert.equal(await readFile(join(redirected, "sentinel.txt"), "utf8"), "must remain\n");
    });
});

test("generate and setup reports list written files and destination directories", async () =>
{
    await withProject(async (root) =>
    {
        await mkdir(join(root, ".harness-align", "rules", "shared"), { recursive: true });
        await writeFile(join(root, ".harness-align", "rules", "shared", "shared.md"), "shared rule\n", "utf8");
        const outputs = await generate(root);
        const generateLog = reportGenerate(outputs);
        assert.ok(generateLog.includes(`Wrote ${outputs.size} files`));
        assert.ok(!generateLog.includes(".harness-align"));
        assert.ok(generateLog.includes("  .manifest.json"));
        assert.ok(generateLog.includes("  codex/AGENTS.md"));
        assert.ok(generateLog.includes("  codex/agents/explorer.toml"));
        assert.ok(generateLog.includes("  cursor/agents/explorer.md"));
        assert.ok(generateLog.includes("  opencode/AGENTS.md"));

        const userProfile = join(root, "isolated-userprofile");
        await mkdir(join(userProfile, ".codex", "agents"), { recursive: true });
        const setupLog = reportSetup(await setup(root, undefined, userProfile));
        assert.ok(setupLog.includes(`Wrote ${outputs.size} files`));
        assert.ok(!setupLog.includes(".harness-align"));
        assert.ok(setupLog.includes(`Updated codex at ${join(userProfile, ".codex")}`));
        assert.ok(setupLog.includes("  agents/explorer.toml"));
        assert.ok(setupLog.includes(`Skipped cursor; target does not exist: ${join(userProfile, ".cursor")}`));
        assert.ok(setupLog.includes(`Skipped opencode; target does not exist: ${join(userProfile, ".config", "opencode")}`));
        assert.ok(setupLog.includes(`Updated shared rules at ${join(userProfile, ".agents", "shared-rules")}`));
        assert.ok(setupLog.includes("  shared.md"));
        assert.ok(setupLog.includes(`Skipped skills; no project skills to deploy: ${join(userProfile, ".agents", "skills")}`));
    });
});

test("edit writes validated sources, cascades harness rename, and rejects path escape", async () =>
{
    await withProject(async (root) =>
    {
        const loaded = await loadConfig(root);
        await saveConfig(root, { ...loaded, name: "Aligned" });
        const written = JSON.parse(await readFile(join(root, ".harness-align", "config.json"), "utf8")) as { layers: Array<{ name: string; selected: string }>; name: string };
        assert.equal(written.name, "Aligned");
        assert.deepEqual(written.layers, [{ name: "soul", selected: "arona" }]);
        const before = await readFile(join(root, ".harness-align", "config.json"), "utf8");
        await assert.rejects(saveConfig(root, {
            ...loaded,
            name: "Aligned",
            harnesses: [
                { name: "a", configPath: ".tools", agentFormat: "yaml", agentExtension: "md" },
                { name: "b", configPath: ".tools/nested", agentFormat: "yaml", agentExtension: "md" },
            ],
        }), /must not overlap/u);
        assert.equal(await readFile(join(root, ".harness-align", "config.json"), "utf8"), before);

        await saveRule(root, { path: ".harness-align/rules/cursor.md", priority: 1, targets: ["cursor"], body: "# Cursor\n\ncursor only" });
        await saveLayerOption(root, { path: ".harness-align/layers/soul/kei.md", targets: ["cursor"], body: "# Soul\n\nkei soul" });
        await saveSharedRule(root, ".harness-align/rules/shared/shared.md", "shared rule");
        await addLayer(root, "mode");
        assert.deepEqual(await readdir(join(root, ".harness-align", "layers", "mode")), []);
        assert.deepEqual((await loadWorkspace(root)).layerOptions.mode, []);
        assert.deepEqual((await loadConfig(root)).layers.map((layer) => layer.name), ["soul"]);
        await addLayerOption(root, "mode", "strict");
        await removeLayerOption(root, "mode", "strict");
        assert.deepEqual(await readdir(join(root, ".harness-align", "layers", "mode")), []);
        await addLayerOption(root, "mode", "fast");
        const withMode = await loadConfig(root);
        await saveConfig(root, { ...withMode, layers: [...withMode.layers, { name: "mode", selected: "fast" }] });
        await addLayerOption(root, "mode", "strict");
        await assert.rejects(removeLayerOption(root, "mode", "fast"), /selected layer option cannot be removed/u);
        await removeLayerOption(root, "mode", "strict");
        await renameLayerOption(root, "mode", "fast", "quick");
        assert.equal((await loadConfig(root)).layers.find((layer) => layer.name === "mode")?.selected, "quick");
        await renameLayer(root, "mode", "workflow");
        assert.equal((await loadConfig(root)).layers.find((layer) => layer.name === "workflow")?.selected, "quick");
        await removeLayer(root, "workflow");
        await assert.rejects(readdir(join(root, ".harness-align", "layers", "workflow")));

        const renamedRuleBody = await readFile(join(root, ".harness-align", "rules", "cursor.md"), "utf8");
        await renameSource(root, ".harness-align/rules/cursor.md", ".harness-align/rules/renamed-cursor.md");
        await assert.rejects(readFile(join(root, ".harness-align", "rules", "cursor.md")));
        assert.equal(await readFile(join(root, ".harness-align", "rules", "renamed-cursor.md"), "utf8"), renamedRuleBody);
        const baseBeforeCollision = await readFile(join(root, ".harness-align", "rules", "base.md"), "utf8");
        await assert.rejects(renameSource(root, ".harness-align/rules/base.md", ".harness-align/rules/renamed-cursor.md"), /destination already exists/u);
        assert.equal(await readFile(join(root, ".harness-align", "rules", "base.md"), "utf8"), baseBeforeCollision);

        const configBeforeInvalidHarness = await readFile(join(root, ".harness-align", "config.json"), "utf8");
        await assert.rejects(updateHarness(root, "cursor", {
            name: "invalid name",
            configPath: ".atlas",
            agentFormat: "toml",
            agentExtension: "toml",
            instructionsField: "instructions",
        }), /name must match/u);
        assert.equal(await readFile(join(root, ".harness-align", "config.json"), "utf8"), configBeforeInvalidHarness);

        await updateHarness(root, "cursor", {
            name: "atlas",
            configPath: ".atlas",
            agentFormat: "toml",
            agentExtension: "toml",
            instructionsField: "instructions",
        });
        const renamed = await loadWorkspace(root);
        assert.deepEqual(renamed.config.harnesses.find((harness) => harness.name === "atlas"), {
            name: "atlas",
            configPath: ".atlas",
            agentFormat: "toml",
            agentExtension: "toml",
            instructionsField: "instructions",
        });
        assert.ok(!renamed.config.harnesses.some((harness) => harness.name === "cursor"));
        assert.deepEqual(renamed.rootRules.map((rule) => rule.path), [".harness-align/rules/renamed-cursor.md", ".harness-align/rules/base.md"]);
        assert.deepEqual(renamed.rootRules.find((rule) => rule.path === ".harness-align/rules/renamed-cursor.md")?.targets, ["atlas"]);
        assert.deepEqual(renamed.layerOptions.soul?.find((option) => option.name === "kei")?.targets, ["atlas"]);
        assert.ok(renamed.agents[0]?.harnesses.atlas);
        assert.equal(renamed.agents[0]?.harnesses.cursor, undefined);
        assert.equal(renamed.sharedRules[0]?.body, "shared rule\n");

        await addHarness(root, { name: "nova", configPath: ".nova", agentFormat: "yaml", agentExtension: "md" });
        await saveAgent(root, {
            path: ".harness-align/agents/explorer.md",
            name: "explorer",
            description: "Read only.",
            harnesses: {
                ...renamed.agents[0]!.harnesses,
                nova: { model: "test-nova" },
            },
            body: "Read evidence.",
        });
        await saveRule(root, { path: ".harness-align/rules/nova.md", priority: 2, targets: ["nova"], body: "# Nova\n\nnova only" });
        await saveLayerOption(root, { path: ".harness-align/layers/soul/kei.md", targets: ["nova"], body: "# Soul\n\nkei soul" });
        await removeHarness(root, "nova");
        const afterRemove = await loadWorkspace(root);
        assert.ok(!afterRemove.config.harnesses.some((harness) => harness.name === "nova"));
        assert.equal(afterRemove.agents[0]?.harnesses.nova, undefined);
        assert.deepEqual(afterRemove.rootRules.find((rule) => rule.path === ".harness-align/rules/nova.md")?.targets, []);
        assert.deepEqual(afterRemove.layerOptions.soul?.find((option) => option.name === "kei")?.targets, []);

        await deleteSource(root, ".harness-align/rules/renamed-cursor.md");
        await assert.rejects(saveRule(root, { path: ".harness-align/rules/../escape.md", priority: 1, targets: [], body: "no" }), /must stay inside \.harness-align/u);
        await assert.rejects(saveRule(root, { path: ".harness-align/generated/x.md", priority: 1, targets: [], body: "no" }), /managed \.harness-align sources/u);
        await assert.rejects(saveSharedRule(root, ".harness-align/rules/base.md", "no"), /must stay under \.harness-align\/rules\/shared/u);
        await assert.rejects(deleteSource(root, ".harness-align/config.json"), /cannot be deleted/u);
        assert.equal((await loadConfig(root)).name, "Aligned");
    });
});

test("legal prototype property Layer names survive discovery and harness cascades", async () =>
{
    await withProject(async (root) =>
    {
        await rm(join(root, ".harness-align", "layers", "soul"), { recursive: true });
        await mkdir(join(root, ".harness-align", "layers", "constructor"), { recursive: true });
        await writeLayerOption(root, "constructor", "arona", "# Soul\n\nprototype-safe soul", ["cursor"]);
        await writeFile(join(root, ".harness-align", "config.json"), JSON.stringify({
            ...config,
            layers: [{ name: "constructor", selected: "arona" }],
        }), "utf8");

        const workspace = await loadWorkspace(root);
        assert.deepEqual(Object.keys(workspace.layerOptions), ["constructor"]);
        assert.equal(Object.values(workspace.layerOptions).length, 1);
        assert.equal(Object.entries(workspace.layerOptions).find(([name]) => name === "constructor")?.[1][0]?.name, "arona");

        const cursor = workspace.config.harnesses.find((harness) => harness.name === "cursor");
        assert.ok(cursor);
        await updateHarness(root, "cursor", { ...cursor, name: "atlas" });
        const renamed = await loadWorkspace(root);
        assert.deepEqual(Object.entries(renamed.layerOptions).find(([name]) => name === "constructor")?.[1][0]?.targets, ["atlas"]);
    });
});

test("skill_sources config omit, write, unknown field, duplicates, version, and skills config_path", async () =>
{
    await withProject(async (root) =>
    {
        const loaded = await loadConfig(root);
        assert.deepEqual(loaded.skillSources, []);
        assert.equal(loaded.version, 1);
        const withSources = await saveConfig(root, {
            ...loaded,
            skillSources: [{ owner: "acme", name: "skills", branch: "main" }],
        });
        assert.deepEqual(withSources.skillSources, [{ owner: "acme", name: "skills", branch: "main" }]);
        const written = JSON.parse(await readFile(join(root, ".harness-align", "config.json"), "utf8")) as { skill_sources?: unknown; version: number };
        assert.equal(written.version, 1);
        assert.deepEqual(written.skill_sources, [{ owner: "acme", name: "skills", branch: "main" }]);
        await assert.rejects(Promise.resolve().then(() => validateConfig({
            ...config,
            skill_sources: [{ owner: "acme", name: "skills", branch: "main", extra: true }],
        })), /unknown field/u);
        await assert.rejects(Promise.resolve().then(() => validateConfig({
            ...config,
            skill_sources: [
                { owner: "acme", name: "skills", branch: "main" },
                { owner: "Acme", name: "Skills", branch: "dev" },
            ],
        })), /owner\/name must be unique/u);
        await assert.rejects(Promise.resolve().then(() => validateConfig({ ...config, version: 2 })), /version must be integer 1/u);
        await assert.rejects(Promise.resolve().then(() => validateConfig({
            ...config,
            harnesses: [{ ...config.harnesses[0], config_path: ".agents/skills" }],
        })), /managed skills target/u);
        await assert.rejects(Promise.resolve().then(() => validateConfig({
            ...config,
            harnesses: [{ ...config.harnesses[0], config_path: ".agents/skills/nested" }],
        })), /managed skills target/u);
        await saveConfig(root, { ...withSources, skillSources: [] });
        const omitted = JSON.parse(await readFile(join(root, ".harness-align", "config.json"), "utf8")) as { skill_sources?: unknown };
        assert.equal(omitted.skill_sources, undefined);
    });
});

test("parseGitHubSkillSource accepts repository URLs and rejects unsupported forms", () =>
{
    assert.deepEqual(parseGitHubSkillSource("https://github.com/acme/skills"), { owner: "acme", name: "skills", branch: "main" });
    assert.deepEqual(parseGitHubSkillSource("https://github.com/acme/skills.git/"), { owner: "acme", name: "skills", branch: "main" });
    assert.deepEqual(parseGitHubSkillSource("https://github.com/acme/skills/tree/develop"), { owner: "acme", name: "skills", branch: "develop" });
    assert.deepEqual(parseGitHubSkillSource("https://github.com/acme/skills", "release"), { owner: "acme", name: "skills", branch: "release" });
    assert.throws(() => parseGitHubSkillSource("https://gist.github.com/acme/skills"), /github\.com\/\{owner\}\/\{repo\}/u);
    assert.throws(() => parseGitHubSkillSource("https://github.com/acme/skills/blob/main/README.md"), /tree\/\{branch\}/u);
    assert.throws(() => parseGitHubSkillSource("https://user:pass@github.com/acme/skills"), /github\.com\/\{owner\}\/\{repo\}/u);
    assert.throws(() => parseGitHubSkillSource("https://gitlab.com/acme/skills"), /github\.com\/\{owner\}\/\{repo\}/u);
});

test("loadSkills tolerates a missing directory, loads SKILL.md, and rejects junk roots", async () =>
{
    await withProject(async (root) =>
    {
        assert.deepEqual(await loadSkills(root), []);
        const workspace = await loadWorkspace(root);
        assert.deepEqual(workspace.skills, []);
        await mkdir(join(root, ".harness-align", "skills", "demo"), { recursive: true });
        await writeFile(join(root, ".harness-align", "skills", "demo", "SKILL.md"), "---\nname: Demo\ndescription: Demo skill\n---\n\nBody.\n", "utf8");
        const skills = await loadSkills(root);
        assert.equal(skills.length, 1);
        assert.equal(skills[0]?.id, "demo");
        assert.equal(skills[0]?.title, "Demo");
        assert.equal(skills[0]?.origin.kind, "unknown");
        await writeFile(join(root, ".harness-align", "skills", "junk.txt"), "nope\n", "utf8");
        await assert.rejects(loadSkills(root), /index.json and skill subdirectories/u);
        await unlink(join(root, ".harness-align", "skills", "junk.txt"));
        await assert.rejects(deleteSource(root, ".harness-align/skills/demo/SKILL.md"), /deleted with removeSkill/u);
    });
});

test("skill hash ignores hidden files and changes when content changes", async () =>
{
    await withProject(async (root) =>
    {
        const skillDir = join(root, "skill-src");
        await mkdir(join(skillDir, ".hidden"), { recursive: true });
        await writeFile(join(skillDir, "SKILL.md"), "---\nname: Demo\n---\n\nBody.\n", "utf8");
        await writeFile(join(skillDir, ".hidden", "secret.bin"), Buffer.from([1, 2, 3]));
        await writeFile(join(skillDir, "notes.txt"), "notes\n", "utf8");
        const first = await hashSkillDirectory(skillDir);
        await writeFile(join(skillDir, ".hidden", "secret.bin"), Buffer.from([9, 9, 9]));
        assert.equal(await hashSkillDirectory(skillDir), first);
        await writeFile(join(skillDir, "notes.txt"), "notes!\n", "utf8");
        assert.notEqual(await hashSkillDirectory(skillDir), first);
    });
});

test("assertSafeZipEntry rejects traversal, absolute, and backslash paths", () =>
{
    assert.equal(assertSafeZipEntry("repo/SKILL.md"), "repo/SKILL.md");
    assert.throws(() => assertSafeZipEntry("../escape"), /unsafe/u);
    assert.throws(() => assertSafeZipEntry("/abs/path"), /relative/u);
    assert.throws(() => assertSafeZipEntry("C:/abs/path"), /relative/u);
    assert.throws(() => assertSafeZipEntry("repo\\SKILL.md"), /unsafe/u);
});

test("installSkillFromDirectory copies a local extracted skill into .harness-align/skills", async () =>
{
    await withProject(async (root) =>
    {
        const source = join(root, "extracted", "demo");
        await mkdir(join(source, "scripts"), { recursive: true });
        await writeFile(join(source, "SKILL.md"), "---\nname: Demo\ndescription: Installed\n---\n\nBody.\n", "utf8");
        await writeFile(join(source, "scripts", "run.bin"), Buffer.from([0, 1, 2, 255]));
        await writeFile(join(source, ".cache"), "skip\n", "utf8");
        await installSkillFromDirectory(root, "demo", source, { kind: "local", contentHash: "unused" });
        const skills = await loadSkills(root);
        assert.equal(skills[0]?.id, "demo");
        assert.equal(skills[0]?.origin.kind, "local");
        assert.deepEqual(await readFile(join(root, ".harness-align", "skills", "demo", "scripts", "run.bin")), Buffer.from([0, 1, 2, 255]));
        await assert.rejects(readFile(join(root, ".harness-align", "skills", "demo", ".cache")));
        await writeFile(join(source, "SKILL.md"), "---\nname: Demo\ndescription: Replaced\n---\n\nNew body.\n", "utf8");
        await installSkillFromDirectory(root, "demo", source, { kind: "local", contentHash: "unused" });
        assert.equal(await readFile(join(root, ".harness-align", "skills", "demo", "SKILL.md"), "utf8"), "---\nname: Demo\ndescription: Replaced\n---\n\nNew body.\n");
        const redirected = join(root, "redirected-nested");
        await mkdir(redirected, { recursive: true });
        await writeFile(join(redirected, "secret.md"), "protected\n", "utf8");
        await symlink(redirected, join(root, ".harness-align", "skills", "demo", "nested"), "junction");
        await writeFile(join(source, "SKILL.md"), "---\nname: Demo\n---\n\nShould not land.\n", "utf8");
        await assert.rejects(installSkillFromDirectory(root, "demo", source, { kind: "local", contentHash: "unused" }), /symbolic link/u);
        assert.equal(await readFile(join(redirected, "secret.md"), "utf8"), "protected\n");
        assert.equal(await readFile(join(root, ".harness-align", "skills", "demo", "SKILL.md"), "utf8"), "---\nname: Demo\ndescription: Replaced\n---\n\nNew body.\n");
    });
});

test("importUserSkills respects overwrite and records local origin", async () =>
{
    await withProject(async (root) =>
    {
        const userProfile = join(root, "isolated-userprofile");
        const userSkill = join(userProfile, ".agents", "skills", "demo");
        await mkdir(userSkill, { recursive: true });
        await writeFile(join(userSkill, "SKILL.md"), "---\nname: User Demo\n---\n\nFrom user.\n", "utf8");
        const report = await importUserSkills(root, ["demo"], false, userProfile);
        assert.ok(report.includes("demo"));
        assert.equal((await loadSkills(root))[0]?.origin.kind, "local");
        await writeFile(join(userSkill, "SKILL.md"), "---\nname: User Demo\n---\n\nUpdated user.\n", "utf8");
        await assert.rejects(importUserSkills(root, ["demo"], false, userProfile), /already exists/u);
        await importUserSkills(root, ["demo"], true, userProfile);
        assert.equal(await readFile(join(root, ".harness-align", "skills", "demo", "SKILL.md"), "utf8"), "---\nname: User Demo\n---\n\nUpdated user.\n");
        assert.equal((await loadSkills(root))[0]?.origin.kind, "local");
        await installSkillFromDirectory(root, "demo", userSkill, {
            kind: "github",
            owner: "acme",
            name: "skills",
            branch: "main",
            sourcePath: "demo",
            contentHash: "remote",
        }, true);
        assert.equal((await loadSkills(root))[0]?.origin.kind, "github");
        await writeFile(join(userSkill, "SKILL.md"), "---\nname: User Demo\n---\n\nImported over github.\n", "utf8");
        await importUserSkills(root, ["demo"], true, userProfile);
        assert.equal(await readFile(join(root, ".harness-align", "skills", "demo", "SKILL.md"), "utf8"), "---\nname: User Demo\n---\n\nImported over github.\n");
        assert.equal((await loadSkills(root))[0]?.origin.kind, "local");
    });
});

test("listUserSkills skips reparse skill directories", async () =>
{
    await withProject(async (root) =>
    {
        const userProfile = join(root, "isolated-userprofile");
        const skillsRoot = join(userProfile, ".agents", "skills");
        const real = join(skillsRoot, "real");
        await mkdir(real, { recursive: true });
        await writeFile(join(real, "SKILL.md"), "---\nname: Real\n---\n\nBody.\n", "utf8");
        const redirected = join(userProfile, "redirected-skill");
        await mkdir(redirected, { recursive: true });
        await writeFile(join(redirected, "SKILL.md"), "---\nname: Linked\n---\n\nBody.\n", "utf8");
        await symlink(redirected, join(skillsRoot, "linked"), "junction");
        const skills = await listUserSkills(userProfile);
        assert.deepEqual(skills.map((skill) => skill.id), ["real"]);
    });
});

test("removeSkill deletes the skill directory and index entry", async () =>
{
    await withProject(async (root) =>
    {
        const source = join(root, "extracted", "demo");
        await mkdir(source, { recursive: true });
        await writeFile(join(source, "SKILL.md"), "---\nname: Demo\n---\n\nBody.\n", "utf8");
        await installSkillFromDirectory(root, "demo", source, { kind: "local", contentHash: "x" });
        await removeSkill(root, "demo");
        assert.deepEqual(await loadSkills(root), []);
        await assert.rejects(readdir(join(root, ".harness-align", "skills", "demo")));
        const index = JSON.parse(await readFile(join(root, ".harness-align", "skills", "index.json"), "utf8")) as { skills: Record<string, unknown> };
        assert.deepEqual(index.skills, {});
    });
});

test("setup without skills succeeds and keeps unrelated user skills", async () =>
{
    await withProject(async (root) =>
    {
        await mkdir(join(root, ".harness-align", "rules", "shared"), { recursive: true });
        await writeFile(join(root, ".harness-align", "rules", "shared", "shared.md"), "shared rule\n", "utf8");
        const userProfile = join(root, "isolated-userprofile");
        await mkdir(join(userProfile, ".codex", "agents"), { recursive: true });
        await mkdir(join(userProfile, ".agents", "skills", "unrelated"), { recursive: true });
        await writeFile(join(userProfile, ".agents", "skills", "unrelated", "SKILL.md"), "keep\n", "utf8");
        const result = await setup(root, undefined, userProfile);
        assert.equal(result.skills.skipped, true);
        assert.equal(await readFile(join(userProfile, ".agents", "skills", "unrelated", "SKILL.md"), "utf8"), "keep\n");
    });
});

test("setup overwrites same-name skills and keeps unrelated siblings", async () =>
{
    await withProject(async (root) =>
    {
        await mkdir(join(root, ".harness-align", "rules", "shared"), { recursive: true });
        await writeFile(join(root, ".harness-align", "rules", "shared", "shared.md"), "shared rule\n", "utf8");
        const source = join(root, "extracted", "demo");
        await mkdir(source, { recursive: true });
        await writeFile(join(source, "SKILL.md"), "---\nname: Demo\n---\n\nProject skill.\n", "utf8");
        await installSkillFromDirectory(root, "demo", source, { kind: "local", contentHash: "x" });
        const userProfile = join(root, "isolated-userprofile");
        await mkdir(join(userProfile, ".codex", "agents"), { recursive: true });
        await mkdir(join(userProfile, ".agents", "skills", "demo"), { recursive: true });
        await mkdir(join(userProfile, ".agents", "skills", "unrelated"), { recursive: true });
        await writeFile(join(userProfile, ".agents", "skills", "demo", "SKILL.md"), "old\n", "utf8");
        await writeFile(join(userProfile, ".agents", "skills", "unrelated", "SKILL.md"), "keep\n", "utf8");
        const result = await setup(root, undefined, userProfile);
        assert.equal(result.skills.skipped, false);
        assert.deepEqual(result.skills.ids, ["demo"]);
        assert.equal(await readFile(join(userProfile, ".agents", "skills", "demo", "SKILL.md"), "utf8"), "---\nname: Demo\n---\n\nProject skill.\n");
        assert.equal(await readFile(join(userProfile, ".agents", "skills", "unrelated", "SKILL.md"), "utf8"), "keep\n");
        assert.ok(reportSetup(result).includes(`Updated skills at ${join(userProfile, ".agents", "skills")}`));
        assert.ok(reportSetup(result).includes("  demo"));
    });
});

test("setup rejects a junction at the target skill directory before deleting anything", async () =>
{
    await withProject(async (root) =>
    {
        await mkdir(join(root, ".harness-align", "rules", "shared"), { recursive: true });
        await writeFile(join(root, ".harness-align", "rules", "shared", "shared.md"), "shared rule\n", "utf8");
        const source = join(root, "extracted", "demo");
        await mkdir(source, { recursive: true });
        await writeFile(join(source, "SKILL.md"), "---\nname: Demo\n---\n\nProject skill.\n", "utf8");
        await installSkillFromDirectory(root, "demo", source, { kind: "local", contentHash: "x" });
        const userProfile = join(root, "isolated-userprofile");
        await mkdir(join(userProfile, ".codex", "agents"), { recursive: true });
        await mkdir(join(userProfile, ".agents", "skills"), { recursive: true });
        const redirected = join(root, "redirected-skill");
        await mkdir(redirected, { recursive: true });
        await writeFile(join(redirected, "SKILL.md"), "protected\n", "utf8");
        await symlink(redirected, join(userProfile, ".agents", "skills", "demo"), "junction");
        await assert.rejects(setup(root, undefined, userProfile), /reparse points are not allowed/u);
        assert.equal(await readFile(join(redirected, "SKILL.md"), "utf8"), "protected\n");
    });
});

test("generate ignores project skills", async () =>
{
    await withProject(async (root) =>
    {
        const source = join(root, "extracted", "demo");
        await mkdir(source, { recursive: true });
        await writeFile(join(source, "SKILL.md"), "---\nname: Demo\n---\n\nBody.\n", "utf8");
        await installSkillFromDirectory(root, "demo", source, { kind: "local", contentHash: "x" });
        const outputs = await generate(root);
        assert.equal([...outputs.keys()].some((path) => path.includes("skill")), false);
        for (const [path, content] of outputs)
        {
            if (path.endsWith("AGENTS.md")) assert.equal(content.toString("utf8").includes("demo"), false);
        }
        const manifest = JSON.parse(await readFile(join(root, ".harness-align", "generated", ".manifest.json"), "utf8")) as { files: string[] };
        assert.equal(manifest.files.some((path) => path.includes("skill")), false);
    });
});

test("addSkillSource and removeSkillSource round-trip through configDocument", async () =>
{
    await withProject(async (root) =>
    {
        const added = await addSkillSource(root, { url: "https://github.com/acme/toolkit", branch: "release" });
        assert.deepEqual(added.skillSources, [{ owner: "acme", name: "toolkit", branch: "release" }]);
        const removed = await removeSkillSource(root, "acme", "toolkit");
        assert.deepEqual(removed.skillSources, []);
    });
});

test("ensureUserWorkspace creates a default user config once", async () =>
{
    const home = await mkdtemp(join(tmpdir(), "halign-home-"));
    try
    {
        const root = await ensureUserWorkspace(home);
        assert.equal(root, resolve(home));
        const created = JSON.parse(await readFile(join(home, ".harness-align", "config.json"), "utf8")) as { name: string; harnesses: unknown[] };
        assert.equal(created.name, "AGENTS");
        assert.ok(created.harnesses.length > 0);
        await loadWorkspace(home);
        created.name = "KEEP";
        await writeFile(join(home, ".harness-align", "config.json"), `${JSON.stringify(created, null, 2)}\n`, "utf8");
        await ensureUserWorkspace(home);
        const kept = JSON.parse(await readFile(join(home, ".harness-align", "config.json"), "utf8")) as { name: string };
        assert.equal(kept.name, "KEEP");
    }
    finally
    {
        await rm(home, { recursive: true, force: true });
    }
});

test("workspace migration preserves all legacy files and is idempotent", async () =>
{
    await withProject(async (root) =>
    {
        const current = join(root, ".harness-align");
        const legacy = join(root, ".halign");
        await mkdir(join(current, "skills", "demo"), { recursive: true });
        await writeFile(join(current, "skills", "demo", "SKILL.md"), "# Demo\n", "utf8");
        await generate(root);
        await writeFile(join(current, "custom.bin"), Buffer.from([0, 255, 13, 10]));
        const before = await snapshot(current);
        await rename(current, legacy);
        assert.equal(await ensureUserWorkspace(root), root);
        assert.deepEqual(await snapshot(current), before);
        await assert.rejects(readdir(legacy), /ENOENT/u);
        const workspace = await loadWorkspace(root);
        assert.equal(workspace.config.name, config.name);
        assert.equal(workspace.skills[0]?.id, "demo");
        await ensureUserWorkspace(root);
        assert.deepEqual(await snapshot(current), before);
    });
});

test("workspace service coalesces migration and retries initialization after failure", async () =>
{
    await withProject(async (root) =>
    {
        const previousHome = process.env.USERPROFILE;
        const current = join(root, ".harness-align");
        const legacy = join(root, ".halign");
        const before = await snapshot(current);
        await rename(current, legacy);
        process.env.USERPROFILE = root;
        try
        {
            const workspaces = await Promise.all([workspaceService.load(), workspaceService.load()]);
            assert.deepEqual(workspaces[0], workspaces[1]);
            assert.equal("root" in workspaces[0]!, false);
            assert.deepEqual(await snapshot(current), before);
            await rename(current, legacy);
            await writeFile(current, "invalid directory", "utf8");
            await assert.rejects(workspaceService.load(), /expected a directory/u);
            await unlink(current);
            const retried = await workspaceService.load();
            assert.deepEqual(retried, workspaces[0]);
            assert.deepEqual(await snapshot(current), before);
        }
        finally
        {
            if (previousHome === undefined) delete process.env.USERPROFILE;
            else process.env.USERPROFILE = previousHome;
        }
    });
});

test("workspace migration keeps both directories when the new workspace exists", async () =>
{
    await withProject(async (root) =>
    {
        const current = join(root, ".harness-align");
        const legacy = join(root, ".halign");
        await mkdir(legacy);
        await writeFile(join(legacy, "config.json"), "legacy sentinel", "utf8");
        const before = await snapshot(current);
        await ensureUserWorkspace(root);
        assert.deepEqual(await snapshot(current), before);
        assert.equal(await readFile(join(legacy, "config.json"), "utf8"), "legacy sentinel");
    });
});

test("workspace migration rejects files and junctions without moving legacy data", async () =>
{
    await withProject(async (root) =>
    {
        const current = join(root, ".harness-align");
        const legacy = join(root, ".halign");
        const redirected = join(root, "redirected");
        await rename(current, legacy);
        await mkdir(redirected);
        await writeFile(join(redirected, "sentinel.txt"), "keep", "utf8");
        const before = await snapshot(legacy);
        const nestedLink = join(legacy, "nested-link");
        await symlink(redirected, nestedLink, "junction");
        try
        {
            await assert.rejects(ensureUserWorkspace(root), /symbolic link sources/u);
            await assert.rejects(readdir(current), /ENOENT/u);
        }
        finally
        {
            await unlink(nestedLink);
        }
        await rename(legacy, join(root, "legacy-backup"));
        await symlink(redirected, legacy, "junction");
        try
        {
            await assert.rejects(ensureUserWorkspace(root), /symbolic link sources/u);
        }
        finally
        {
            await unlink(legacy);
        }
        await writeFile(legacy, "keep", "utf8");
        await assert.rejects(ensureUserWorkspace(root), /expected a directory for migration/u);
        assert.equal(await readFile(legacy, "utf8"), "keep");
        await unlink(legacy);
        await rename(join(root, "legacy-backup"), legacy);
        await writeFile(current, "keep", "utf8");
        await assert.rejects(ensureUserWorkspace(root), /expected a directory/u);
        await unlink(current);
        await symlink(redirected, current, "junction");
        try
        {
            await assert.rejects(ensureUserWorkspace(root), /symbolic link sources/u);
        }
        finally
        {
            await unlink(current);
        }
        assert.deepEqual(await snapshot(legacy), before);
        assert.equal(await readFile(join(redirected, "sentinel.txt"), "utf8"), "keep");
    });
});

test("workspace initialization uses USERPROFILE not the current working directory", async () =>
{
    const home = await mkdtemp(join(tmpdir(), "harness-align-home-"));
    const cwd = await mkdtemp(join(tmpdir(), "halign-cli-cwd-"));
    const previous = process.cwd();
    try
    {
        await mkdir(join(cwd, ".harness-align", "rules", "shared"), { recursive: true });
        await writeFile(join(cwd, ".harness-align", "config.json"), JSON.stringify({
            ...config,
            name: "CWD",
            harnesses: [{ name: "cursor", config_path: ".cursor", agent_format: "yaml", agent_extension: "md" }],
        }), "utf8");
        process.chdir(cwd);
        await generate(await ensureUserWorkspace(home));
        const generated = JSON.parse(await readFile(join(home, ".harness-align", "config.json"), "utf8")) as { name: string };
        assert.equal(generated.name, "AGENTS");
        assert.equal(await readFile(join(home, ".harness-align", "generated", "cursor", "AGENTS.md"), "utf8").then(() => true), true);
        await assert.rejects(readFile(join(cwd, ".harness-align", "generated", "cursor", "AGENTS.md")), /ENOENT/u);
    }
    finally
    {
        process.chdir(previous);
        await rm(home, { recursive: true, force: true });
        await rm(cwd, { recursive: true, force: true });
    }
});

test("setup on a fresh user workspace deploys empty agents and skips missing harness roots", async () =>
{
    const home = await mkdtemp(join(tmpdir(), "halign-fresh-setup-"));
    try
    {
        await ensureUserWorkspace(home);
        await mkdir(join(home, ".cursor"), { recursive: true });
        const result = await setup(home, undefined, home);
        const cursor = result.targets.find((target) => target.harness === "cursor");
        assert.ok(cursor);
        assert.equal(cursor.skipped, false);
        assert.deepEqual(cursor.files, ["AGENTS.md"]);
        assert.equal(result.targets.filter((target) => target.skipped).length, 2);
        assert.equal(await readFile(join(home, ".cursor", "AGENTS.md"), "utf8").then((content) => content.includes("Generated by Harness Align")), true);
        assert.deepEqual(await readdir(join(home, ".cursor", "agents")), []);
        assert.ok(await readdir(join(home, ".agents", "shared-rules")).then(() => true));
    }
    finally
    {
        await rm(home, { recursive: true, force: true });
    }
});

test("manifest aliases cannot delete current outputs or manage the manifest itself", async () =>
{
    await withProject(async (root) =>
    {
        await generate(root);
        const directory = join(root, ".harness-align", "generated");
        const manifest = join(directory, ".manifest.json");
        const rules = await readFile(join(directory, "codex", "AGENTS.md"));
        for (const path of ["codex//AGENTS.md", "codex/AGENTS.md/", "codex/AGENTS.md.", "codex/AGENTS.md:stream", "codex/NUL.md"])
        {
            await writeFile(manifest, JSON.stringify({ version: 1, files: [path] }));
            await assert.rejects(generate(root), HalignError);
            assert.deepEqual(await readFile(join(directory, "codex", "AGENTS.md")), rules);
        }
        if (process.platform === "win32")
        {
            await writeFile(manifest, JSON.stringify({ version: 1, files: ["CODEX/AGENTS.MD"] }));
            await generate(root);
            assert.deepEqual(await readFile(join(directory, "codex", "AGENTS.md")), rules);
            for (const files of [[".MANIFEST.JSON"], ["codex/AGENTS.md", "CODEX/AGENTS.MD"]])
            {
                await writeFile(manifest, JSON.stringify({ version: 1, files }));
                await assert.rejects(generate(root), HalignError);
            }
        }
    });
});

test("Windows path aliases cannot cross source or deployment boundaries", async () =>
{
    await withProject(async (root) =>
    {
        for (const configPath of [".harness-align.", ".agents/shared-rules ", ".codex:stream", "con.txt"])
        {
            const next = structuredClone(config);
            next.harnesses[0]!.config_path = configPath;
            assert.throws(() => validateConfig(next), HalignError);
        }
        for (const path of [".harness-align/rules/shared./x.md", ".harness-align/rules/NUL.md", ".harness-align/rules/x:stream.md"])
        {
            await assert.rejects(saveRule(root, { path, priority: 1, targets: [], body: "# Rule" }), HalignError);
        }
        for (const path of ["skill/file:stream", "skill/CON.txt", "skill/trailing."])
        {
            assert.throws(() => assertSafeZipEntry(path), HalignError);
        }
        if (process.platform === "win32")
        {
            await mkdir(join(root, ".harness-align", "rules", "Shared"));
            await writeFile(join(root, ".harness-align", "rules", "Shared", "shared.md"), "# Shared body\n");
            const workspace = await loadWorkspace(root);
            assert.equal(workspace.rootRules.length, 1);
            assert.equal(workspace.sharedRules.length, 1);
            await assert.rejects(saveRule(root, { path: ".harness-align/rules/SHARED/shared.md", priority: 0, targets: [], body: "# Wrong" }), /shared rules/u);
            await assert.rejects(renameSource(root, ".harness-align/rules/base.md", ".harness-align/rules/SHARED/moved.md"), /one root-rule/u);
        }
    });
});

test("config writes reject broken source references before changing the file", async () =>
{
    await withProject(async (root) =>
    {
        const before = await snapshot(join(root, ".harness-align"));
        const loaded = await loadConfig(root);
        await assert.rejects(saveConfig(root, { ...loaded, harnesses: loaded.harnesses.filter((harness) => harness.name !== "codex") }), HalignError);
        assert.deepEqual(await snapshot(join(root, ".harness-align")), before);
    });
});

test("harness removal restores every completed source write after a later failure", async (t) =>
{
    await withProject(async (root) =>
    {
        const before = await snapshot(join(root, ".harness-align"));
        const originalRename = fs.rename;
        let failed = false;
        const mocked = t.mock.method(fs, "rename", async (...args: Parameters<typeof fs.rename>) =>
        {
            if (!failed && String(args[1]) === join(root, ".harness-align", "agents", "explorer.md"))
            {
                failed = true;
                throw new Error("Injected source write failure");
            }
            return originalRename(...args);
        });
        try
        {
            await assert.rejects(removeHarness(root, "codex"), /Injected source write failure/u);
            assert.equal(failed, true);
            assert.deepEqual(await snapshot(join(root, ".harness-align")), before);
            await loadWorkspace(root);
        }
        finally
        {
            mocked.mock.restore();
        }
    });
});

test("setup staging and swap failures preserve previously deployed files", async (t) =>
{
    await withProject(async (root) =>
    {
        const home = join(root, "test-home");
        await mkdir(join(home, ".codex", "agents"), { recursive: true });
        await mkdir(join(home, ".agents", "shared-rules"), { recursive: true });
        await mkdir(join(root, ".harness-align", "rules", "shared"));
        await writeFile(join(root, ".harness-align", "rules", "shared", "new.md"), "# New shared\n");
        await writeFile(join(home, ".codex", "agents", "old.toml"), "old agent");
        await writeFile(join(home, ".codex", "AGENTS.md"), "old rules");
        await writeFile(join(home, ".agents", "shared-rules", "old.md"), "old shared");
        const before = await snapshot(home);
        const originalCopy = fs.cp;
        const copying = t.mock.method(fs, "cp", async (...args: Parameters<typeof fs.cp>) =>
        {
            if (String(args[0]) === join(root, ".harness-align", "rules", "shared")) throw new Error("Injected copy failure");
            return originalCopy(...args);
        });
        try
        {
            await assert.rejects(setup(root, undefined, home), /Injected copy failure/u);
            assert.deepEqual(await snapshot(home), before);
        }
        finally
        {
            copying.mock.restore();
        }
        const originalRename = fs.rename;
        let failed = false;
        const swapping = t.mock.method(fs, "rename", async (...args: Parameters<typeof fs.rename>) =>
        {
            if (!failed && String(args[0]).includes(".harness-align-stage-") && String(args[1]) === join(home, ".agents", "shared-rules"))
            {
                failed = true;
                throw new Error("Injected swap failure");
            }
            return originalRename(...args);
        });
        try
        {
            await assert.rejects(setup(root, undefined, home), /Injected swap failure/u);
            assert.equal(failed, true);
            assert.deepEqual(await snapshot(home), before);
        }
        finally
        {
            swapping.mock.restore();
        }
    });
});

test("failed skill index writes roll back both first installs and replacements", async (t) =>
{
    await withProject(async (root) =>
    {
        const source = join(root, "incoming-skill");
        await mkdir(source);
        await writeFile(join(source, "SKILL.md"), "# Original\n");
        for (const replacing of [false, true])
        {
            if (replacing) await installSkillFromDirectory(root, "demo", source, { kind: "local", contentHash: "" });
            await writeFile(join(source, "SKILL.md"), "# Updated\n");
            const before = await snapshot(join(root, ".harness-align"));
            const originalRename = fs.rename;
            const mocked = t.mock.method(fs, "rename", async (...args: Parameters<typeof fs.rename>) =>
            {
                if (String(args[1]) === join(root, ".harness-align", "skills", "index.json")) throw new Error("Injected index failure");
                return originalRename(...args);
            });
            try
            {
                await assert.rejects(installSkillFromDirectory(root, "demo", source, { kind: "local", contentHash: "" }), /Injected index failure/u);
                assert.deepEqual(await snapshot(join(root, ".harness-align")), before);
            }
            finally
            {
                mocked.mock.restore();
            }
            await writeFile(join(source, "SKILL.md"), "# Original\n");
        }
    });
});

test("skill import validates the complete request before installing any item", async () =>
{
    await withProject(async (root) =>
    {
        const home = join(root, "test-home");
        await mkdir(join(home, ".agents", "skills", "demo"), { recursive: true });
        await writeFile(join(home, ".agents", "skills", "demo", "SKILL.md"), "# Demo\n");
        const before = await snapshot(join(root, ".harness-align"));
        await assert.rejects(importUserSkills(root, ["demo"], "false" as never, home), /boolean/u);
        await assert.rejects(importUserSkills(root, ["demo", "missing"], false, home), /does not exist/u);
        assert.deepEqual(await snapshot(join(root, ".harness-align")), before);
    });
});

test("workspace operations serialize writes and reads and recover after rejection", async () =>
{
    await withProject(async (root) =>
    {
        const previousHome = process.env.USERPROFILE;
        process.env.USERPROFILE = root;
        try
        {
            const [first, second, loaded] = await Promise.all([
                workspaceService.addHarness({ name: "alpha", configPath: ".alpha", agentFormat: "yaml", agentExtension: "md" }),
                workspaceService.addHarness({ name: "beta", configPath: ".beta", agentFormat: "yaml", agentExtension: "md" }),
                workspaceService.load(),
            ]);
            assert.equal(first.harnesses.length, 4);
            assert.equal(second.harnesses.length, 5);
            assert.equal(loaded.config.harnesses.length, 5);
            const outcomes = await Promise.allSettled([workspaceService.removeHarness("missing"), workspaceService.load()]);
            assert.equal(outcomes[0]?.status, "rejected");
            assert.equal(outcomes[1]?.status, "fulfilled");
        }
        finally
        {
            if (previousHome === undefined) delete process.env.USERPROFILE;
            else process.env.USERPROFILE = previousHome;
        }
    });
});

test("IPC payload schemas reject coercion and incomplete editor shapes", () =>
{
    for (const value of [null, {}, { path: "rule.md", priority: 1, body: "# Rule" }, { path: "rule.md", priority: "1", targets: [], body: "# Rule" }])
    {
        assert.equal(RULE_INPUT_SCHEMA.safeParse(value).success, false);
    }
    assert.equal(CONFIG_SCHEMA.safeParse({}).success, false);
    assert.equal(AGENT_SCHEMA.safeParse({ path: "agent.md", name: "agent", description: "Agent", body: "# Agent", harnesses: { codex: [] } }).success, false);
    assert.equal(LAYER_SELECTION_SCHEMA.safeParse([{ name: "layer" }]).success, false);
    assert.equal(SKILL_IDS_SCHEMA.safeParse(["Demo", "demo"]).success, false);
    assert.equal(SKILL_IDS_SCHEMA.safeParse("demo").success, false);
});

test("discovery cache no longer installs skills after their source is removed", async (t) =>
{
    await withProject(async (root) =>
    {
        await addSkillSource(root, { url: "https://github.com/example/repo" });
        const mocked = t.mock.method(globalThis, "fetch", async () => new Response(TEST_SKILL_ARCHIVE, { status: 200 }));
        try
        {
            assert.equal((await discoverSkills(root))[0]?.id, "demo");
            await removeSkillSource(root, "example", "repo");
            await assert.rejects(installSkills(root, ["demo"]), /latest discover results/u);
            assert.deepEqual(await loadSkills(root), []);
        }
        finally
        {
            mocked.mock.restore();
        }
    });
});

test("discovery preserves network errors and only falls back to another branch on HTTP 404", async (t) =>
{
    await withProject(async (root) =>
    {
        await addSkillSource(root, { url: "https://github.com/example/repo" });
        let mode = "network";
        const requests: string[] = [];
        const mocked = t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0]) =>
        {
            requests.push(String(url));
            if (mode === "network") throw new TypeError("fetch failed", { cause: Object.assign(new Error("connection timed out"), { code: "ETIMEDOUT" }) });
            if (mode === "unavailable") return new Response(null, { status: 503 });
            return requests.length === 1 ? new Response(null, { status: 404 }) : new Response(TEST_SKILL_ARCHIVE);
        });
        try
        {
            await assert.rejects(discoverSkills(root), /example\/repo@main.*fetch failed: connection timed out \(ETIMEDOUT\)/u);
            assert.equal(requests.length, 1);
            mode = "unavailable";
            requests.length = 0;
            await assert.rejects(discoverSkills(root), /example\/repo@main.*HTTP 503/u);
            assert.equal(requests.length, 1);
            mode = "fallback";
            requests.length = 0;
            assert.equal((await discoverSkills(root))[0]?.branch, "master");
            assert.deepEqual(requests.map((url) => new URL(url).pathname), ["/example/repo/archive/refs/heads/main.zip", "/example/repo/archive/refs/heads/master.zip"]);
        }
        finally
        {
            mocked.mock.restore();
        }
    });
});

test("discovery times out once without retrying a different branch", async (t) =>
{
    await withProject(async (root) =>
    {
        await addSkillSource(root, { url: "https://github.com/example/repo" });
        let markStarted: () => void = () => undefined;
        const started = new Promise<void>((resolveStarted) => { markStarted = resolveStarted; });
        const mocked = t.mock.method(globalThis, "fetch", async (_url: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) => new Promise<Response>((_resolve, reject) =>
        {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
            markStarted();
        }));
        t.mock.timers.enable({ apis: ["setTimeout"] });
        try
        {
            const discovery = discoverSkills(root);
            const rejected = assert.rejects(discovery, /example\/repo@main.*timed out after 60s/u);
            await started;
            t.mock.timers.tick(60_000);
            await rejected;
            assert.equal(mocked.mock.callCount(), 1);
        }
        finally
        {
            t.mock.timers.reset();
            mocked.mock.restore();
        }
    });
});
