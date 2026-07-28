import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import { atomicWrite, buildOutputs, check, downgradeMarkdownHeadings, generate, HcsError, renderMarkdownToc, safeOutputRelative, setup } from "../src/hcs.js";

const config = { version: 1, name: "AGENTS", default_profile: "arona", profiles: ["arona", "kei"], harnesses: ["codex", "cursor", "opencode"] };

async function withProject(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "hcs-ts-"));
  try {
    await mkdir(join(root, ".hcs", "rules"), { recursive: true });
    await mkdir(join(root, ".hcs", "domains", "arona", "rules"), { recursive: true });
    await mkdir(join(root, ".hcs", "domains", "kei", "rules"), { recursive: true });
    await mkdir(join(root, ".hcs", "agents"), { recursive: true });
    await writeFile(join(root, ".hcs", "config.json"), JSON.stringify(config), "utf8");
    await writeRule(root, "base.md", 100, "# Base\n\nbase");
    await writeAgent(root);
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeRule(root: string, name: string, priority: number, body: string, targets?: string[]): Promise<void> {
  const targetLines = targets ? "targets:\n" + targets.map((target) => "  - " + target + "\n").join("") : "";
  await writeFile(join(root, ".hcs", "rules", name), "---\npriority: " + priority + "\n" + targetLines + "---\n\n" + body + "\n", "utf8");
}

async function writeAgent(root: string, name = "explorer"): Promise<void> {
  await writeFile(join(root, ".hcs", "agents", name + ".md"), "---\nname: " + name + "\ndescription: Read only.\nharnesses:\n  codex:\n    model: test-codex\n    sandbox_mode: read-only\n    web_search: disabled\n  cursor:\n    model: test-cursor\n    readonly: true\n  opencode:\n    model: test-opencode\n    variant: max\n    mode: subagent\n    permission:\n      edit: deny\n      bash: deny\n---\n\nRead evidence.\n", "utf8");
}

function output(outputs: Map<string, Buffer>, path: string): string {
  const content = outputs.get(path);
  assert.ok(content, "missing " + path);
  return content.toString("utf8");
}

async function snapshot(root: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  const visit = async (directory: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const child = prefix ? prefix + "/" + entry.name : entry.name;
      if (entry.isDirectory()) await visit(path, child);
      if (entry.isFile()) files.set(child, await readFile(path));
    }
  };
  await visit(root, "");
  return files;
}

test("config and metadata validation reject unsafe input", async () => {
  await withProject(async (root) => {
    await writeFile(join(root, ".hcs", "config.json"), JSON.stringify({ ...config, default_profile: "../x", profiles: ["../x"] }), "utf8");
    await assert.rejects(buildOutputs(root), /single directory names/u);
    await writeFile(join(root, ".hcs", "config.json"), JSON.stringify(config), "utf8");
    await writeFile(join(root, ".hcs", "rules", "bad.md"), "---\npriority: high\n---\n\n# Bad\n\nbad\n", "utf8");
    await assert.rejects(buildOutputs(root), /priority/u);
  });
});

test("rules profile selection, targets, Markdown, and all renderers are deterministic", async () => {
  await withProject(async (root) => {
    await writeRule(root, "zeta.md", 10, "# Zeta\n\nzeta");
    await writeRule(root, "alpha.md", 10, "# Alpha\n\nalpha");
    await writeRule(root, "cursor.md", 1, "# Cursor\n\ncursor only", ["cursor"]);
    await writeFile(join(root, ".hcs", "domains", "kei", "rules", "soul.md"), "---\npriority: 3\n---\n\n# Soul\n\nkei soul\n", "utf8");
    const first = await buildOutputs(root);
    const second = await buildOutputs(root);
    assert.deepEqual([...first].map(([path, value]) => [path, value.toString("hex")]), [...second].map(([path, value]) => [path, value.toString("hex")]));
    const codex = output(first, "codex/AGENTS.md");
    assert.ok(codex.indexOf("alpha") < codex.indexOf("zeta"));
    assert.ok(!codex.includes("cursor only"));
    assert.ok(output(first, "cursor/AGENTS.md").includes("cursor only"));
    assert.ok(output(await buildOutputs(root, "kei"), "codex/AGENTS.md").includes("kei soul"));
    assert.equal(downgradeMarkdownHeadings("# One\n\n~~~md\n# Hidden\n~~~"), "## One\n\n~~~md\n# Hidden\n~~~");
    assert.ok(!renderMarkdownToc(["## Same\n\n~~~md\n## Hidden\n~~~"], "AGENTS").includes("Hidden"));
    const toml = parseToml(output(first, "codex/agents/explorer.toml"));
    assert.ok(String(toml.developer_instructions).includes("Read evidence.\n"));
    const yaml = parseYaml(output(first, "cursor/agents/explorer.md").split("---\n")[1] ?? "");
    assert.equal(yaml.readonly, true);
    for (const content of first.values()) {
      assert.ok(!content.includes(0x0d));
      assert.ok(content.toString("utf8").endsWith("\n"));
    }
  });
});

test("generate, check, stale ownership, and preflight keep valid output safe", async () => {
  await withProject(async (root) => {
    await writeAgent(root, "second");
    await generate(root);
    const generated = join(root, ".hcs", "generated");
    const first = await snapshot(generated);
    await generate(root);
    assert.deepEqual(await snapshot(generated), first);
    await writeFile(join(generated, "unmanaged.txt"), "keep", "utf8");
    await unlink(join(root, ".hcs", "agents", "second.md"));
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

test("manifest path, encoding, atomic failure, and reparse boundaries are rejected", async () => {
  await withProject(async (root) => {
    for (const path of ["../escape", "C:/escape", "a\\b", "."]) assert.throws(() => safeOutputRelative(path), HcsError);
    await writeFile(join(root, ".hcs", "rules", "bad.md"), Buffer.from([0xff, 0xfe]));
    await assert.rejects(buildOutputs(root), /UTF-8/u);
    await unlink(join(root, ".hcs", "rules", "bad.md"));
    const target = join(root, "atomic.txt");
    await writeFile(target, "old", "utf8");
    await assert.rejects(atomicWrite(target, Buffer.from("new"), async () => { throw new Error("replace failed"); }), /replace failed/u);
    assert.equal(await readFile(target, "utf8"), "old");
    const rules = join(root, ".hcs", "rules");
    const redirectedRules = join(root, "redirected-rules");
    await rename(rules, redirectedRules);
    await symlink(redirectedRules, rules, "junction");
    await assert.rejects(buildOutputs(root), /symbolic link sources/u);
    await unlink(rules);
    await rename(redirectedRules, rules);
    await generate(root);
    await rm(join(root, ".hcs", "generated", "codex"), { recursive: true });
    const redirected = join(root, "redirected");
    await mkdir(redirected);
    await symlink(redirected, join(root, ".hcs", "generated", "codex"), "junction");
    await assert.rejects(check(root), /symbolic link outputs/u);
  });
});
test("setup deploys generated harness content into existing roots and shared rules", async () => {
  await withProject(async (root) => {
    const userProfile = join(root, "isolated-userprofile");
    await mkdir(join(root, ".hcs", "rules", "shared"), { recursive: true });
    await writeFile(join(root, ".hcs", "rules", "shared", "shared.md"), "shared rule\n", "utf8");
    await mkdir(join(userProfile, ".codex", "agents"), { recursive: true });
    await mkdir(join(userProfile, ".config", "opencode", "agents"), { recursive: true });
    await writeFile(join(userProfile, ".codex", "AGENTS.md"), "old codex\n", "utf8");
    await writeFile(join(userProfile, ".codex", "agents", "old.toml"), "old codex agent\n", "utf8");
    await writeFile(join(userProfile, ".config", "opencode", "AGENTS.md"), "old opencode\n", "utf8");
    await writeFile(join(userProfile, ".config", "opencode", "agents", "old.md"), "old opencode agent\n", "utf8");

    await setup(root, undefined, userProfile);

    assert.deepEqual(await snapshot(join(userProfile, ".codex")), await snapshot(join(root, ".hcs", "generated", "codex")));
    assert.deepEqual(await snapshot(join(userProfile, ".config", "opencode")), await snapshot(join(root, ".hcs", "generated", "opencode")));
    assert.deepEqual(await snapshot(join(userProfile, ".agents", "shared-rules")), await snapshot(join(root, ".hcs", "rules", "shared")));
    await assert.rejects(readFile(join(userProfile, ".cursor", "AGENTS.md")));
  });
});

test("setup rejects target reparse points before replacing an existing root", async () => {
  await withProject(async (root) => {
    const userProfile = join(root, "isolated-userprofile");
    const targetRoot = join(userProfile, ".codex");
    const redirected = join(root, "redirected-target");
    await mkdir(join(root, ".hcs", "rules", "shared"), { recursive: true });
    await writeFile(join(root, ".hcs", "rules", "shared", "shared.md"), "shared rule\n", "utf8");
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
