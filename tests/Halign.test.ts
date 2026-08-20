/**
 * Engine tests against temporary directories.
 * Do not use this repository as a `.halign` config root, and do not open Electron windows here.
 */

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import { atomicWrite, addHarness, addLayer, addLayerOption, buildOutputs, check, deleteSource, downgradeMarkdownHeadings, generate, HalignError, loadConfig, loadWorkspace, removeHarness, removeLayer, removeLayerOption, renameHarness, renameLayer, renameLayerOption, renderMarkdownToc, reportGenerate, reportSetup, safeOutputRelative, saveAgent, saveConfig, saveLayerOption, saveRule, saveSharedRule, setup } from "../src/engine/Halign.js";

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

/** Create a temporary `.halign` project, run the case, then delete the directory. */
async function withProject(run: (root: string) => Promise<void>): Promise<void>
{
    const root = await mkdtemp(join(tmpdir(), "halign-ts-"));
    try
    {
        await mkdir(join(root, ".halign", "rules"), { recursive: true });
        await mkdir(join(root, ".halign", "layers", "soul"), { recursive: true });
        await mkdir(join(root, ".halign", "agents"), { recursive: true });
        await writeFile(join(root, ".halign", "config.json"), JSON.stringify(config), "utf8");
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

/** Write one selectable Layer option, with optional target metadata. */
async function writeLayerOption(root: string, layer: string, option: string, body: string, targets?: string[]): Promise<void>
{
    const frontmatter = targets ? `---\ntargets:\n${targets.map((target) => `  - ${target}\n`).join("")}---\n\n` : "";
    await writeFile(join(root, ".halign", "layers", layer, `${option}.md`), `${frontmatter}${body}`, "utf8");
}

/** Write a root rule markdown file under `.halign/rules`. */
async function writeRule(root: string, name: string, priority: number, body: string, targets?: string[]): Promise<void>
{
    const targetLines = targets ? "targets:\n" + targets.map((target) => "  - " + target + "\n").join("") : "";
    await writeFile(join(root, ".halign", "rules", name), "---\npriority: " + priority + "\n" + targetLines + "---\n\n" + body + "\n", "utf8");
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
    await writeFile(join(root, ".halign", "agents", name + ".md"), content, "utf8");
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

test("config and metadata validation reject unsafe input", async () =>
{
    await withProject(async (root) =>
    {
        await writeFile(join(root, ".halign", "config.json"), JSON.stringify({ ...config, layers: [{ name: "../x", selected: "arona" }] }), "utf8");
        await assert.rejects(buildOutputs(root), /name must match/u);
        await writeFile(join(root, ".halign", "config.json"), JSON.stringify({ ...config, harnesses: [{ ...config.harnesses[0], config_path: "../escape" }] }), "utf8");
        await assert.rejects(buildOutputs(root), /normalized relative path/u);
        await writeFile(join(root, ".halign", "config.json"), JSON.stringify({ ...config, harnesses: [
            { ...config.harnesses[0], config_path: ".tools" },
            { ...config.harnesses[1], config_path: ".tools/nested" },
        ] }), "utf8");
        await assert.rejects(buildOutputs(root), /must not overlap/u);
        await writeFile(join(root, ".halign", "config.json"), JSON.stringify({ ...config, harnesses: [
            { ...config.harnesses[0], config_path: ".agents/shared-rules/custom" },
        ] }), "utf8");
        await assert.rejects(buildOutputs(root), /managed shared rules target/u);
        await writeFile(join(root, ".halign", "config.json"), JSON.stringify({ ...config, version: 2 }), "utf8");
        await assert.rejects(buildOutputs(root), /version must be integer 1/u);
        await writeFile(join(root, ".halign", "config.json"), JSON.stringify({ ...config, profiles: ["legacy"] }), "utf8");
        await assert.rejects(buildOutputs(root), /unknown field "profiles"/u);
        await writeFile(join(root, ".halign", "config.json"), JSON.stringify({ ...config, harnesses: [{ ...config.harnesses[1], extra: true }] }), "utf8");
        await assert.rejects(buildOutputs(root), /unknown field/u);
        await writeFile(join(root, ".halign", "config.json"), JSON.stringify({ ...config, harnesses: [{ ...config.harnesses[1], agent_format: "json" }] }), "utf8");
        await assert.rejects(buildOutputs(root), /agent_format must be toml or yaml/u);
        await writeFile(join(root, ".halign", "config.json"), JSON.stringify({ ...config, harnesses: [{ ...config.harnesses[1], agent_extension: ".md" }] }), "utf8");
        await assert.rejects(buildOutputs(root), /agent_extension must match/u);
        await writeFile(join(root, ".halign", "config.json"), JSON.stringify({ ...config, harnesses: [{ ...config.harnesses[0], instructions_field: undefined }] }), "utf8");
        await assert.rejects(buildOutputs(root), /instructions_field is required/u);
        await writeFile(join(root, ".halign", "config.json"), JSON.stringify({ ...config, harnesses: [{ ...config.harnesses[1], instructions_field: "developer_instructions" }] }), "utf8");
        await assert.rejects(buildOutputs(root), /instructions_field is only supported when agent_format is toml/u);
        await writeFile(join(root, ".halign", "config.json"), JSON.stringify({ ...config, harnesses: [{ ...config.harnesses[0], instructions_field: "name" }] }), "utf8");
        await assert.rejects(buildOutputs(root), /other than name or description/u);
        await writeFile(join(root, ".halign", "config.json"), JSON.stringify({
            ...config,
            harnesses: [config.harnesses[0], { ...config.harnesses[0], config_path: ".other" }],
        }), "utf8");
        await assert.rejects(buildOutputs(root), /harness names must be unique/u);
        await writeFile(join(root, ".halign", "config.json"), JSON.stringify(config), "utf8");
        await writeFile(join(root, ".halign", "agents", "explorer.md"), "---\nname: explorer\ndescription: Read only.\nharnesses:\n  codex:\n    developer_instructions: stolen\n---\n\nbody\n", "utf8");
        await assert.rejects(buildOutputs(root), /reserved for the Markdown body/u);
        await writeAgent(root);
        await writeFile(join(root, ".halign", "agents", "explorer.md"), "---\nname: explorer\ndescription: Read only.\nharnesses:\n  missing:\n    model: x\n---\n\nbody\n", "utf8");
        await assert.rejects(buildOutputs(root), /configured harness names/u);
        await writeAgent(root);
        await writeFile(join(root, ".halign", "rules", "bad.md"), "---\npriority: high\n---\n\n# Bad\n\nbad\n", "utf8");
        await assert.rejects(buildOutputs(root), /priority/u);
        await unlink(join(root, ".halign", "rules", "bad.md"));
        await writeFile(join(root, ".halign", "layers", "soul", "arona.md"), "---\npriority: 3\n---\n\n# Soul\n", "utf8");
        await assert.rejects(buildOutputs(root), /unknown layer field "priority"/u);
    });
});

test("Layer discovery is strict and empty options are valid", async () =>
{
    await withProject(async (root) =>
    {
        await saveLayerOption(root, { path: ".halign/layers/soul/arona.md", body: "" });
        assert.ok(!output(await buildOutputs(root), "codex/AGENTS.md").includes("arona soul"));
        await mkdir(join(root, ".halign", "layers", "soul", "nested"));
        await assert.rejects(buildOutputs(root), /only contain direct Markdown files/u);
        await rm(join(root, ".halign", "layers", "soul", "nested"), { recursive: true });
        await mkdir(join(root, ".halign", "layers", "orphan"));
        await writeFile(join(root, ".halign", "layers", "orphan", "x.md"), "x", "utf8");
        const catalog = await loadWorkspace(root);
        assert.ok(Object.keys(catalog.layerOptions).includes("orphan"));
        assert.ok(!output(await buildOutputs(root), "codex/AGENTS.md").includes("x"));
        const withOrphan = await buildOutputs(root, [{ name: "soul", option: "kei" }, { name: "orphan", option: "x" }]);
        assert.ok(output(withOrphan, "codex/AGENTS.md").includes("x"));
        assert.ok(output(withOrphan, "codex/AGENTS.md").includes("kei soul"));
        const withoutSoul = await buildOutputs(root, []);
        assert.ok(!output(withoutSoul, "codex/AGENTS.md").includes("kei soul"));
        await assert.rejects(buildOutputs(root, [{ name: "missing", option: "x" }]), /unknown layer selection/u);
        await rm(join(root, ".halign", "layers", "orphan"), { recursive: true });
        await writeFile(join(root, ".halign", "config.json"), JSON.stringify({ ...config, layers: [{ name: "soul", selected: "missing" }] }), "utf8");
        await assert.rejects(buildOutputs(root), /selected option does not exist/u);
        await writeFile(join(root, ".halign", "config.json"), JSON.stringify(config), "utf8");
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
        await mkdir(join(root, ".halign", "layers", "workflow"));
        await writeLayerOption(root, "workflow", "strict", "# Workflow\n\nstrict workflow");
        await writeFile(join(root, ".halign", "config.json"), JSON.stringify({
            ...config,
            layers: [...config.layers, { name: "workflow", selected: "strict" }],
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

test("generate, check, stale ownership, and preflight keep valid output safe", async () =>
{
    await withProject(async (root) =>
    {
        await writeAgent(root, "second");
        await generate(root);
        const generated = join(root, ".halign", "generated");
        const first = await snapshot(generated);
        await generate(root);
        assert.deepEqual(await snapshot(generated), first);
        await writeFile(join(generated, "unmanaged.txt"), "keep", "utf8");
        await unlink(join(root, ".halign", "agents", "second.md"));
        await generate(root);
        await assert.rejects(readFile(join(generated, "codex", "agents", "second.toml")));
        assert.equal(await readFile(join(generated, "unmanaged.txt"), "utf8"), "keep");
        assert.ok((await check(root)).includes("extra: unmanaged.txt"));
        await unlink(join(generated, "unmanaged.txt"));
        await unlink(join(generated, "codex", "AGENTS.md"));
        assert.ok((await check(root)).includes("missing: codex/AGENTS.md"));
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
        await writeFile(join(root, ".halign", "rules", "bad.md"), Buffer.from([0xff, 0xfe]));
        await assert.rejects(buildOutputs(root), /UTF-8/u);
        await unlink(join(root, ".halign", "rules", "bad.md"));
        const target = join(root, "atomic.txt");
        await writeFile(target, "old", "utf8");
        await assert.rejects(atomicWrite(target, Buffer.from("new"), async () =>
        { throw new Error("replace failed"); }), /replace failed/u);
        assert.equal(await readFile(target, "utf8"), "old");
        const rules = join(root, ".halign", "rules");
        const redirectedRules = join(root, "redirected-rules");
        await rename(rules, redirectedRules);
        await symlink(redirectedRules, rules, "junction");
        await assert.rejects(buildOutputs(root), /symbolic link sources/u);
        await unlink(rules);
        await rename(redirectedRules, rules);
        await generate(root);
        await rm(join(root, ".halign", "generated", "codex"), { recursive: true });
        const redirected = join(root, "redirected");
        await mkdir(redirected);
        await symlink(redirected, join(root, ".halign", "generated", "codex"), "junction");
        await assert.rejects(check(root), /symbolic link outputs/u);
    });
});
test("setup deploys generated harness content into existing roots and shared rules", async () =>
{
    await withProject(async (root) =>
    {
        const userProfile = join(root, "isolated-userprofile");
        await mkdir(join(root, ".halign", "rules", "shared"), { recursive: true });
        await writeFile(join(root, ".halign", "rules", "shared", "shared.md"), "shared rule\n", "utf8");
        await mkdir(join(userProfile, ".codex", "agents"), { recursive: true });
        await mkdir(join(userProfile, ".config", "opencode", "agents"), { recursive: true });
        await writeFile(join(userProfile, ".codex", "AGENTS.md"), "old codex\n", "utf8");
        await writeFile(join(userProfile, ".codex", "agents", "old.toml"), "old codex agent\n", "utf8");
        await writeFile(join(userProfile, ".config", "opencode", "AGENTS.md"), "old opencode\n", "utf8");
        await writeFile(join(userProfile, ".config", "opencode", "agents", "old.md"), "old opencode agent\n", "utf8");

        await setup(root, undefined, userProfile);

        assert.deepEqual(await snapshot(join(userProfile, ".codex")), await snapshot(join(root, ".halign", "generated", "codex")));
        assert.deepEqual(await snapshot(join(userProfile, ".config", "opencode")), await snapshot(join(root, ".halign", "generated", "opencode")));
        assert.deepEqual(await snapshot(join(userProfile, ".agents", "shared-rules")), await snapshot(join(root, ".halign", "rules", "shared")));
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
        await writeFile(join(root, ".halign", "config.json"), JSON.stringify(customConfig), "utf8");
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
        await writeFile(join(root, ".halign", "agents", "explorer.md"), agent, "utf8");
        await mkdir(join(root, ".halign", "rules", "shared"), { recursive: true });
        await writeFile(join(root, ".halign", "rules", "shared", "shared.md"), "shared rule\n", "utf8");

        const userProfile = join(root, "isolated-userprofile");
        const targetRoot = join(userProfile, ".tools", "atlas");
        await mkdir(join(targetRoot, "agents"), { recursive: true });

        await setup(root, undefined, userProfile);

        assert.deepEqual(await snapshot(targetRoot), await snapshot(join(root, ".halign", "generated", "atlas")));
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
        await mkdir(join(root, ".halign", "rules", "shared"), { recursive: true });
        await writeFile(join(root, ".halign", "rules", "shared", "shared.md"), "shared rule\n", "utf8");
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
        await mkdir(join(root, ".halign", "rules", "shared"), { recursive: true });
        await writeFile(join(root, ".halign", "rules", "shared", "shared.md"), "shared rule\n", "utf8");
        const outputs = await generate(root);
        const generatedRoot = join(root, ".halign", "generated");
        const generateLog = reportGenerate(generatedRoot, outputs);
        assert.ok(generateLog.includes(`Wrote ${outputs.size} files to ${generatedRoot}`));
        assert.ok(generateLog.includes("  .manifest.json"));
        assert.ok(generateLog.includes("  codex/AGENTS.md"));
        assert.ok(generateLog.includes("  codex/agents/explorer.toml"));
        assert.ok(generateLog.includes("  cursor/agents/explorer.md"));
        assert.ok(generateLog.includes("  opencode/AGENTS.md"));

        const userProfile = join(root, "isolated-userprofile");
        await mkdir(join(userProfile, ".codex", "agents"), { recursive: true });
        const setupLog = reportSetup(await setup(root, undefined, userProfile));
        assert.ok(setupLog.includes(`Wrote ${outputs.size} files to ${generatedRoot}`));
        assert.ok(setupLog.includes(`Updated codex at ${join(userProfile, ".codex")}`));
        assert.ok(setupLog.includes("  agents/explorer.toml"));
        assert.ok(setupLog.includes(`Skipped cursor; target does not exist: ${join(userProfile, ".cursor")}`));
        assert.ok(setupLog.includes(`Skipped opencode; target does not exist: ${join(userProfile, ".config", "opencode")}`));
        assert.ok(setupLog.includes(`Updated shared rules at ${join(userProfile, ".agents", "shared-rules")}`));
        assert.ok(setupLog.includes("  shared.md"));
    });
});

test("edit writes validated sources, cascades harness rename, and rejects path escape", async () =>
{
    await withProject(async (root) =>
    {
        const loaded = await loadConfig(root);
        await saveConfig(root, { ...loaded, name: "Aligned" });
        const written = JSON.parse(await readFile(join(root, ".halign", "config.json"), "utf8")) as { layers: Array<{ name: string; selected: string }>; name: string };
        assert.equal(written.name, "Aligned");
        assert.deepEqual(written.layers, [{ name: "soul", selected: "arona" }]);
        const before = await readFile(join(root, ".halign", "config.json"), "utf8");
        await assert.rejects(saveConfig(root, {
            ...loaded,
            name: "Aligned",
            harnesses: [
                { name: "a", configPath: ".tools", agentFormat: "yaml", agentExtension: "md" },
                { name: "b", configPath: ".tools/nested", agentFormat: "yaml", agentExtension: "md" },
            ],
        }), /must not overlap/u);
        assert.equal(await readFile(join(root, ".halign", "config.json"), "utf8"), before);

        await saveRule(root, { path: ".halign/rules/cursor.md", priority: 1, targets: ["cursor"], body: "# Cursor\n\ncursor only" });
        await saveLayerOption(root, { path: ".halign/layers/soul/kei.md", targets: ["cursor"], body: "# Soul\n\nkei soul" });
        await saveSharedRule(root, ".halign/rules/shared/shared.md", "shared rule");
        await addLayer(root, "mode", "strict");
        assert.equal(await readFile(join(root, ".halign", "layers", "mode", "strict.md"), "utf8"), "");
        assert.deepEqual((await loadConfig(root)).layers.map((layer) => layer.name), ["soul"]);
        await addLayerOption(root, "mode", "fast");
        await removeLayerOption(root, "mode", "strict");
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
        await assert.rejects(readdir(join(root, ".halign", "layers", "workflow")));

        await renameHarness(root, "cursor", "atlas");
        const renamed = await loadWorkspace(root);
        assert.ok(renamed.config.harnesses.some((harness) => harness.name === "atlas"));
        assert.ok(!renamed.config.harnesses.some((harness) => harness.name === "cursor"));
        assert.deepEqual(renamed.rootRules.map((rule) => rule.path), [".halign/rules/cursor.md", ".halign/rules/base.md"]);
        assert.deepEqual(renamed.rootRules.find((rule) => rule.path === ".halign/rules/cursor.md")?.targets, ["atlas"]);
        assert.deepEqual(renamed.layerOptions.soul?.find((option) => option.name === "kei")?.targets, ["atlas"]);
        assert.ok(renamed.agents[0]?.harnesses.atlas);
        assert.equal(renamed.agents[0]?.harnesses.cursor, undefined);
        assert.equal(renamed.sharedRules[0]?.body, "shared rule\n");

        await addHarness(root, { name: "nova", configPath: ".nova", agentFormat: "yaml", agentExtension: "md" });
        await saveAgent(root, {
            path: ".halign/agents/explorer.md",
            name: "explorer",
            description: "Read only.",
            harnesses: {
                ...renamed.agents[0]!.harnesses,
                nova: { model: "test-nova" },
            },
            body: "Read evidence.",
        });
        await removeHarness(root, "nova");
        const afterRemove = await loadWorkspace(root);
        assert.ok(!afterRemove.config.harnesses.some((harness) => harness.name === "nova"));
        assert.equal(afterRemove.agents[0]?.harnesses.nova, undefined);

        await deleteSource(root, ".halign/rules/cursor.md");
        await assert.rejects(saveRule(root, { path: ".halign/rules/../escape.md", priority: 1, body: "no" }), /must stay inside \.halign/u);
        await assert.rejects(saveRule(root, { path: ".halign/generated/x.md", priority: 1, body: "no" }), /managed \.halign sources/u);
        await assert.rejects(saveSharedRule(root, ".halign/rules/base.md", "no"), /must stay under \.halign\/rules\/shared/u);
        await assert.rejects(deleteSource(root, ".halign/config.json"), /cannot be deleted/u);
        assert.equal((await loadConfig(root)).name, "Aligned");
    });
});

test("legal prototype property Layer names survive discovery and harness cascades", async () =>
{
    await withProject(async (root) =>
    {
        await rm(join(root, ".halign", "layers", "soul"), { recursive: true });
        await mkdir(join(root, ".halign", "layers", "constructor"), { recursive: true });
        await writeLayerOption(root, "constructor", "arona", "# Soul\n\nprototype-safe soul", ["cursor"]);
        await writeFile(join(root, ".halign", "config.json"), JSON.stringify({
            ...config,
            layers: [{ name: "constructor", selected: "arona" }],
        }), "utf8");

        const workspace = await loadWorkspace(root);
        assert.deepEqual(Object.keys(workspace.layerOptions), ["constructor"]);
        assert.equal(Object.values(workspace.layerOptions).length, 1);
        assert.equal(Object.entries(workspace.layerOptions).find(([name]) => name === "constructor")?.[1][0]?.name, "arona");

        await renameHarness(root, "cursor", "atlas");
        const renamed = await loadWorkspace(root);
        assert.deepEqual(Object.entries(renamed.layerOptions).find(([name]) => name === "constructor")?.[1][0]?.targets, ["atlas"]);
    });
});
