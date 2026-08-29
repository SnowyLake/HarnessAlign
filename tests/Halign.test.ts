/**
 * Engine tests against temporary directories.
 * Do not use this repository as a `.halign` config root, and do not open Electron windows here.
 */

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import {
    atomicWrite, addHarness, addLayer, addLayerOption, addSkillSource, assertSafeZipEntry, buildOutputs, check, deleteSource,
    downgradeMarkdownHeadings, ensureUserWorkspace, generate, HalignError, hashSkillDirectory, importUserSkills, installSkillFromDirectory,
    listUserSkills, loadConfig, loadSkills, loadWorkspace, main, parseGitHubSkillSource, removeHarness, removeLayer, removeLayerOption,
    removeSkill, removeSkillSource, renameLayer, renameLayerOption, renameSource, renderMarkdownToc, reportGenerate, reportSetup,
    safeOutputRelative, saveAgent, saveConfig, saveLayerOption, saveRule, saveSharedRule, setup, updateHarness, validateConfig,
} from "../src/engine/Halign.js";

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

/** Write one selectable Layer option with an explicit target allowlist. */
async function writeLayerOption(root: string, layer: string, option: string, body: string, targets: string[] = ALL_HARNESS_NAMES): Promise<void>
{
    const targetLines = targets.length === 0 ? "targets: []\n" : `targets:\n${targets.map((target) => `  - ${target}\n`).join("")}`;
    const frontmatter = `---\n${targetLines}---\n\n`;
    await writeFile(join(root, ".halign", "layers", layer, `${option}.md`), `${frontmatter}${body}`, "utf8");
}

/** Write a root rule markdown file under `.halign/rules`. */
async function writeRule(root: string, name: string, priority: number, body: string, targets: string[] = ALL_HARNESS_NAMES): Promise<void>
{
    const targetLines = targets.length === 0 ? "targets: []\n" : "targets:\n" + targets.map((target) => "  - " + target + "\n").join("");
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

/** Capture stdout and stderr while `run` executes, then restore the original writers. */
async function withCapturedStdio(run: () => Promise<number>): Promise<{ code: number; stdout: string; stderr: string }>
{
    let stdout = "";
    let stderr = "";
    const originalOut = process.stdout.write;
    const originalErr = process.stderr.write;
    const capture = (target: "stdout" | "stderr"): typeof process.stdout.write => ((chunk: unknown, encoding?: unknown, callback?: unknown) =>
    {
        const text = String(chunk);
        if (target === "stdout") stdout += text;
        else stderr += text;
        if (typeof encoding === "function") (encoding as () => void)();
        else if (typeof callback === "function") (callback as () => void)();
        return true;
    }) as typeof process.stdout.write;
    process.stdout.write = capture("stdout");
    process.stderr.write = capture("stderr");
    try
    {
        return { code: await run(), stdout, stderr };
    }
    finally
    {
        process.stdout.write = originalOut;
        process.stderr.write = originalErr;
    }
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
        await writeFile(join(root, ".halign", "config.json"), JSON.stringify({ ...config, harnesses: [
            { ...config.harnesses[0], config_path: ".halign" },
        ] }), "utf8");
        await assert.rejects(buildOutputs(root), /managed config directory/u);
        await writeFile(join(root, ".halign", "config.json"), JSON.stringify({ ...config, harnesses: [
            { ...config.harnesses[0], config_path: ".halign/extra" },
        ] }), "utf8");
        await assert.rejects(buildOutputs(root), /managed config directory/u);
        await writeFile(join(root, ".halign", "config.json"), JSON.stringify({ ...config, harnesses: [
            { ...config.harnesses[0], name: "con" },
        ] }), "utf8");
        await assert.rejects(buildOutputs(root), /Windows reserved device name/u);
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

test("Layer discovery is strict and empty layers and options are valid", async () =>
{
    await withProject(async (root) =>
    {
        await saveLayerOption(root, { path: ".halign/layers/soul/arona.md", targets: [], body: "" });
        assert.ok(!output(await buildOutputs(root), "codex/AGENTS.md").includes("arona soul"));
        await mkdir(join(root, ".halign", "layers", "soul", "nested"));
        await assert.rejects(buildOutputs(root), /only contain direct Markdown files/u);
        await rm(join(root, ".halign", "layers", "soul", "nested"), { recursive: true });
        await mkdir(join(root, ".halign", "layers", "orphan"));
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
        await writeRule(root, "disabled.md", 0, "# Disabled\n\nempty target rule", []);
        await writeFile(join(root, ".halign", "rules", "missing-targets.md"), "---\npriority: 0\n---\n\n# Missing Targets\n\nmissing target rule\n", "utf8");
        await mkdir(join(root, ".halign", "layers", "workflow"));
        await writeLayerOption(root, "workflow", "strict", "# Workflow\n\nstrict workflow");
        await mkdir(join(root, ".halign", "layers", "disabled"));
        await writeLayerOption(root, "disabled", "off", "# Disabled Layer\n\nempty target layer", []);
        await writeFile(join(root, ".halign", "config.json"), JSON.stringify({
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
        assert.ok(setupLog.includes(`Skipped skills; no project skills to deploy: ${join(userProfile, ".agents", "skills")}`));
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
        await addLayer(root, "mode");
        assert.deepEqual(await readdir(join(root, ".halign", "layers", "mode")), []);
        assert.deepEqual((await loadWorkspace(root)).layerOptions.mode, []);
        assert.deepEqual((await loadConfig(root)).layers.map((layer) => layer.name), ["soul"]);
        await addLayerOption(root, "mode", "strict");
        await removeLayerOption(root, "mode", "strict");
        assert.deepEqual(await readdir(join(root, ".halign", "layers", "mode")), []);
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
        await assert.rejects(readdir(join(root, ".halign", "layers", "workflow")));

        const renamedRuleBody = await readFile(join(root, ".halign", "rules", "cursor.md"), "utf8");
        await renameSource(root, ".halign/rules/cursor.md", ".halign/rules/renamed-cursor.md");
        await assert.rejects(readFile(join(root, ".halign", "rules", "cursor.md")));
        assert.equal(await readFile(join(root, ".halign", "rules", "renamed-cursor.md"), "utf8"), renamedRuleBody);
        const baseBeforeCollision = await readFile(join(root, ".halign", "rules", "base.md"), "utf8");
        await assert.rejects(renameSource(root, ".halign/rules/base.md", ".halign/rules/renamed-cursor.md"), /destination already exists/u);
        assert.equal(await readFile(join(root, ".halign", "rules", "base.md"), "utf8"), baseBeforeCollision);

        const configBeforeInvalidHarness = await readFile(join(root, ".halign", "config.json"), "utf8");
        await assert.rejects(updateHarness(root, "cursor", {
            name: "invalid name",
            configPath: ".atlas",
            agentFormat: "toml",
            agentExtension: "toml",
            instructionsField: "instructions",
        }), /name must match/u);
        assert.equal(await readFile(join(root, ".halign", "config.json"), "utf8"), configBeforeInvalidHarness);

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
        assert.deepEqual(renamed.rootRules.map((rule) => rule.path), [".halign/rules/renamed-cursor.md", ".halign/rules/base.md"]);
        assert.deepEqual(renamed.rootRules.find((rule) => rule.path === ".halign/rules/renamed-cursor.md")?.targets, ["atlas"]);
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
        await saveRule(root, { path: ".halign/rules/nova.md", priority: 2, targets: ["nova"], body: "# Nova\n\nnova only" });
        await saveLayerOption(root, { path: ".halign/layers/soul/kei.md", targets: ["nova"], body: "# Soul\n\nkei soul" });
        await removeHarness(root, "nova");
        const afterRemove = await loadWorkspace(root);
        assert.ok(!afterRemove.config.harnesses.some((harness) => harness.name === "nova"));
        assert.equal(afterRemove.agents[0]?.harnesses.nova, undefined);
        assert.deepEqual(afterRemove.rootRules.find((rule) => rule.path === ".halign/rules/nova.md")?.targets, []);
        assert.deepEqual(afterRemove.layerOptions.soul?.find((option) => option.name === "kei")?.targets, []);

        await deleteSource(root, ".halign/rules/renamed-cursor.md");
        await assert.rejects(saveRule(root, { path: ".halign/rules/../escape.md", priority: 1, targets: [], body: "no" }), /must stay inside \.halign/u);
        await assert.rejects(saveRule(root, { path: ".halign/generated/x.md", priority: 1, targets: [], body: "no" }), /managed \.halign sources/u);
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
        const written = JSON.parse(await readFile(join(root, ".halign", "config.json"), "utf8")) as { skill_sources?: unknown; version: number };
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
        const omitted = JSON.parse(await readFile(join(root, ".halign", "config.json"), "utf8")) as { skill_sources?: unknown };
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
        await mkdir(join(root, ".halign", "skills", "demo"), { recursive: true });
        await writeFile(join(root, ".halign", "skills", "demo", "SKILL.md"), "---\nname: Demo\ndescription: Demo skill\n---\n\nBody.\n", "utf8");
        const skills = await loadSkills(root);
        assert.equal(skills.length, 1);
        assert.equal(skills[0]?.id, "demo");
        assert.equal(skills[0]?.title, "Demo");
        assert.equal(skills[0]?.origin.kind, "unknown");
        await writeFile(join(root, ".halign", "skills", "junk.txt"), "nope\n", "utf8");
        await assert.rejects(loadSkills(root), /index.json and skill subdirectories/u);
        await unlink(join(root, ".halign", "skills", "junk.txt"));
        await assert.rejects(deleteSource(root, ".halign/skills/demo/SKILL.md"), /deleted with removeSkill/u);
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

test("installSkillFromDirectory copies a local extracted skill into .halign/skills", async () =>
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
        assert.deepEqual(await readFile(join(root, ".halign", "skills", "demo", "scripts", "run.bin")), Buffer.from([0, 1, 2, 255]));
        await assert.rejects(readFile(join(root, ".halign", "skills", "demo", ".cache")));
        await writeFile(join(source, "SKILL.md"), "---\nname: Demo\ndescription: Replaced\n---\n\nNew body.\n", "utf8");
        await installSkillFromDirectory(root, "demo", source, { kind: "local", contentHash: "unused" });
        assert.equal(await readFile(join(root, ".halign", "skills", "demo", "SKILL.md"), "utf8"), "---\nname: Demo\ndescription: Replaced\n---\n\nNew body.\n");
        const redirected = join(root, "redirected-nested");
        await mkdir(redirected, { recursive: true });
        await writeFile(join(redirected, "secret.md"), "protected\n", "utf8");
        await symlink(redirected, join(root, ".halign", "skills", "demo", "nested"), "junction");
        await writeFile(join(source, "SKILL.md"), "---\nname: Demo\n---\n\nShould not land.\n", "utf8");
        await assert.rejects(installSkillFromDirectory(root, "demo", source, { kind: "local", contentHash: "unused" }), /symbolic link/u);
        assert.equal(await readFile(join(redirected, "secret.md"), "utf8"), "protected\n");
        assert.equal(await readFile(join(root, ".halign", "skills", "demo", "SKILL.md"), "utf8"), "---\nname: Demo\ndescription: Replaced\n---\n\nNew body.\n");
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
        assert.equal(await readFile(join(root, ".halign", "skills", "demo", "SKILL.md"), "utf8"), "---\nname: User Demo\n---\n\nUpdated user.\n");
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
        assert.equal(await readFile(join(root, ".halign", "skills", "demo", "SKILL.md"), "utf8"), "---\nname: User Demo\n---\n\nImported over github.\n");
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
        await assert.rejects(readdir(join(root, ".halign", "skills", "demo")));
        const index = JSON.parse(await readFile(join(root, ".halign", "skills", "index.json"), "utf8")) as { skills: Record<string, unknown> };
        assert.deepEqual(index.skills, {});
    });
});

test("setup without skills succeeds and keeps unrelated user skills", async () =>
{
    await withProject(async (root) =>
    {
        await mkdir(join(root, ".halign", "rules", "shared"), { recursive: true });
        await writeFile(join(root, ".halign", "rules", "shared", "shared.md"), "shared rule\n", "utf8");
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
        await mkdir(join(root, ".halign", "rules", "shared"), { recursive: true });
        await writeFile(join(root, ".halign", "rules", "shared", "shared.md"), "shared rule\n", "utf8");
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
        await mkdir(join(root, ".halign", "rules", "shared"), { recursive: true });
        await writeFile(join(root, ".halign", "rules", "shared", "shared.md"), "shared rule\n", "utf8");
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

test("generate and check ignore project skills", async () =>
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
        assert.deepEqual(await check(root), []);
        const manifest = JSON.parse(await readFile(join(root, ".halign", "generated", ".manifest.json"), "utf8")) as { files: string[] };
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
        const created = JSON.parse(await readFile(join(home, ".halign", "config.json"), "utf8")) as { name: string; harnesses: unknown[] };
        assert.equal(created.name, "AGENTS");
        assert.ok(created.harnesses.length > 0);
        await loadWorkspace(home);
        created.name = "KEEP";
        await writeFile(join(home, ".halign", "config.json"), `${JSON.stringify(created, null, 2)}\n`, "utf8");
        await ensureUserWorkspace(home);
        const kept = JSON.parse(await readFile(join(home, ".halign", "config.json"), "utf8")) as { name: string };
        assert.equal(kept.name, "KEEP");
    }
    finally
    {
        await rm(home, { recursive: true, force: true });
    }
});

test("cli uses USERPROFILE not the current working directory", async () =>
{
    const home = await mkdtemp(join(tmpdir(), "halign-cli-home-"));
    const cwd = await mkdtemp(join(tmpdir(), "halign-cli-cwd-"));
    const previous = process.cwd();
    try
    {
        await mkdir(join(cwd, ".halign", "rules", "shared"), { recursive: true });
        await writeFile(join(cwd, ".halign", "config.json"), JSON.stringify({
            ...config,
            name: "CWD",
            harnesses: [{ name: "cursor", config_path: ".cursor", agent_format: "yaml", agent_extension: "md" }],
        }), "utf8");
        process.chdir(cwd);
        assert.equal(await main(["generate"], home), 0);
        const generated = JSON.parse(await readFile(join(home, ".halign", "config.json"), "utf8")) as { name: string };
        assert.equal(generated.name, "AGENTS");
        assert.equal(await readFile(join(home, ".halign", "generated", "cursor", "AGENTS.md"), "utf8").then(() => true), true);
        await assert.rejects(readFile(join(cwd, ".halign", "generated", "cursor", "AGENTS.md")), /ENOENT/u);
    }
    finally
    {
        process.chdir(previous);
        await rm(home, { recursive: true, force: true });
        await rm(cwd, { recursive: true, force: true });
    }
});

test("cli help and version return 0 without touching USERPROFILE", async () =>
{
    const help = await withCapturedStdio(() => main(["--help"], ""));
    assert.equal(help.code, 0);
    assert.match(help.stdout, /halign --version/u);
    assert.equal(help.stderr, "");
    const commandHelp = await withCapturedStdio(() => main(["generate", "-h"], ""));
    assert.equal(commandHelp.code, 0);
    assert.equal(commandHelp.stdout, help.stdout);
    const pkg = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as { version: string };
    const version = await withCapturedStdio(() => main(["--version"], ""));
    assert.equal(version.code, 0);
    assert.equal(version.stdout, `${pkg.version}\n`);
});

test("cli usage covers invalid commands, missing --layer values, and duplicates", async () =>
{
    const missing = await withCapturedStdio(() => main([], ""));
    assert.equal(missing.code, 2);
    assert.match(missing.stderr, /usage: halign/u);
    const unknown = await withCapturedStdio(() => main(["build"], ""));
    assert.equal(unknown.code, 2);
    const dangling = await withCapturedStdio(() => main(["generate", "--layer"], ""));
    assert.equal(dangling.code, 2);
    assert.match(dangling.stderr, /--layer requires a value/u);
    const duplicate = await withCapturedStdio(() => main(["generate", "--layer", "soul=arona", "--layer", "soul=kei"], ""));
    assert.equal(duplicate.code, 2);
    assert.match(duplicate.stderr, /--layer must not repeat soul/u);
});

test("cli unknown --layer is a domain error against the user workspace", async () =>
{
    const home = await mkdtemp(join(tmpdir(), "halign-cli-layer-"));
    try
    {
        await ensureUserWorkspace(home);
        const result = await withCapturedStdio(() => main(["generate", "--layer", "soul=arona"], home));
        assert.equal(result.code, 1);
        assert.match(result.stderr, /unknown layer selection "soul"/u);
    }
    finally
    {
        await rm(home, { recursive: true, force: true });
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
