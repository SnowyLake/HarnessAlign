/**
 * Engine tests against temporary directories.
 * Do not use this repository as a `.harness-align` config root, and do not open Electron windows here.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import { workspaceService } from "../src/main/services/WorkspaceService.js";
import { defaultLayerOption, moveLayerSelection, uniqueAgentPath, uniqueRulePath } from "../src/renderer/src/lib/Utils.js";
import { useAppStore, workspaceChangeCount } from "../src/renderer/src/stores/AppStore.js";
import { appendLog, clearLogs, logMainError, readLogs, subscribeLogs } from "../src/main/services/ConsoleService.js";
import { LOG_INPUT_SCHEMA } from "../src/shared/models/Schemas.js";
import type { LogChange } from "../src/shared/models/Console.js";
import { checkSkillUpdates, discoverSkills, hydrateSyncSkills, installSkills } from "../src/main/services/SkillRemoteService.js";
import { applySync, connectSync, discardSync, disconnectSync, getSyncStatus, inspectSync, previewSync } from "../src/main/services/GitHubSyncService.js";
import { emptySyncSnapshot, mergeSyncSnapshots, parseSyncSnapshot, portableSyncSnapshot, readSyncSnapshot, restoreSyncChange, syncSnapshotHash, type SyncSnapshot } from "../src/engine/Sync.js";
import { SYNC_DISCARD_SCHEMA } from "../src/shared/models/Schemas.js";
import { AGENT_SCHEMA, CONFIG_SCHEMA, LAYER_SELECTION_SCHEMA, RULE_INPUT_SCHEMA, SKILL_IDS_SCHEMA } from "../src/shared/models/Schemas.js";
import { atomicWrite } from "../src/engine/FsSafe.js";
import { buildOutputs, generate, readGeneratedFiles, reportGenerate, safeOutputRelative } from "../src/engine/Generate.js";
import { readResponseBytes } from "../src/main/services/RemoteFetch.js";
import { loadConfig, validateConfig } from "../src/engine/Load.js";
import { HalignError } from "../src/engine/Model.js";
import { downgradeMarkdownHeadings, renderMarkdownToc } from "../src/engine/Render.js";
import { reportSetup, resolveExistingHarnessRoot, setup } from "../src/engine/Setup.js";
import { assertSafeZipEntry, importUserSkills, listUserSkills, removeSkill, hashSkillDirectory, installSkillFromDirectory, loadSkillIndex, loadSkills, parseGitHubSkillSource } from "../src/engine/Skills.js";
import {
    addHarness, addLayer, addLayerOption, addSkillSource, deleteSource, ensureUserWorkspace,
    loadWorkspace, removeHarness, removeLayer, removeLayerOption, removeSkillSource,
    renameLayer, renameLayerOption, renameSource, saveAgent, saveConfig, saveLayerOption, saveRule, saveSharedRule, updateHarness,
    applySyncSources, recoverSyncSources, validateSyncSources,
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

test("session console retains ordered history across hydration and navigation, and clears without reviving old entries", () =>
{
    clearLogs();
    const initialState = useAppStore.getState();
    const changes: LogChange[] = [];
    const unsubscribe = subscribeLogs((change) => changes.push(change));
    try
    {
        const input = LOG_INPUT_SCHEMA.parse({ level: "success", title: "Generate completed", details: "generated/codex/AGENTS.md\n2 files written" });
        appendLog(input);
        appendLog(input);
        const snapshot = readLogs();
        logMainError("Window state save failed", new Error("window-state.json: EACCES"));
        const state = useAppStore.getState();
        state.setLogSnapshot(snapshot);
        for (const change of changes) state.applyLogChange(change);
        assert.equal(useAppStore.getState().logs.length, 3);
        assert.equal(new Set(useAppStore.getState().logs.map((entry) => entry.id)).size, 3);
        assert.equal(useAppStore.getState().logs[0]!.details, input.details);
        assert.match(useAppStore.getState().logs[2]!.details, /window-state.json: EACCES/);
        assert.ok(useAppStore.getState().logs.every((entry) => Number.isFinite(Date.parse(entry.timestamp))));
        state.setSelection({ kind: "rule-new", scope: "root" });
        state.setEditorDraft("rule-new:root", { selection: { kind: "rule-new", scope: "root" }, baseline: {}, current: { body: ["unsaved"] } });
        state.setView("console");
        assert.deepEqual(useAppStore.getState().selection, { kind: "rule-new", scope: "root" });
        state.setView("settings");
        state.setView("console");
        assert.equal(useAppStore.getState().editorDrafts["rule-new:root"]!.current.body![0], "unsaved");
        assert.equal(useAppStore.getState().logs.length, 3);
        state.setLogSnapshot(readLogs());
        assert.equal(useAppStore.getState().logs.length, 3);
        clearLogs();
        state.applyLogChange(changes.at(-1)!);
        state.applyLogChange(changes[0]!);
        assert.deepEqual(useAppStore.getState().logs, []);
        appendLog(input);
        state.applyLogChange(changes.at(-1)!);
        assert.equal(useAppStore.getState().logs.length, 1);
        assert.ok(useAppStore.getState().logs[0]!.id > snapshot.revision);
        assert.equal(snapshot.entries.length, 2);
        for (const invalid of [{ level: "debug", title: "Invalid", details: "x" }, { level: "error", title: " ", details: "x" }, { level: "info", title: "x", details: {} }])
        {
            assert.equal(LOG_INPUT_SCHEMA.safeParse(invalid).success, false);
        }
    }
    finally
    {
        unsubscribe();
        clearLogs();
        useAppStore.setState(initialState, true);
    }
});

/** Small valid GitHub-shaped archive used by remote discovery checks. */
const TEST_SKILL_ARCHIVE = Buffer.from(
    "UEsDBBQAAAAIAFgSKF30xqGHCQAAAAcAAAAXAAAAcmVwby1tYWluL2RlbW8vU0tJTEwubWRTVnBJzc3nAgBQSwECFAAUAAAACABYEihd9MahhwkAAAAHAAAAFwAAAAAAAAAAAAAAAAAAAAAAcmVwby1tYWluL2RlbW8vU0tJTEwubWRQSwUGAAAAAAEAAQBFAAAAPgAAAAAA",
    "base64",
);

/** Git tree entry used by the in-memory remote, including regular-file bytes in POST requests. */
interface TestGitEntry
{
    path: string;
    mode: string;
    type: string;
    sha: string;
    size?: number;
    content?: string;
}

/** Simulate immutable Git objects and fast-forward publication without network or real credentials. */
function createSyncRemote()
{
    const blobs = new Map<string, Buffer>();
    const trees = new Map<string, TestGitEntry[]>();
    const commits = new Map<string, { tree: { sha: string }; parents: string[] }>();
    let serial = 0;
    /** Allocate stable-looking commit and tree ids for test objects. */
    const id = (): string => (++serial).toString(16).padStart(40, "0");
    /** Store a real content-addressed Git blob for integrity checks. */
    const blob = (bytes: Buffer): string =>
    {
        const sha = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
        blobs.set(sha, bytes);
        return sha;
    };
    const initialTree = id();
    trees.set(initialTree, [{ path: "README.md", mode: "100644", type: "blob", sha: blob(Buffer.from("Keep this repository file.\n")) }]);
    let head = id();
    commits.set(head, { tree: { sha: initialTree }, parents: [] });
    const controls = { losePatchResponse: false, raceOnPatch: false, isPrivate: true, truncated: false, rejectedMode: "", patchCount: 0 };

    /** Determine ancestry exactly enough to reject a racing sibling commit. */
    const isAncestor = (ancestor: string, descendant: string): boolean =>
    {
        if (ancestor === descendant) return true;
        return commits.get(descendant)?.parents.some((parent) => isAncestor(ancestor, parent)) ?? false;
    };
    /** Simulate an external commit while retaining unrelated repository content. */
    const publish = (snapshot: SyncSnapshot, marker: unknown = { version: 1, directories: snapshot.directories }): void =>
    {
        const entries: TestGitEntry[] = Object.entries(snapshot.files).map(([path, encoded]) => ({ path, mode: "100644", type: "blob", sha: blob(Buffer.from(encoded, "base64")) }));
        if (marker !== null) entries.push({ path: "sync.json", mode: "100644", type: "blob", sha: blob(Buffer.from(JSON.stringify(marker))) });
        const subtree = id();
        trees.set(subtree, entries);
        const tree = id();
        trees.set(tree, [...trees.get(commits.get(head)!.tree.sha)!.filter((entry) => entry.path !== "harness-align"), { path: "harness-align", type: "tree", mode: "040000", sha: subtree }]);
        const next = id();
        commits.set(next, { tree: { sha: tree }, parents: [head] });
        head = next;
    };
    /** Handle only the documented GitHub REST routes used by the sync service. */
    const request = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> =>
    {
        const url = new URL(String(input));
        assert.equal(url.origin, "https://api.github.com");
        const path = decodeURIComponent(url.pathname.replace("/repos/test/sync", ""));
        const method = init?.method ?? "GET";
        /** Return a JSON response to the service's bounded response reader. */
        const response = (data: unknown, status = 200): Response => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
        if (method === "GET")
        {
            if (!path) return response({ private: controls.isPrivate, archived: false, permissions: { push: true } });
            if (path === "/git/ref/heads/main") return response({ object: { type: "commit", sha: head } });
            if (path.startsWith("/git/commits/")) return response(commits.get(path.split("/").at(-1)!));
            if (path.startsWith("/git/trees/"))
            {
                const entries = trees.get(path.split("/").at(-1)!)!;
                return response({ truncated: controls.truncated, tree: entries.map((entry) => ({
                    ...entry,
                    mode: controls.rejectedMode && entry.path === "config.json" ? controls.rejectedMode : entry.mode,
                    ...(entry.type === "blob" ? { size: blobs.get(entry.sha)!.length } : {}),
                })) });
            }
            if (path.startsWith("/git/blobs/"))
            {
                const bytes = blobs.get(path.split("/").at(-1)!)!;
                return response({ content: bytes.toString("base64"), encoding: "base64", size: bytes.length });
            }
            if (path.startsWith("/compare/"))
            {
                const [before, after] = path.slice(9).split("...");
                return response({ status: before === after ? "identical" : isAncestor(before!, after!) ? "ahead" : isAncestor(after!, before!) ? "behind" : "diverged" });
            }
        }
        const body = JSON.parse(String(init?.body ?? "{}")) as {
            tree: TestGitEntry[] | string; base_tree: string; content: string; encoding: BufferEncoding; parents: string[]; sha: string; force: boolean;
        };
        if (method === "POST")
        {
            if (path === "/git/blobs") return response({ sha: blob(Buffer.from(body.content, body.encoding)) }, 201);
            if (path === "/git/trees")
            {
                assert.ok(Array.isArray(body.tree));
                if (body.tree.some((entry) => entry.type === "blob" && entry.content === undefined && !blobs.has(entry.sha))) return response({ message: "missing blob" }, 422);
                const entries = body.tree.map((entry) => ({ ...entry, sha: entry.content === undefined ? entry.sha : blob(Buffer.from(entry.content)) }));
                const next = id();
                trees.set(next, [...(trees.get(body.base_tree) ?? []).filter((entry) => !entries.some((next) => next.path === entry.path)), ...entries]);
                return response({ sha: next }, 201);
            }
            if (path === "/git/commits")
            {
                assert.equal(typeof body.tree, "string");
                const next = id();
                commits.set(next, { tree: { sha: body.tree as string }, parents: body.parents });
                return response({ sha: next }, 201);
            }
        }
        if (method === "PATCH" && path === "/git/refs/heads/main")
        {
            controls.patchCount += 1;
            assert.equal(body.force, false);
            if (controls.raceOnPatch)
            {
                controls.raceOnPatch = false;
                const next = id();
                commits.set(next, { tree: commits.get(head)!.tree, parents: [head] });
                head = next;
            }
            if (!isAncestor(head, body.sha)) return response({ message: "not a fast forward" }, 422);
            head = body.sha;
            if (controls.losePatchResponse)
            {
                controls.losePatchResponse = false;
                throw new TypeError("simulated response loss");
            }
            return response({ object: { sha: head } });
        }
        return response({ message: `Unexpected mock route: ${method} ${path}` }, 404);
    };
    /** Simulate deletion of the archive after a previously published commit. */
    const removeArchive = (): void =>
    {
        const tree = id();
        trees.set(tree, trees.get(commits.get(head)!.tree.sha)!.filter((entry) => entry.path !== "harness-align"));
        const next = id();
        commits.set(next, { tree: { sha: tree }, parents: [head] });
        head = next;
    };
    return { request, publish, removeArchive, controls, rootEntries: () => trees.get(commits.get(head)!.tree.sha)! };
}

test("sync snapshots preserve binary assets and empty layers while rejecting unsafe paths", async () =>
{
    await withProject(async (root) =>
    {
        await mkdir(join(root, ".harness-align/layers/empty"));
        await mkdir(join(root, ".harness-align/skills/demo"), { recursive: true });
        await writeFile(join(root, ".harness-align/skills/demo/SKILL.md"), "# Demo\n");
        await writeFile(join(root, ".harness-align/skills/demo/asset.bin"), Buffer.from([0, 255, 128, 1]));
        await mkdir(join(root, ".harness-align/generated"));
        await writeFile(join(root, ".harness-align/generated/ignored.txt"), "generated");
        await writeFile(join(root, ".harness-align/private.txt"), "not in sync scopes");
        const saved = await readSyncSnapshot(root);
        assert.ok(saved.directories.includes("layers/empty"));
        assert.equal(saved.files["skills/demo/asset.bin"], Buffer.from([0, 255, 128, 1]).toString("base64"));
        assert.ok(!Object.hasOwn(saved.files, "generated/ignored.txt"));
        assert.ok(!Object.hasOwn(saved.files, "private.txt"));
        for (const path of ["../config.json", "generated/evil.md", "rules/../escape", "rules/a:stream", "rules/CON.md", "rules\\evil.md", "/config.json"])
        {
            assert.throws(() => parseSyncSnapshot({ version: 1, directories: [], files: { [path]: "" } }));
        }
        assert.throws(() => parseSyncSnapshot({ version: 1, directories: [], files: { "rules/A.md": "", "rules/a.md": "" } }), /case sensitivity/u);
        assert.throws(() => parseSyncSnapshot({ version: 1, directories: ["rules/a.md"], files: { "rules/a.md": "" } }), /both a file and a directory/u);
        assert.throws(() => parseSyncSnapshot({ version: 1, directories: [], files: { "rules/a.md": "not base64!" } }), /base64/u);
    });
});

test("sync merges independent files and treats a skill with provenance as one conflict", () =>
{
    const base = parseSyncSnapshot({ version: 1, directories: ["layers/empty"], files: {
        "rules/a.md": Buffer.from("before").toString("base64"),
        "rules/b.md": Buffer.from("before").toString("base64"),
        "skills/demo/SKILL.md": Buffer.from("# Before").toString("base64"),
        "skills/demo/script.txt": Buffer.from("before").toString("base64"),
        "skills/index.json": Buffer.from(JSON.stringify({ skills: { demo: { origin: "local", contentHash: "before" } } })).toString("base64"),
    } });
    const local = structuredClone(base);
    const remote = structuredClone(base);
    local.files["rules/a.md"] = Buffer.from("local").toString("base64");
    remote.files["rules/b.md"] = Buffer.from("remote").toString("base64");
    local.files["skills/demo/script.txt"] = Buffer.from("local script").toString("base64");
    remote.files["skills/demo/SKILL.md"] = Buffer.from("# Remote").toString("base64");
    remote.files["skills/index.json"] = Buffer.from(JSON.stringify({ skills: { demo: { origin: "local", contentHash: "remote" } } })).toString("base64");
    const unresolved = mergeSyncSnapshots(base, local, remote);
    assert.deepEqual(unresolved.conflicts, ["skills/demo"]);
    const merged = mergeSyncSnapshots(base, local, remote, { "skills/demo": "remote" });
    assert.equal(merged.snapshot.files["rules/a.md"], local.files["rules/a.md"]);
    assert.equal(merged.snapshot.files["rules/b.md"], remote.files["rules/b.md"]);
    assert.equal(merged.snapshot.files["skills/demo/script.txt"], base.files["skills/demo/script.txt"]);
    assert.match(Buffer.from(merged.snapshot.files["skills/index.json"]!, "base64").toString(), /remote/u);
    assert.ok(merged.snapshot.directories.includes("layers/empty"));
    delete local.files["rules/b.md"];
    assert.ok(mergeSyncSnapshots(base, local, remote).conflicts.includes("rules/b.md"));
});

test("sync validates the complete candidate before writes and rejects stale local previews", async () =>
{
    await withProject(async (root) =>
    {
        const before = await readSyncSnapshot(root);
        const invalid = structuredClone(before);
        invalid.files["config.json"] = Buffer.from(JSON.stringify({ ...config, layers: [{ name: "missing", selected: "none" }] })).toString("base64");
        await assert.rejects(applySyncSources(root, before, invalid));
        assert.equal(syncSnapshotHash(await readSyncSnapshot(root)), syncSnapshotHash(before));
        const next = structuredClone(before);
        next.files["rules/base.md"] = Buffer.from("---\npriority: 100\ntargets: []\n---\n\nUpdated\n").toString("base64");
        await writeRule(root, "new.md", 101, "# Unsynced");
        await assert.rejects(applySyncSources(root, before, next), /local sources changed/u);
        assert.match(await readFile(join(root, ".harness-align/rules/new.md"), "utf8"), /Unsynced/u);
    });
});

test("sync surfaces case and file-directory aliases as selectable source groups", () =>
{
    const local = parseSyncSnapshot({ version: 1, directories: ["layers/Foo"], files: { "rules/Foo.md": "YQ==", "layers/Foo/a.md": "YQ==", "rules/asset.md": "YQ==" } });
    const remote = parseSyncSnapshot({ version: 1, directories: ["layers/foo"], files: { "rules/foo.md": "Yg==", "layers/foo/b.md": "Yg==", "rules/asset.md/child.md": "Yg==" } });
    const merged = mergeSyncSnapshots(emptySyncSnapshot(), local, remote);
    assert.deepEqual(merged.conflicts, ["layers/foo/", "rules/asset.md/", "rules/foo.md"]);
    const selected = mergeSyncSnapshots(emptySyncSnapshot(), local, remote, { "layers/foo/": "remote", "rules/asset.md/": "remote", "rules/foo.md": "local" });
    assert.equal(selected.conflicts.length, 0);
    assert.equal(selected.snapshot.files["rules/Foo.md"], "YQ==");
    assert.equal(selected.snapshot.files["rules/asset.md/child.md"], "Yg==");
    assert.ok(selected.snapshot.directories.includes("layers/foo"));
    assert.ok(!selected.snapshot.directories.includes("layers/Foo"));
});

test("sync restores one source group with binary skill provenance and structural aliases intact", () =>
{
    const local = parseSyncSnapshot({ version: 1, directories: ["layers/Foo"], files: {
        "rules/keep.md": Buffer.from("Keep local").toString("base64"),
        "layers/Foo/a.md": "YQ==",
        "skills/demo/SKILL.md": "YQ==",
        "skills/demo/asset.bin": "AP8=",
        "skills/index.json": Buffer.from('{"skills":{"demo":{"origin":"local","contentHash":"local"},"kept":{"origin":"local","contentHash":"keep"}}}').toString("base64"),
    } });
    const remote = parseSyncSnapshot({ version: 1, directories: ["layers/foo"], files: {
        "rules/keep.md": Buffer.from("Remote edit").toString("base64"),
        "layers/foo/b.md": "Yg==",
        "skills/demo/SKILL.md": "Yg==",
        "skills/demo/asset.bin": "AIA=",
        "skills/index.json": Buffer.from('{"skills":{"demo":{"origin":"local","contentHash":"remote"}}}').toString("base64"),
    } });
    const restored = restoreSyncChange(emptySyncSnapshot(), local, remote, "skills/demo");
    assert.equal(restored.files["skills/demo/asset.bin"], remote.files["skills/demo/asset.bin"]);
    assert.equal(restored.files["rules/keep.md"], local.files["rules/keep.md"]);
    assert.deepEqual(JSON.parse(Buffer.from(restored.files["skills/index.json"]!, "base64").toString()), {
        skills: { demo: { origin: "local", contentHash: "remote" }, kept: { origin: "local", contentHash: "keep" } },
    });
    const alias = restoreSyncChange(emptySyncSnapshot(), local, remote, "layers/foo/");
    assert.equal(alias.files["layers/Foo/a.md"], undefined);
    assert.equal(alias.files["layers/foo/b.md"], "Yg==");
    assert.equal(alias.files["skills/index.json"], local.files["skills/index.json"]);
    const removed = restoreSyncChange(emptySyncSnapshot(), local, emptySyncSnapshot(), "skills/demo");
    assert.equal(removed.files["skills/demo/SKILL.md"], undefined);
    assert.ok(!removed.directories.includes("skills/demo"));
    assert.doesNotMatch(Buffer.from(removed.files["skills/index.json"]!, "base64").toString(), /demo/u);
});

test("sync preserves inherited-property skill names and rejects invalid provenance ids", async () =>
{
    await withProject(async (root) =>
    {
        await mkdir(join(root, ".harness-align/skills/constructor"), { recursive: true });
        await writeFile(join(root, ".harness-align/skills/constructor/SKILL.md"), "# Constructor skill\n");
        await writeFile(join(root, ".harness-align/skills/index.json"), JSON.stringify({ skills: { constructor: { origin: "local", contentHash: "hash" } } }));
        const local = await readSyncSnapshot(root);
        const merged = mergeSyncSnapshots(emptySyncSnapshot(), local, emptySyncSnapshot()).snapshot;
        await validateSyncSources(merged);
        const index = JSON.parse(Buffer.from(merged.files["skills/index.json"]!, "base64").toString("utf8")) as { skills: Record<string, unknown> };
        assert.ok(Object.hasOwn(index.skills, "constructor"));
        assert.deepEqual(index.skills["constructor"], { origin: "local", contentHash: "hash" });
        local.files["skills/index.json"] = Buffer.from('{"skills":{"__proto__":{"origin":"local","contentHash":"hash"}}}').toString("base64");
        assert.throws(() => mergeSyncSnapshots(emptySyncSnapshot(), local, emptySyncSnapshot()), /skill id must match/u);
    });
});

test("sync ignores only regular atomic leftovers and can remove their otherwise empty layer", async () =>
{
    await withProject(async (root) =>
    {
        await mkdir(join(root, ".harness-align/layers/empty"));
        const before = await readSyncSnapshot(root);
        const temporary = ".harness-align-01234567-0123-4123-8123-0123456789ab.tmp";
        await writeFile(join(root, ".harness-align/rules", temporary), "partial write");
        await writeFile(join(root, ".harness-align/layers/empty", temporary), "partial write");
        assert.equal(syncSnapshotHash(await readSyncSnapshot(root)), syncSnapshotHash(before));
        const after = structuredClone(before);
        after.directories = after.directories.filter((path) => path !== "layers/empty");
        await applySyncSources(root, before, after);
        assert.equal(syncSnapshotHash(await readSyncSnapshot(root)), syncSnapshotHash(after));
        assert.throws(() => parseSyncSnapshot({ version: 1, directories: [], files: { [`rules/${temporary}`]: "" } }), /expected a relative source path/u);
    });
});

test("sync recovery does not recreate externally deleted unchanged directories or modified files", async () =>
{
    for (const deletion of ["file", "directory"])
    {
        await withProject(async (root) =>
        {
            await mkdir(join(root, ".harness-align/layers/empty"));
            const before = await readSyncSnapshot(root);
            const after = structuredClone(before);
            after.files["rules/base.md"] = Buffer.from("Changed\n").toString("base64");
            const journal = join(root, ".harness-align/.sync-recovery.json");
            await writeFile(journal, JSON.stringify({ version: 1, before, after }));
            const path = join(root, deletion === "file" ? ".harness-align/rules/base.md" : ".harness-align/layers/empty");
            if (deletion === "file") await unlink(path);
            else await fs.rmdir(path);
            await assert.rejects(recoverSyncSources(root), /changed outside the interrupted update/u);
            await assert.rejects(fs.stat(path), { code: "ENOENT" });
        });
    }
});

test("sync replaces only managed sources and keeps a backup while preserving empty layers", async () =>
{
    await withProject(async (root) =>
    {
        await mkdir(join(root, ".harness-align/generated"));
        await writeFile(join(root, ".harness-align/generated/keep.md"), "keep");
        await writeFile(join(root, ".harness-align/keep.txt"), "keep");
        const before = await readSyncSnapshot(root);
        const next = structuredClone(before);
        delete next.files["layers/soul/kei.md"];
        next.files["rules/Base.md"] = next.files["rules/base.md"]!;
        delete next.files["rules/base.md"];
        next.directories.push("layers/empty");
        await applySyncSources(root, before, next);
        assert.equal(syncSnapshotHash(await readSyncSnapshot(root)), syncSnapshotHash(next));
        assert.equal(await readFile(join(root, ".harness-align/generated/keep.md"), "utf8"), "keep");
        assert.equal(await readFile(join(root, ".harness-align/keep.txt"), "utf8"), "keep");
        assert.ok((await readdir(join(root, ".harness-align/rules"))).includes("Base.md"));
        assert.equal(syncSnapshotHash(parseSyncSnapshot(JSON.parse(await readFile(join(root, ".harness-align/.sync-backup.json"), "utf8")))), syncSnapshotHash(before));
        await assert.rejects(readFile(join(root, ".harness-align/.sync-recovery.json")), { code: "ENOENT" });
    });
});

test("sync restores completed writes after a later source write fails", async (t) =>
{
    await withProject(async (root) =>
    {
        const before = await readSyncSnapshot(root);
        const next = structuredClone(before);
        next.files["config.json"] = Buffer.from(JSON.stringify({ ...config, name: "Incoming" })).toString("base64");
        next.files["rules/base.md"] = Buffer.from("---\npriority: 100\ntargets: []\n---\nChanged").toString("base64");
        const original = fs.rename;
        let failed = false;
        const mocked = t.mock.method(fs, "rename", async (...args: Parameters<typeof fs.rename>) =>
        {
            if (!failed && String(args[1]) === join(root, ".harness-align/rules/base.md"))
            {
                failed = true;
                throw new Error("simulated locked source file");
            }
            return original(...args);
        });
        try
        {
            await assert.rejects(applySyncSources(root, before, next), /rolled back/u);
            assert.equal(failed, true);
            assert.equal(syncSnapshotHash(await readSyncSnapshot(root)), syncSnapshotHash(before));
        }
        finally
        {
            mocked.mock.restore();
        }
    });
});

test("sync startup recovery restores an interrupted update and preserves unrelated later edits", async () =>
{
    await withProject(async (root) =>
    {
        const before = await readSyncSnapshot(root);
        const next = structuredClone(before);
        next.files["config.json"] = Buffer.from(JSON.stringify({ ...config, name: "Incoming" })).toString("base64");
        const journal = join(root, ".harness-align/.sync-recovery.json");
        await writeFile(journal, JSON.stringify({ version: 1, before, after: next }));
        await writeFile(join(root, ".harness-align/config.json"), Buffer.from(next.files["config.json"]!, "base64"));
        await ensureUserWorkspace(root);
        assert.equal(syncSnapshotHash(await readSyncSnapshot(root)), syncSnapshotHash(before));
        await writeFile(journal, JSON.stringify({ version: 1, before, after: next }));
        await writeFile(join(root, ".harness-align/config.json"), JSON.stringify({ ...config, name: "External edit" }));
        await assert.rejects(recoverSyncSources(root), /changed outside the interrupted update/u);
        assert.match(await readFile(join(root, ".harness-align/config.json"), "utf8"), /External edit/u);
        assert.ok(await readFile(journal));
    });
});

test("sync rejects a linked source scope without touching its target", async () =>
{
    await withProject(async (root) =>
    {
        const outside = join(root, "outside");
        await mkdir(outside);
        await writeFile(join(outside, "keep.txt"), "keep");
        await mkdir(join(root, ".harness-align/skills"));
        await symlink(outside, join(root, ".harness-align/skills/linked"), process.platform === "win32" ? "junction" : "dir");
        await assert.rejects(readSyncSnapshot(root), /symbolic link/u);
        assert.equal(await readFile(join(outside, "keep.txt"), "utf8"), "keep");
    });
});

test("GitHub sync reports transport codes without exposing credentials or response bodies", async (t) =>
{
    await withProject(async (root) =>
    {
        const directory = join(root, "app-state");
        const input = { owner: "test", repository: "sync", branch: "main", token: "test-secret-token" };
        const failures = [
            { error: new TypeError(input.token, { cause: Object.assign(new Error("proxy credentials"), { code: "UND_ERR_CONNECT_TIMEOUT" }) }), expected: /network failure \(UND_ERR_CONNECT_TIMEOUT\)/u },
            { error: new Error(`net::ERR_PROXY_CONNECTION_FAILED ${input.token}`), expected: /network failure \(net::ERR_PROXY_CONNECTION_FAILED\)/u },
            { error: null, expected: /invalid JSON response/u },
        ];
        let current = failures[0]!;
        const mocked = t.mock.method(globalThis, "fetch", async (_url: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) =>
        {
            assert.equal(init?.redirect, "error");
            assert.ok(init?.signal);
            if (current.error) throw current.error;
            return new Response(input.token);
        });
        try
        {
            for (const failure of failures)
            {
                current = failure;
                await assert.rejects(connectSync(directory, input, "encrypted-test-credential"), (error: unknown) =>
                {
                    assert.ok(error instanceof Error);
                    assert.match(error.message, failure.expected);
                    assert.ok(!error.message.includes(input.token));
                    assert.ok(!error.message.includes("proxy credentials"));
                    return true;
                });
            }
            assert.equal(mocked.mock.callCount(), failures.length);
            assert.equal((await getSyncStatus(directory)).connected, false);
        }
        finally
        {
            mocked.mock.restore();
        }
    });
});

test("GitHub archives require explicit initialization and refuse restoration or reinitialization after deletion", async (t) =>
{
    await withProject(async (root) =>
    {
        const remote = createSyncRemote();
        const mocked = t.mock.method(globalThis, "fetch", remote.request);
        const state = join(root, "app-state");
        const input = { owner: "test", repository: "sync", branch: "main", token: "test-token" };
        const before = await readSyncSnapshot(root);
        await connectSync(state, input, "encrypted");
        const preview = await previewSync(root, state, input.token);
        assert.equal(preview.remoteEmpty, true);
        for (const mode of ["merge", "local", "remote"] as const)
        {
            await assert.rejects(applySync(root, state, input.token, { previewId: preview.id, mode, choices: {} }), /Initialize archive explicitly/u);
        }
        await assert.rejects(discardSync(root, state, input.token, { previewId: preview.id, key: "rules/base.md" }), /not initialized/u);
        assert.ok(mocked.mock.calls.every((call) => (call.arguments[1]?.method ?? "GET") === "GET"));
        assert.deepEqual(await readSyncSnapshot(root), before);
        await applySync(root, state, input.token, { previewId: preview.id, mode: "initialize", choices: {} });
        assert.ok(remote.rootEntries().some((entry) => entry.path === "README.md"));
        const valid = await previewSync(root, state, input.token);
        assert.equal(valid.remoteEmpty, false);
        await assert.rejects(applySync(root, state, input.token, { previewId: valid.id, mode: "initialize", choices: {} }), /already exists/u);
        remote.removeArchive();
        const afterRemoval = mocked.mock.callCount();
        await assert.rejects(applySync(root, state, input.token, { previewId: valid.id, mode: "merge", choices: {} }), /remote branch changed/u);
        await assert.rejects(previewSync(root, state, input.token), /previously synced archive is missing/u);
        await assert.rejects(applySync(root, state, input.token, { previewId: valid.id, mode: "initialize", choices: {} }), /preview expired/u);
        await connectSync(state, input, "encrypted");
        await assert.rejects(previewSync(root, state, input.token), /previously synced archive is missing/u);
        assert.ok(mocked.mock.calls.slice(afterRemoval).every((call) => (call.arguments[1]?.method ?? "GET") === "GET"));
        assert.deepEqual(await readSyncSnapshot(root), before);
    });
});

test("invalid archive markers, contents, and root aliases never enable sync writes", async (t) =>
{
    for (const invalid of ["marker", "version", "config", "case"])
    {
        await withProject(async (root) =>
        {
            const remote = createSyncRemote();
            const before = await readSyncSnapshot(root);
            const source = parseSyncSnapshot(before);
            if (invalid === "config") source.files["config.json"] = Buffer.from("{}").toString("base64");
            remote.publish(source, invalid === "marker" ? null : { version: invalid === "version" ? 99 : 1, directories: source.directories });
            let writes = 0;
            const mocked = t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
            {
                if ((init?.method ?? "GET") !== "GET") writes++;
                const response = await remote.request(url, init);
                if (invalid !== "case" || !String(url).includes("/git/trees/")) return response;
                const value = await response.json() as { tree: TestGitEntry[] };
                for (const entry of value.tree) if (entry.path === "harness-align") entry.path = "Harness-Align";
                return Response.json(value);
            });
            try
            {
                const state = join(root, "app-state");
                const input = { owner: "test", repository: "sync", branch: "main", token: "test-token" };
                await connectSync(state, input, "encrypted");
                await assert.rejects(previewSync(root, state, input.token));
                assert.equal(writes, 0);
                assert.deepEqual(await readSyncSnapshot(root), before);
            }
            finally { mocked.mock.restore(); }
        });
    }
});

test("recovery refuses a published initialization whose archive was subsequently deleted", async (t) =>
{
    await withProject(async (root) =>
    {
        const remote = createSyncRemote();
        const mocked = t.mock.method(globalThis, "fetch", remote.request);
        const state = join(root, "app-state");
        const input = { owner: "test", repository: "sync", branch: "main", token: "test-token" };
        const before = await readSyncSnapshot(root);
        await connectSync(state, input, "encrypted");
        const preview = await previewSync(root, state, input.token);
        remote.controls.losePatchResponse = true;
        await assert.rejects(applySync(root, state, input.token, { previewId: preview.id, mode: "initialize", choices: {} }), /network/u);
        remote.removeArchive();
        const count = mocked.mock.callCount();
        await assert.rejects(previewSync(root, state, input.token), /published archive is missing/u);
        assert.equal((await getSyncStatus(state)).hasPendingUpload, true);
        assert.ok(mocked.mock.calls.slice(count).every((call) => (call.arguments[1]?.method ?? "GET") === "GET"));
        assert.deepEqual(await readSyncSnapshot(root), before);
    });
});

test("GitHub sync round-trips two devices, binary skills, empty layers, and independent edits", async (t) =>
{
    await withProject(async (first) => withProject(async (second) =>
    {
        const remote = createSyncRemote();
        const mocked = t.mock.method(globalThis, "fetch", remote.request);
        const firstState = join(first, "app-state");
        const secondState = join(second, "app-state");
        const input = { owner: "test", repository: "sync", branch: "main", token: "test-only-token" };
        try
        {
            await mkdir(join(first, ".harness-align/layers/empty"));
            await mkdir(join(first, ".harness-align/skills/demo"), { recursive: true });
            await writeFile(join(first, ".harness-align/skills/demo/SKILL.md"), "# Demo\n");
            await writeFile(join(first, ".harness-align/skills/demo/icon.bin"), Buffer.from([0, 255, 128]));
            await connectSync(firstState, input, "encrypted-test-credential");
            const initial = await previewSync(first, firstState, input.token);
            assert.equal(initial.remoteEmpty, true);
            await applySync(first, firstState, input.token, { previewId: initial.id, mode: "initialize", choices: {} });
            assert.ok(remote.rootEntries().some((entry) => entry.path === "README.md"));
            assert.doesNotMatch(await readFile(join(firstState, "github-sync.json"), "utf8"), /test-only-token/u);
            await connectSync(secondState, input, "another-encrypted-credential");
            const adoption = await previewSync(second, secondState, input.token);
            assert.equal(adoption.firstSync, true);
            await applySync(second, secondState, input.token, { previewId: adoption.id, mode: "remote", choices: {} });
            assert.equal(syncSnapshotHash(await readSyncSnapshot(second)), syncSnapshotHash(await readSyncSnapshot(first)));
            await writeRule(first, "base.md", 100, "# First device");
            const upload = await previewSync(first, firstState, input.token);
            await applySync(first, firstState, input.token, { previewId: upload.id, mode: "merge", choices: {} });
            await writeLayerOption(second, "soul", "kei", "# Second device");
            const mixed = await previewSync(second, secondState, input.token);
            assert.ok(mixed.uploadCount > 0 && mixed.downloadCount > 0);
            assert.equal(mixed.changes.filter((change) => change.direction === "conflict").length, 0);
            assert.match(inspectSync(mixed.id, "rules/base.md").files[0]!.remote!.text!, /First device/u);
            await applySync(second, secondState, input.token, { previewId: mixed.id, mode: "merge", choices: {} });
            const download = await previewSync(first, firstState, input.token);
            await applySync(first, firstState, input.token, { previewId: download.id, mode: "merge", choices: {} });
            assert.equal(syncSnapshotHash(await readSyncSnapshot(first)), syncSnapshotHash(await readSyncSnapshot(second)));
            assert.equal((await getSyncStatus(firstState)).hasPendingUpload, false);
            await assert.rejects(fs.stat(join(first, ".codex")), { code: "ENOENT" });
            await disconnectSync(firstState);
            assert.equal((await getSyncStatus(firstState)).connected, false);
            assert.doesNotMatch(await readFile(join(firstState, "github-sync.json"), "utf8"), /encrypted-test-credential/u);
        }
        finally
        {
            mocked.mock.restore();
        }
    }));
});

test("GitHub sync discards one local change to the current remote without uploading or advancing the baseline", async (t) =>
{
    await withProject(async (root) =>
    {
        const remote = createSyncRemote();
        const mocked = t.mock.method(globalThis, "fetch", remote.request);
        const state = join(root, "app-state");
        const input = { owner: "test", repository: "sync", branch: "main", token: "test-token" };
        try
        {
            await connectSync(state, input, "encrypted");
            const initial = await previewSync(root, state, input.token);
            await applySync(root, state, input.token, { previewId: initial.id, mode: "initialize", choices: {} });
            const savedState = await readFile(join(state, "github-sync.json"), "utf8");
            const external = await readSyncSnapshot(root);
            external.files["rules/base.md"] = Buffer.from("---\npriority: 100\ntargets: []\n---\n# Current remote\n").toString("base64");
            external.files["layers/soul/kei.md"] = Buffer.from("# Unrelated remote change\n").toString("base64");
            remote.publish(external);
            await writeRule(root, "base.md", 100, "# Unwanted local edit");
            await writeRule(root, "keep.md", 20, "# Keep this local edit");
            const before = await readSyncSnapshot(root);
            const preview = await previewSync(root, state, input.token);
            const calls = mocked.mock.callCount();
            await discardSync(root, state, input.token, { previewId: preview.id, key: "rules/base.md" });
            const expected = structuredClone(before);
            expected.files["rules/base.md"] = external.files["rules/base.md"]!;
            assert.equal(syncSnapshotHash(await readSyncSnapshot(root)), syncSnapshotHash(expected));
            assert.equal(await readFile(join(state, "github-sync.json"), "utf8"), savedState);
            assert.ok(mocked.mock.calls.slice(calls).every((call) => (call.arguments[1] as RequestInit | undefined)?.method === "GET"));
            assert.equal(syncSnapshotHash(parseSyncSnapshot(JSON.parse(await readFile(join(root, ".harness-align/.sync-backup.json"), "utf8")))), syncSnapshotHash(before));
            await assert.rejects(discardSync(root, state, input.token, { previewId: preview.id, key: "rules/keep.md" }), /expired/u);
            let next = await previewSync(root, state, input.token);
            assert.ok(next.changes.some((change) => change.key === "rules/keep.md" && change.direction === "upload"));
            await discardSync(root, state, input.token, { previewId: next.id, key: "rules/keep.md" });
            await assert.rejects(readFile(join(root, ".harness-align/rules/keep.md")), { code: "ENOENT" });
            await unlink(join(root, ".harness-align/rules/base.md"));
            next = await previewSync(root, state, input.token);
            await discardSync(root, state, input.token, { previewId: next.id, key: "rules/base.md" });
            assert.equal((await readSyncSnapshot(root)).files["rules/base.md"], external.files["rules/base.md"]);
            assert.equal(remote.controls.patchCount, 1);
        }
        finally
        {
            mocked.mock.restore();
        }
    });
});

test("GitHub sync refuses stale, unknown, and invalid single-source restorations before writing", async (t) =>
{
    await withProject(async (root) =>
    {
        const remote = createSyncRemote();
        const mocked = t.mock.method(globalThis, "fetch", remote.request);
        const state = join(root, "app-state");
        const input = { owner: "test", repository: "sync", branch: "main", token: "test-token" };
        try
        {
            await connectSync(state, input, "encrypted");
            const initial = await previewSync(root, state, input.token);
            await applySync(root, state, input.token, { previewId: initial.id, mode: "initialize", choices: {} });
            const external = await readSyncSnapshot(root);
            await writeRule(root, "base.md", 100, "# Local change");
            let preview = await previewSync(root, state, input.token);
            assert.equal(SYNC_DISCARD_SCHEMA.safeParse({ previewId: preview.id, key: "rules/base.md", content: "injected" }).success, false);
            await assert.rejects(discardSync(root, state, input.token, { previewId: preview.id, key: "../config.json" }), /expected a preview entry/u);
            await writeRule(root, "base.md", 100, "# Later local change");
            await assert.rejects(discardSync(root, state, input.token, { previewId: preview.id, key: "rules/base.md" }), /Local sources changed/u);
            preview = await previewSync(root, state, input.token);
            remote.publish(external);
            await assert.rejects(discardSync(root, state, input.token, { previewId: preview.id, key: "rules/base.md" }), /remote branch changed/u);
            await addLayerOption(root, "soul", "new");
            await writeFile(join(root, ".harness-align/config.json"), JSON.stringify({ ...config, layers: [{ name: "soul", selected: "new" }] }));
            await mkdir(join(root, ".harness-align/rules/added"));
            await writeRule(root, "added/keep.md", 50, "# Keep directory contents");
            preview = await previewSync(root, state, input.token);
            const before = await snapshot(join(root, ".harness-align"));
            assert.ok(preview.changes.some((change) => change.key === "rules/added/" && change.paths.length === 0));
            await assert.rejects(discardSync(root, state, input.token, { previewId: preview.id, key: "rules/added/" }), /discard individual files/u);
            await assert.rejects(discardSync(root, state, input.token, { previewId: preview.id, key: "layers/soul/new.md" }));
            assert.deepEqual(await snapshot(join(root, ".harness-align")), before);
            assert.equal(remote.controls.patchCount, 1);
        }
        finally
        {
            mocked.mock.restore();
        }
    });
});

test("GitHub sync detects stale remote previews and rejects racing non-fast-forward uploads", async (t) =>
{
    await withProject(async (root) =>
    {
        const remote = createSyncRemote();
        const mocked = t.mock.method(globalThis, "fetch", remote.request);
        const state = join(root, "app-state");
        const input = { owner: "test", repository: "sync", branch: "main", token: "test-token" };
        try
        {
            await connectSync(state, input, "encrypted");
            const stale = await previewSync(root, state, input.token);
            remote.publish(await readSyncSnapshot(root));
            await assert.rejects(applySync(root, state, input.token, { previewId: stale.id, mode: "initialize", choices: {} }), /remote branch changed/u);
            assert.equal(remote.controls.patchCount, 0);
            let preview = await previewSync(root, state, input.token);
            await applySync(root, state, input.token, { previewId: preview.id, mode: "remote", choices: {} });
            await writeRule(root, "base.md", 100, "# Local update");
            preview = await previewSync(root, state, input.token);
            remote.controls.raceOnPatch = true;
            await assert.rejects(applySync(root, state, input.token, { previewId: preview.id, mode: "merge", choices: {} }), /HTTP 422/u);
            assert.equal((await getSyncStatus(state)).hasPendingUpload, true);
            const retry = await previewSync(root, state, input.token);
            assert.match(retry.notice, /not on the current branch/u);
            assert.equal((await getSyncStatus(state)).hasPendingUpload, false);
            await applySync(root, state, input.token, { previewId: retry.id, mode: "merge", choices: {} });
        }
        finally
        {
            mocked.mock.restore();
        }
    });
});

test("GitHub sync recovers a lost upload response without publishing duplicate commits", async (t) =>
{
    await withProject(async (root) =>
    {
        const remote = createSyncRemote();
        const mocked = t.mock.method(globalThis, "fetch", remote.request);
        const state = join(root, "app-state");
        const input = { owner: "test", repository: "sync", branch: "main", token: "test-token" };
        try
        {
            await connectSync(state, input, "encrypted");
            const initial = await previewSync(root, state, input.token);
            await applySync(root, state, input.token, { previewId: initial.id, mode: "initialize", choices: {} });
            const external = await readSyncSnapshot(root);
            external.files["layers/soul/kei.md"] = Buffer.from("# Remote option\n").toString("base64");
            remote.publish(external);
            await writeRule(root, "base.md", 100, "# Local rule");
            const preview = await previewSync(root, state, input.token);
            remote.controls.losePatchResponse = true;
            await assert.rejects(applySync(root, state, input.token, { previewId: preview.id, mode: "merge", choices: {} }), /network/u);
            const patches = remote.controls.patchCount;
            assert.equal((await getSyncStatus(state)).hasPendingUpload, true);
            assert.doesNotMatch(await readFile(join(root, ".harness-align/layers/soul/kei.md"), "utf8"), /Remote option/u);
            const recovered = await previewSync(root, state, input.token);
            assert.match(recovered.notice, /Recovered an earlier upload/u);
            assert.match(await readFile(join(root, ".harness-align/layers/soul/kei.md"), "utf8"), /Remote option/u);
            await applySync(root, state, input.token, { previewId: recovered.id, mode: "merge", choices: {} });
            assert.equal(remote.controls.patchCount, patches);
            assert.equal((await getSyncStatus(state)).hasPendingUpload, false);
        }
        finally
        {
            mocked.mock.restore();
        }
    });
});

test("GitHub sync refuses public, truncated, and linked remote data before source changes", async (t) =>
{
    await withProject(async (root) =>
    {
        const remote = createSyncRemote();
        const mocked = t.mock.method(globalThis, "fetch", remote.request);
        const state = join(root, "app-state");
        const input = { owner: "test", repository: "sync", branch: "main", token: "test-token" };
        const before = await readSyncSnapshot(root);
        try
        {
            remote.controls.isPrivate = false;
            await assert.rejects(connectSync(state, input, "encrypted"), /private/u);
            remote.controls.isPrivate = true;
            await connectSync(state, input, "encrypted");
            remote.controls.isPrivate = false;
            const beforeRejectedPreview = mocked.mock.callCount();
            await assert.rejects(previewSync(root, state, input.token), /private/u);
            assert.equal(mocked.mock.callCount(), beforeRejectedPreview + 1);
            remote.controls.isPrivate = true;
            remote.publish(before);
            remote.controls.truncated = true;
            await assert.rejects(previewSync(root, state, input.token), /truncated/u);
            remote.controls.truncated = false;
            remote.controls.rejectedMode = "120000";
            await assert.rejects(previewSync(root, state, input.token), /symbolic links/u);
            assert.equal(syncSnapshotHash(await readSyncSnapshot(root)), syncSnapshotHash(before));
            assert.equal(remote.controls.patchCount, 0);
        }
        finally
        {
            mocked.mock.restore();
        }
    });
});

test("GitHub sync reuses an unchanged remote commit and fetches only new blobs after it moves", async (t) =>
{
    await withProject(async (root) =>
    {
        const remote = createSyncRemote();
        const mocked = t.mock.method(globalThis, "fetch", remote.request);
        const state = join(root, "app-state");
        const input = { owner: "test", repository: "sync", branch: "main", token: "test-token" };
        /** Count GitHub GET mock requests whose URL contains the given path fragment. */
        const count = (part: string): number => mocked.mock.calls.filter((call) =>
        {
            const method = (call.arguments[1] as RequestInit | undefined)?.method ?? "GET";
            return method === "GET" && String(call.arguments[0]).includes(part);
        }).length;
        try
        {
            await connectSync(state, input, "encrypted");
            const empty = await previewSync(root, state, input.token);
            assert.equal(empty.remoteEmpty, true);
            const afterEmpty = { blobs: count("/git/blobs/"), trees: count("/git/trees/") };
            const emptyAgain = await previewSync(root, state, input.token);
            assert.equal(emptyAgain.remoteEmpty, true);
            assert.notEqual(emptyAgain.id, empty.id);
            assert.throws(() => inspectSync(empty.id, "config.json"), /expired/u);
            assert.ok(inspectSync(emptyAgain.id, "config.json").files.length > 0);
            assert.equal(count("/git/blobs/"), afterEmpty.blobs);
            assert.equal(count("/git/trees/"), afterEmpty.trees);
            await applySync(root, state, input.token, { previewId: emptyAgain.id, mode: "initialize", choices: {} });
            const uploaded = await previewSync(root, state, input.token);
            assert.equal(uploaded.remoteEmpty, false);
            assert.equal(count("/git/blobs/"), afterEmpty.blobs);
            assert.equal(count("/git/trees/"), afterEmpty.trees);
            await connectSync(state, input, "encrypted");
            const restarted = await previewSync(root, state, input.token);
            assert.equal(restarted.head, uploaded.head);
            assert.throws(() => inspectSync(uploaded.id, "config.json"), /expired/u);
            assert.equal(count("/git/blobs/"), afterEmpty.blobs);
            assert.equal(count("/git/trees/"), afterEmpty.trees);
            const baseline = await readSyncSnapshot(root);
            await writeRule(root, "local.md", 50, "# Local only");
            const localEdit = await previewSync(root, state, input.token);
            assert.ok(localEdit.changes.some((change) => change.key === "rules/local.md" && change.direction === "upload"));
            assert.equal(count("/git/blobs/"), afterEmpty.blobs);
            baseline.files["rules/from-remote.md"] = Buffer.from("---\npriority: 40\ntargets:\n  - codex\n---\n\n# From remote\n").toString("base64");
            remote.publish(parseSyncSnapshot(baseline));
            const moved = await previewSync(root, state, input.token);
            assert.ok(moved.changes.some((change) => change.key === "rules/from-remote.md" && change.direction === "download"));
            assert.ok(moved.changes.some((change) => change.key === "rules/local.md" && change.direction === "upload"));
            const added = count("/git/blobs/") - afterEmpty.blobs;
            assert.ok(added >= 1 && added <= 2);
        }
        finally
        {
            mocked.mock.restore();
        }
    });
});

test("GitHub sync uploads after adopting a differently serialized manifest, including after reconnect", async (t) =>
{
    for (const reconnect of [false, true]) await withProject(async (root) =>
    {
        const remote = createSyncRemote();
        const mocked = t.mock.method(globalThis, "fetch", remote.request);
        const state = join(root, "app-state");
        const input = { owner: "test", repository: "sync", branch: "main", token: "test-token" };
        try
        {
            remote.publish(await readSyncSnapshot(root));
            await connectSync(state, input, "encrypted");
            const adoption = await previewSync(root, state, input.token);
            await applySync(root, state, input.token, { previewId: adoption.id, mode: "remote", choices: {} });
            assert.equal(remote.controls.patchCount, 0);
            if (reconnect) await connectSync(state, input, "encrypted");
            await writeRule(root, "base.md", 100, "# Local edit after adoption");
            const upload = await previewSync(root, state, input.token);
            await applySync(root, state, input.token, { previewId: upload.id, mode: "merge", choices: {} });
            assert.equal(remote.controls.patchCount, 1);
            assert.equal((await getSyncStatus(state)).hasPendingUpload, false);
        }
        finally
        {
            mocked.mock.restore();
        }
    });
});

test("GitHub sync evicts historical local blobs while retaining current snapshot content", async (t) =>
{
    await withProject(async (root) =>
    {
        const remote = createSyncRemote();
        const mocked = t.mock.method(globalThis, "fetch", remote.request);
        const state = join(root, "app-state");
        const input = { owner: "test", repository: "sync", branch: "main", token: "test-token" };
        try
        {
            const original = await readSyncSnapshot(root);
            await connectSync(state, input, "encrypted");
            for (let version = 0; version < 3; version++)
            {
                if (version > 0) await writeRule(root, "base.md", 100, `# Local version ${version}`);
                const preview = await previewSync(root, state, input.token);
                await applySync(root, state, input.token, { previewId: preview.id, mode: preview.remoteEmpty ? "initialize" : "merge", choices: {} });
            }
            const beforeRevert = mocked.mock.callCount();
            remote.publish(original);
            const reverted = await previewSync(root, state, input.token);
            assert.ok(reverted.downloadCount > 0);
            const downloaded = mocked.mock.calls.slice(beforeRevert).filter((call) => String(call.arguments[0]).includes("/git/blobs/"));
            const bytes = Buffer.from(original.files["rules/base.md"]!, "base64");
            const sha = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
            assert.ok(downloaded.some((call) => String(call.arguments[0]).endsWith(`/git/blobs/${sha}`)));
            assert.equal(downloaded.length, 2);
        }
        finally
        {
            mocked.mock.restore();
        }
    });
});

test("GitHub sync drains active downloads after failure without scheduling more or retaining partial blobs", { timeout: 10_000 }, async (t) =>
{
    await withProject(async (root) =>
    {
        const remote = createSyncRemote();
        let markStarted!: () => void;
        let failDownload!: () => void;
        let releaseDownloads!: () => void;
        const started = new Promise<void>((resolve) => { markStarted = resolve; });
        const fail = new Promise<void>((resolve) => { failDownload = resolve; });
        const release = new Promise<void>((resolve) => { releaseDownloads = resolve; });
        let failing = true;
        let requests = 0;
        const mocked = t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
        {
            if (String(url).includes("/git/blobs/"))
            {
                const request = ++requests;
                if (failing)
                {
                    if (request === 6) markStarted();
                    if (request === 1)
                    {
                        await fail;
                        throw new TypeError("simulated blob failure");
                    }
                    await release;
                }
            }
            return remote.request(url, init);
        });
        let completion: Promise<void> | undefined;
        try
        {
            for (let index = 0; index < 8; index++) await writeRule(root, `extra-${index}.md`, index, `# Extra ${index}`);
            const snapshot = await readSyncSnapshot(root);
            remote.publish(snapshot);
            const state = join(root, "app-state");
            const input = { owner: "test", repository: "sync", branch: "main", token: "test-token" };
            await connectSync(state, input, "encrypted");
            let finished = false;
            completion = assert.rejects(previewSync(root, state, input.token), /network/u).finally(() => { finished = true; });
            await started;
            failDownload();
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.equal(finished, false);
            releaseDownloads();
            await completion;
            assert.equal(requests, 6);
            failing = false;
            await previewSync(root, state, input.token);
            assert.equal(requests, 6 + Object.keys(snapshot.files).length + 1);
        }
        finally
        {
            failDownload();
            releaseDownloads();
            await completion;
            mocked.mock.restore();
        }
    });
});

test("sync uploads only local skill bytes and restores pinned remote skills with retry and cache reuse", async (t) =>
{
    await withProject(async (first) => withProject(async (second) =>
    {
        const remote = createSyncRemote();
        let offline = false;
        const archives: string[] = [];
        const uploadedPaths: string[] = [];
        t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
        {
            const path = String(url);
            if (path.includes("/repos/example/repo/commits/")) return Response.json({ sha: "a".repeat(40) });
            if (path.startsWith("https://github.com/example/repo/archive/"))
            {
                archives.push(path);
                if (offline) return new Response(null, { status: 503 });
                return new Response(TEST_SKILL_ARCHIVE);
            }
            if (path.endsWith("/git/trees") && init?.method === "POST")
            {
                const body = JSON.parse(String(init.body)) as { tree: TestGitEntry[] };
                uploadedPaths.push(...body.tree.map((entry) => entry.path));
            }
            return remote.request(url, init);
        });
        await addSkillSource(first, { url: "https://github.com/example/repo" });
        await discoverSkills(first);
        await installSkills(first, ["demo"]);
        const source = join(first, "incoming");
        await mkdir(source);
        await writeFile(join(source, "SKILL.md"), "# Local\n");
        await writeFile(join(source, "icon.bin"), Buffer.from([0, 255]));
        await installSkillFromDirectory(first, "local", source, { kind: "local", contentHash: "" });
        const full = await readSyncSnapshot(first);
        const portable = portableSyncSnapshot(full);
        assert.equal(portable.files["skills/demo/SKILL.md"], undefined);
        assert.ok(portable.files["skills/local/icon.bin"]);
        assert.equal(portable.directories.includes("skills/demo"), false);
        await validateSyncSources(portable, true);
        await assert.rejects(validateSyncSources(portable), /missing skill directory/u);
        const firstState = join(first, "app-state");
        const secondState = join(second, "app-state");
        const input = { owner: "test", repository: "sync", branch: "main", token: "test-token" };
        await connectSync(firstState, input, "encrypted");
        const initial = await previewSync(first, firstState, input.token);
        offline = true;
        await applySync(first, firstState, input.token, { previewId: initial.id, mode: "initialize", choices: {} });
        assert.equal(archives.length, 1);
        assert.ok(uploadedPaths.includes("skills/local/icon.bin"));
        assert.ok(!uploadedPaths.some((path) => path.startsWith("skills/demo/")));
        await connectSync(secondState, input, "encrypted");
        const adoption = await previewSync(second, secondState, input.token);
        const before = await readSyncSnapshot(second);
        await assert.rejects(applySync(second, secondState, input.token, { previewId: adoption.id, mode: "remote", choices: {} }), /download pending/u);
        assert.deepEqual(await readSyncSnapshot(second), before);
        assert.equal((await getSyncStatus(secondState)).hasPendingUpload, true);
        const patches = remote.controls.patchCount;
        offline = false;
        await previewSync(second, secondState, input.token);
        assert.equal(remote.controls.patchCount, patches);
        assert.equal((await getSyncStatus(secondState)).hasPendingUpload, false);
        assert.deepEqual(await readSyncSnapshot(second), full);
        assert.ok(archives.every((url) => url.endsWith(`${"a".repeat(40)}.zip`)));
        const stable = await previewSync(second, secondState, input.token);
        assert.equal(stable.uploadCount + stable.downloadCount, 0);
        const hidden = join(second, ".harness-align/skills/demo/.custom.json");
        await writeFile(hidden, "private local settings");
        await writeFile(join(second, ".harness-align/skills/demo/SKILL.md"), "# Edited locally\n");
        assert.deepEqual(portableSyncSnapshot(await readSyncSnapshot(second)), portable);
        const cached = await previewSync(second, secondState, input.token);
        assert.equal(cached.uploadCount + cached.downloadCount, 0);
        const downloads = archives.length;
        await applySync(second, secondState, input.token, { previewId: cached.id, mode: "merge", choices: {} });
        assert.equal(archives.length, downloads + 1);
        assert.equal(remote.controls.patchCount, patches);
        assert.deepEqual(await readSyncSnapshot(second), full);
    }));
});

test("sync preserves legacy skill provenance and rejects unavailable or unsafe remote references", async (t) =>
{
    await withProject(async (root) =>
    {
        await addSkillSource(root, { url: "https://github.com/example/repo" });
        t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0]) => String(url).includes("/commits/")
            ? Response.json({ sha: "a".repeat(40) }) : new Response(TEST_SKILL_ARCHIVE));
        await discoverSkills(root);
        await installSkills(root, ["demo"]);
        const full = await readSyncSnapshot(root);
        const index = await loadSkillIndex(root);
        const entry = index.demo!;
        assert.equal(entry.origin, "github");
        if (entry.origin !== "github") assert.fail("Expected GitHub origin");
        delete entry.commit;
        full.files["skills/index.json"] = Buffer.from(JSON.stringify({ skills: index })).toString("base64");
        const portable = portableSyncSnapshot(full);
        assert.deepEqual(portableSyncSnapshot(await hydrateSyncSkills(portable, emptySyncSnapshot())), portable);
        const duplicate = parseSyncSnapshot(portable);
        duplicate.files["skills/index.json"] = Buffer.from(JSON.stringify({ skills: { demo: entry, Demo: entry } })).toString("base64");
        await assert.rejects(validateSyncSources(duplicate, true), /unique without case sensitivity/u);
        assert.throws(() => portableSyncSnapshot(duplicate), /unique without case sensitivity/u);
        const invalidCommit = parseSyncSnapshot(portable);
        invalidCommit.files["skills/index.json"] = Buffer.from(JSON.stringify({ skills: { demo: { ...entry, commit: "../main" } } })).toString("base64");
        await assert.rejects(hydrateSyncSkills(invalidCommit, emptySyncSnapshot()), /40-character lowercase commit SHA/u);
        entry.contentHash = "b".repeat(64);
        portable.files["skills/index.json"] = Buffer.from(JSON.stringify({ skills: index })).toString("base64");
        await assert.rejects(hydrateSyncSkills(portable, emptySyncSnapshot()), /expected sourcePath.*contentHash/u);
        entry.owner = "../escape";
        portable.files["skills/index.json"] = Buffer.from(JSON.stringify({ skills: index })).toString("base64");
        await assert.rejects(validateSyncSources(portable, true), /safe GitHub owner/u);
    });
});

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

test("resolveExistingHarnessRoot returns configured directories and rejects missing, unknown, and reparse targets", async () =>
{
    await withProject(async (root) =>
    {
        const userProfile = join(root, "isolated-userprofile");
        const nestedRoot = join(userProfile, ".config", "opencode");
        await mkdir(join(userProfile, ".codex"), { recursive: true });
        await mkdir(nestedRoot, { recursive: true });
        assert.equal(await resolveExistingHarnessRoot(root, "codex", userProfile), join(userProfile, ".codex"));
        assert.equal(await resolveExistingHarnessRoot(root, "opencode", userProfile), nestedRoot);
        await assert.rejects(resolveExistingHarnessRoot(root, "cursor", userProfile), /cursor target root: directory does not exist/u);
        await assert.rejects(readdir(join(userProfile, ".cursor")), /ENOENT/u);
        await assert.rejects(resolveExistingHarnessRoot(root, "Codex", userProfile), /harness is not configured, got "Codex"/u);
        await assert.rejects(resolveExistingHarnessRoot(root, "missing", userProfile), /harness is not configured, got "missing"/u);
        await writeFile(join(userProfile, ".cursor"), "not a directory\n", "utf8");
        await assert.rejects(resolveExistingHarnessRoot(root, "cursor", userProfile), /cursor target root: expected a directory/u);
        const redirected = join(root, "redirected-codex");
        await mkdir(redirected, { recursive: true });
        await rm(join(userProfile, ".codex"), { recursive: true });
        await symlink(redirected, join(userProfile, ".codex"), "junction");
        await assert.rejects(resolveExistingHarnessRoot(root, "codex", userProfile), /reparse points are not allowed/u);
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

test("skill index rejects missing, non-string, and whitespace-only GitHub source paths", async () =>
{
    await withProject(async (root) =>
    {
        const directory = join(root, ".harness-align", "skills");
        await mkdir(directory);
        for (const sourcePath of [undefined, null, 0, false, {}, [], " \t"])
        {
            const skills = { demo: { origin: "github", owner: "example", name: "repo", branch: "main", sourcePath, contentHash: "hash" } };
            await writeFile(join(directory, "index.json"), JSON.stringify({ skills }));
            await assert.rejects(loadSkillIndex(root), /skills\.demo\.sourcePath/u);
        }
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
        const guide = await readFile(join(home, ".harness-align", "AGENTS.md"), "utf8");
        assert.match(guide, /https:\/\/github.com\/SnowyLake\/HarnessAlign/u);
        assert.match(guide, /Setup/u);
        assert.equal(guide.includes("\r"), false);
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

test("workspace guide refreshes managed content, preserves custom files, and stays outside outputs and sync", async () =>
{
    await withProject(async (root) =>
    {
        const path = join(root, ".harness-align", "AGENTS.md");
        const sources = await readSyncSnapshot(root);
        const outputs = await buildOutputs(root);
        await ensureUserWorkspace(root);
        const guide = await readFile(path);
        const modified = (await fs.stat(path)).mtimeMs;
        await ensureUserWorkspace(root);
        assert.equal((await fs.stat(path)).mtimeMs, modified);
        await writeFile(path, "<!-- Generated by Harness Align. Do not edit. -->\nOld guide\n");
        await ensureUserWorkspace(root);
        assert.deepEqual(await readFile(path), guide);
        await unlink(path);
        await ensureUserWorkspace(root);
        assert.deepEqual(await readFile(path), guide);
        assert.deepEqual(await readSyncSnapshot(root), sources);
        assert.deepEqual(await buildOutputs(root), outputs);
        await writeFile(path, "# Custom instructions\n");
        await ensureUserWorkspace(root);
        assert.equal(await readFile(path, "utf8"), "# Custom instructions\n");
    });
});

test("workspace guide rejects directories and junctions without changing their contents", async () =>
{
    await withProject(async (root) =>
    {
        const path = join(root, ".harness-align", "AGENTS.md");
        await mkdir(path);
        await assert.rejects(ensureUserWorkspace(root), /AGENTS.md: expected a regular workspace guide file/u);
        await fs.rmdir(path);
        const target = join(root, "protected-guide");
        await mkdir(target);
        await writeFile(join(target, "sentinel"), "keep");
        await symlink(target, path, "junction");
        try
        {
            await assert.rejects(ensureUserWorkspace(root), /AGENTS.md: symbolic link sources/u);
            assert.equal(await readFile(join(target, "sentinel"), "utf8"), "keep");
        }
        finally
        {
            await unlink(path);
        }
    });
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
        before.set("AGENTS.md", await readFile(join(current, "AGENTS.md")));
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
            before.set("AGENTS.md", await readFile(join(current, "AGENTS.md")));
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
        before.set("AGENTS.md", await readFile(join(current, "AGENTS.md")));
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

test("repository-root skills survive batch installation, workspace reload, reinstall, and update checks", async (t) =>
{
    await withProject(async (root) =>
    {
        await addSkillSource(root, { url: "https://github.com/example/repo" });
        const archive = Buffer.from(
            "UEsDBBQAAAAIAIxwLF1GWw6tCQAAAAcAAAASAAAAcmVwby1tYWluL1NLSUxMLm1kU1YIys8v4QIAUEsDBBQAAAAIAIxwLF30xqGHCQAAAAcAAAAXAAAA"
            + "cmVwby1tYWluL2RlbW8vU0tJTEwubWRTVnBJzc3nAgBQSwECFAAUAAAACACMcCxdRlsOrQkAAAAHAAAAEgAAAAAAAAAAAAAAAAAAAAAAcmVwby1tYWlu"
            + "L1NLSUxMLm1kUEsBAhQAFAAAAAgAjHAsXfTGoYcJAAAABwAAABcAAAAAAAAAAAAAAAAAOQAAAHJlcG8tbWFpbi9kZW1vL1NLSUxMLm1kUEsFBgAAAAACAAIAhQAAAHcAAAAAAA==",
            "base64",
        );
        const mocked = t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0]) => String(url).includes("/commits/") ? Response.json({ sha: "a".repeat(40) }) : new Response(archive));
        try
        {
            const discovered = await discoverSkills(root);
            assert.deepEqual(discovered.map(({ id, sourcePath }) => ({ id, sourcePath })), [{ id: "demo", sourcePath: "demo" }, { id: "repo", sourcePath: "" }]);
            assert.match(await installSkills(root, ["repo", "demo"]), /Installed 2 skill\(s\)/u);
            const workspace = await loadWorkspace(root);
            assert.deepEqual(workspace.skills.map((skill) => skill.id), ["demo", "repo"]);
            const origin = workspace.skills.find((skill) => skill.id === "repo")!.origin;
            assert.equal(origin.kind, "github");
            if (origin.kind !== "github") assert.fail("Expected GitHub origin");
            assert.equal(origin.sourcePath, "");
            assert.deepEqual(await readdir(join(root, ".harness-align", "skills", "repo")), ["SKILL.md"]);
            assert.match(await installSkills(root, ["repo"]), /Installed 1 skill\(s\)/u);
            const updates = await checkSkillUpdates(root);
            assert.equal(updates.length, 2);
            for (const update of updates)
            {
                assert.equal(update.error, undefined);
                assert.equal(update.currentHash, update.remoteHash);
            }
        }
        finally
        {
            mocked.mock.restore();
        }
    });
});

test("discovery cache no longer installs skills after their source is removed", async (t) =>
{
    await withProject(async (root) =>
    {
        await addSkillSource(root, { url: "https://github.com/example/repo" });
        const mocked = t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0]) => String(url).includes("/commits/") ? Response.json({ sha: "a".repeat(40) }) : new Response(TEST_SKILL_ARCHIVE, { status: 200 }));
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
            if (requests.length === 1) return new Response(null, { status: 404 });
            return String(url).includes("/commits/") ? Response.json({ sha: "a".repeat(40) }) : new Response(TEST_SKILL_ARCHIVE);
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
            assert.deepEqual(requests.map((url) => new URL(url).pathname), ["/repos/example/repo/commits/main", "/repos/example/repo/commits/master", `/example/repo/archive/${"a".repeat(40)}.zip`]);
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

test("prototype-named harnesses and skills require explicit own metadata", async () =>
{
    await withProject(async (root) =>
    {
        await addHarness(root, { name: "constructor", configPath: ".constructor", agentFormat: "yaml", agentExtension: "md" });
        assert.equal((await buildOutputs(root)).has("constructor/agents/explorer.md"), false);
        const agent = (await loadWorkspace(root)).agents[0]!;
        await saveAgent(root, { ...agent, harnesses: { ...agent.harnesses, constructor: { enabled: true } } });
        assert.match(output(await buildOutputs(root), "constructor/agents/explorer.md"), /enabled: true/u);
        const directory = join(root, ".harness-align", "skills", "constructor");
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, "SKILL.md"), "# Skill\n");
        assert.deepEqual((await loadSkills(root))[0]!.origin, { kind: "unknown" });
    });
});

test("agent saves reject duplicate logical names before changing any sources", async () =>
{
    await withProject(async (root) =>
    {
        const agent = (await loadWorkspace(root)).agents[0]!;
        const before = await snapshot(join(root, ".harness-align"));
        await assert.rejects(saveAgent(root, { ...agent, path: ".harness-align/agents/other.md", name: agent.name.toUpperCase() }), /name must be unique/u);
        assert.deepEqual(await snapshot(join(root, ".harness-align")), before);
        await saveAgent(root, { ...agent, description: "Updated description" });
        assert.equal((await loadWorkspace(root)).agents[0]!.description, "Updated description");
    });
});

test("setup excludes unmanaged generated agents and deploys an empty current selection", async () =>
{
    await withProject(async (root) =>
    {
        const home = join(root, "test-home");
        await mkdir(join(home, ".codex", "agents"), { recursive: true });
        await mkdir(join(root, ".harness-align", "rules", "shared"));
        await generate(root);
        const unmanaged = join(root, ".harness-align", "generated", "codex", "agents", "unmanaged.toml");
        await writeFile(unmanaged, "keep in generated only");
        const first = await setup(root, undefined, home);
        assert.deepEqual(await readdir(join(home, ".codex", "agents")), ["explorer.toml"]);
        assert.deepEqual(first.targets[0]!.files, ["AGENTS.md", "agents/explorer.toml"]);
        await unlink(join(root, ".harness-align", "agents", "explorer.md"));
        await setup(root, undefined, home);
        assert.deepEqual(await readdir(join(home, ".codex", "agents")), []);
        assert.equal(await readFile(unmanaged, "utf8"), "keep in generated only");
    });
});

test("generated reads reject a linked workspace parent", async () =>
{
    await withProject(async (root) =>
    {
        await generate(root);
        const source = join(root, ".harness-align");
        const redirected = join(root, "redirected");
        await rename(source, redirected);
        await symlink(redirected, source, "junction");
        await assert.rejects(readGeneratedFiles(root), /symbolic link/u);
    });
});

test("skill install and deployment share hidden-file filtering and preserve empty directories", async () =>
{
    await withProject(async (root) =>
    {
        const source = join(root, "incoming");
        await mkdir(join(source, "empty"), { recursive: true });
        await mkdir(join(source, ".hidden"));
        await writeFile(join(source, "SKILL.md"), "# Skill\n");
        await writeFile(join(source, ".hidden", "private.txt"), "hidden");
        await installSkillFromDirectory(root, "demo", source, { kind: "local", contentHash: "" });
        const installed = join(root, ".harness-align", "skills", "demo");
        assert.deepEqual((await readdir(installed)).sort(), ["SKILL.md", "empty"]);
        const home = join(root, "test-home");
        await mkdir(home);
        await mkdir(join(root, ".harness-align", "rules", "shared"));
        await setup(root, undefined, home);
        assert.deepEqual((await readdir(join(home, ".agents", "skills", "demo"))).sort(), ["SKILL.md", "empty"]);
    });
});

test("bounded downloads cancel oversized bodies and release stream locks", async () =>
{
    for (const declared of [true, false])
    {
        let cancelled = false;
        const response = new Response(new ReadableStream<Uint8Array>({
            start(controller) { controller.enqueue(new Uint8Array(5)); },
            cancel() { cancelled = true; },
        }), { headers: declared ? { "content-length": "5" } : {} });
        await assert.rejects(readResponseBytes(response, 4, "test download"), /exceeds 4 bytes/u);
        assert.equal(cancelled, true);
        assert.equal(response.body!.locked, false);
    }
    const response = new Response("1234");
    assert.equal((await readResponseBytes(response, 4, "test download")).toString(), "1234");
    assert.equal(response.body!.locked, false);
    await assert.rejects(readResponseBytes(new Response(null), 4, "test download"), /empty response body/u);
});

test("discovery rejects backslash paths before installing archive contents", async (t) =>
{
    await withProject(async (root) =>
    {
        await addSkillSource(root, { url: "https://github.com/example/repo" });
        const archive = Buffer.from(TEST_SKILL_ARCHIVE.toString("latin1").replaceAll("repo-main/", "repo-main\\"), "latin1");
        assert.notDeepEqual(archive, TEST_SKILL_ARCHIVE);
        t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0]) => String(url).includes("/commits/") ? Response.json({ sha: "a".repeat(40) }) : new Response(archive));
        await assert.rejects(discoverSkills(root), /zip entry path is unsafe/u);
        assert.deepEqual(await loadSkills(root), []);
    });
});

test("Layer selection keeps local choices and falls back only when the selected option disappears", async () =>
{
    await withProject(async (root) =>
    {
        const initial = useAppStore.getState();
        try
        {
            const workspace = { ...await loadWorkspace(root), generatedFiles: [] };
            initial.setWorkspace(undefined);
            initial.setWorkspace(workspace);
            initial.setLayerSelection([{ name: "soul", option: "kei" }]);
            initial.setWorkspace(workspace);
            assert.deepEqual(useAppStore.getState().layerSelection, [{ name: "soul", option: "kei" }]);
            assert.equal(workspaceChangeCount(useAppStore.getState()), 1);
            initial.setWorkspace({ ...workspace, layerOptions: { soul: workspace.layerOptions.soul!.filter((option) => option.name !== "kei") } });
            assert.deepEqual(useAppStore.getState().layerSelection, [{ name: "soul", option: "arona" }]);
            assert.equal(workspaceChangeCount(useAppStore.getState()), 0);
            initial.setLayerSelection([]);
            initial.setWorkspace(workspace);
            assert.deepEqual(useAppStore.getState().layerSelection, []);
            assert.equal(defaultLayerOption(workspace, "constructor"), undefined);
            const sequence = ["a", "b", "c"].map((name) => ({ name, option: "default" }));
            assert.deepEqual(moveLayerSelection(sequence, "a", "c").map((item) => item.name), ["b", "c", "a"]);
            assert.deepEqual(moveLayerSelection(sequence, "c", "a").map((item) => item.name), ["c", "a", "b"]);
            assert.deepEqual(moveLayerSelection(sequence, "missing", "a"), sequence);
            assert.deepEqual(moveLayerSelection(sequence, "a", "a"), sequence);
        }
        finally
        {
            useAppStore.setState(initial, true);
        }
        await saveConfig(root, { ...await loadConfig(root), layers: [] });
        await rm(join(root, ".harness-align", "layers"), { recursive: true });
        await assert.rejects(removeLayer(root, "constructor"), /layer does not exist/u);
    });
});

test("skill batches reject later origin and case conflicts before installing the first item", async (t) =>
{
    await withProject(async (root) =>
    {
        const source = join(root, "incoming");
        await mkdir(source);
        await writeFile(join(source, "SKILL.md"), "# Existing local skill\n");
        await installSkillFromDirectory(root, "kept", source, { kind: "local", contentHash: "" });
        await addSkillSource(root, { url: "https://github.com/example/repo" });
        await addSkillSource(root, { url: "https://github.com/example/other" });
        const other = Buffer.from(TEST_SKILL_ARCHIVE.toString("latin1").replaceAll("demo", "kept"), "latin1");
        t.mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0]) => String(input).includes("/commits/") ? Response.json({ sha: "a".repeat(40) }) : new Response(String(input).includes("/other/") ? other : TEST_SKILL_ARCHIVE));
        await discoverSkills(root);
        const before = await snapshot(join(root, ".harness-align"));
        await assert.rejects(installSkills(root, ["demo", "kept"]), /different origin/u);
        assert.deepEqual(await snapshot(join(root, ".harness-align")), before);
    });
    await withProject(async (root) =>
    {
        const home = join(root, "test-home");
        for (const id of ["fresh", "demo"])
        {
            await mkdir(join(home, ".agents", "skills", id), { recursive: true });
            await writeFile(join(home, ".agents", "skills", id, "SKILL.md"), "# User skill\n");
        }
        await installSkillFromDirectory(root, "Demo", join(home, ".agents", "skills", "demo"), { kind: "local", contentHash: "" });
        const before = await snapshot(join(root, ".harness-align"));
        await assert.rejects(importUserSkills(root, ["fresh", "demo"], true, home), /unique without case sensitivity/u);
        assert.deepEqual(await snapshot(join(root, ".harness-align")), before);
    });
});
