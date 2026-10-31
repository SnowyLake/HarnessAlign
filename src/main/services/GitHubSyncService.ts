/**
 * Manual GitHub snapshot sync for Main, using GitHub's Git Data API rather than a local Git clone.
 * Electron credential encryption stays at the IPC boundary so this service can be tested without Electron.
 * Preview diffs against the persisted baseline and content-addressed blobs; it does not re-download an unchanged commit.
 * The startup check reuses that diff and does not recover, upgrade, publish, or retain an applicable preview.
 */

import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { applySyncSources, upgradeSyncConfig, validateSyncSources } from "../../engine/Edit.js";
import { applyFileSyncTargets, ensureFileSyncCompatibility, inspectFileSyncTargets, type FileSyncApplication, type FileSyncTarget } from "../../engine/Setup.js";
import { atomicWrite, ensureRegularSource, lstatIfExists } from "../../engine/FsSafe.js";
import { parseConfigSource } from "../../engine/Load.js";
import { HalignError } from "../../engine/Model.js";
import {
    assertSyncPath, emptySyncSnapshot, mergeSyncSnapshots, parseSyncSnapshot, portableSyncSnapshot, readSyncSnapshot, restoreSyncChange, stopSyncFile, syncFilePaths, syncSnapshotHash, withoutFileContents,
    SYNC_MAX_ENTRIES, SYNC_MAX_FILE_BYTES, SYNC_MAX_TOTAL_BYTES, type SyncMerge, type SyncSnapshot,
} from "../../engine/Sync.js";
import { syncPreviewHasWork } from "../../shared/models/Sync.js";
import type { FileSyncState, SyncApplyInput, SyncCheckResult, SyncConnectionInput, SyncDetail, SyncDiscardInput, SyncFileChange, SyncFileView, SyncPreview, SyncResult, SyncStatus } from "../../shared/models/Sync.js";
import { fetchRemote, githubRateLimitHint, readResponseBytes } from "./RemoteFetch.js";
import { hydrateSyncSkills } from "./SkillRemoteService.js";

/** Stored connection includes only an OS-encrypted token. */
interface SyncConnection extends Omit<SyncConnectionInput, "token">
{
    encryptedToken: string;
}

/** Persisted baseline and in-flight upload survive network failures and process exits. */
interface SyncState
{
    version: 1 | 2 | 3;
    connection: SyncConnection | null;
    base: { connectionKey: string; head: string; snapshot: SyncSnapshot; syncedAt: string } | null;
    pending: { connectionKey: string; head: string; parent: string; before: SyncSnapshot; snapshot: SyncSnapshot; applications?: FileSyncApplication[] | undefined } | null;
    applications?: FileSyncApplication[] | undefined;
}

/** One immutable remote head and the source subtree read from it. */
interface RemoteSnapshot
{
    head: string;
    rootTree: string;
    snapshot: SyncSnapshot;
    blobs: Set<string>;
    empty: boolean;
}

/** A retained preview binds choices to exact files, connection, and baseline. */
interface RetainedPreview
{
    public: SyncPreview;
    connectionKey: string;
    baseHead: string | null;
    local: SyncSnapshot;
    remote: RemoteSnapshot;
    base: SyncSnapshot;
    plan?: {
        next: SyncSnapshot;
        candidate: SyncSnapshot;
        observations: FileSyncTarget[];
        observationSnapshot: SyncSnapshot;
        applications: FileSyncApplication[];
    };
}

const SHA_SCHEMA = z.string().regex(/^[a-f0-9]{40}$/u);
const OBJECT_SCHEMA = z.object({ sha: SHA_SCHEMA });
const REFERENCE_SCHEMA = z.object({ object: z.object({ type: z.literal("commit"), sha: SHA_SCHEMA }) });
const COMMIT_SCHEMA = z.object({ tree: OBJECT_SCHEMA });
const TREE_SCHEMA = z.object({
    truncated: z.boolean(),
    tree: z.array(z.object({ path: z.string(), mode: z.string(), type: z.string(), sha: SHA_SCHEMA, size: z.number().int().nonnegative().optional() })),
});
const SNAPSHOT_SCHEMA = z.unknown().transform((value) => parseSyncSnapshot(value));
const CONNECTION_SCHEMA = z.object({ owner: z.string(), repository: z.string(), branch: z.string(), encryptedToken: z.string() });
const FILE_APPLICATION_SCHEMA = z.object({
    target: z.object({
        key: z.string().min(1).max(240), harness: z.string().min(1).max(240), filePath: z.string().min(1).max(240), target: z.string().min(1).max(500),
        content: z.string().max(Math.ceil(SYNC_MAX_FILE_BYTES / 3) * 4).nullable(), state: z.enum(["ready", "missing", "folder-missing", "parent-missing", "unsafe"]),
        baseline: z.string().regex(/^[a-f0-9]{64}$/u).optional(), error: z.string().optional(),
    }),
    content: z.string().max(Math.ceil(SYNC_MAX_FILE_BYTES / 3) * 4),
});
const STATE_SCHEMA = z.object({
    version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    connection: CONNECTION_SCHEMA.nullable(),
    base: z.object({ connectionKey: z.string(), head: SHA_SCHEMA, snapshot: SNAPSHOT_SCHEMA, syncedAt: z.string() }).nullable(),
    pending: z.object({ connectionKey: z.string(), head: SHA_SCHEMA, parent: SHA_SCHEMA, before: SNAPSHOT_SCHEMA, snapshot: SNAPSHOT_SCHEMA,
        applications: z.array(FILE_APPLICATION_SCHEMA).max(SYNC_MAX_ENTRIES).optional() }).nullable(),
    applications: z.array(FILE_APPLICATION_SCHEMA).max(SYNC_MAX_ENTRIES).optional(),
});
const REMOTE_DIRECTORY = "harness-align";
const REMOTE_MANIFEST = "sync.json";
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

/** One desktop window owns one preview at a time; fresh previews invalidate older decisions. */
let retainedPreview: RetainedPreview | undefined;
/** Last validated remote tree, reused while the connection and commit stay the same. */
let cachedRemote: { connectionKey: string; remote: RemoteSnapshot } | undefined;
/** Content-addressed blobs from recent remote trees, reused when only some files change. */
let blobCache = new Map<string, Buffer>();

/** Drop reused remote objects when the connection itself changes. */
function clearRemoteCache(): void
{
    cachedRemote = undefined;
    blobCache = new Map();
}

/** Encode the sync format marker the same way upload and cache hashing do. */
function manifestBytes(snapshot: SyncSnapshot): Buffer
{
    return Buffer.from(`${JSON.stringify({ version: snapshot.version === 4 ? 3 : snapshot.version === 3 ? 2 : 1, directories: snapshot.directories,
        ...(snapshot.version >= 3 ? { stoppedFiles: snapshot.stoppedFiles ?? [] } : {}), ...(snapshot.version === 4 ? { files: syncFilePaths(snapshot) } : {}) }, null, 2)}\n`);
}

/** Retain only this snapshot's bytes so local uploads cannot accumulate historical versions. */
function rememberSnapshotBlobs(snapshot: SyncSnapshot): void
{
    blobCache = new Map();
    for (const encoded of Object.values(snapshot.files))
    {
        const bytes = Buffer.from(encoded, "base64");
        blobCache.set(blobHash(bytes), bytes);
    }
    const manifest = manifestBytes(snapshot);
    blobCache.set(blobHash(manifest), manifest);
}

/** Source blob ids proven by a baseline; its original manifest serialization is unknown. */
function blobsForSnapshot(snapshot: SyncSnapshot): Set<string>
{
    const blobs = new Set<string>();
    for (const encoded of Object.values(snapshot.files)) blobs.add(blobHash(Buffer.from(encoded, "base64")));
    return blobs;
}

/** Rebuild a remote view from a snapshot already validated at this exact commit. */
function remoteFromSnapshot(head: string, rootTree: string, snapshot: SyncSnapshot, empty: boolean): RemoteSnapshot
{
    return { head, rootTree, snapshot, blobs: blobsForSnapshot(snapshot), empty };
}

/** Validate GitHub coordinates without allowing arbitrary hosts or malformed Git references. */
export function validateSyncConnection(input: Pick<SyncConnectionInput, "owner" | "repository" | "branch">): void
{
    for (const [field, value] of [["owner", input.owner], ["repository", input.repository]])
    {
        if (!value || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/u.test(value)) throw new HalignError(`GitHub ${field}: expected an alphanumeric repository identifier, got ${JSON.stringify(value)}`);
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/u.test(input.branch) || input.branch.includes("..")
        || input.branch.split("/").some((part) => !part || part.startsWith(".") || part.endsWith(".") || part.endsWith(".lock")))
    {
        throw new HalignError(`GitHub branch: expected a valid branch name, got ${JSON.stringify(input.branch)}`);
    }
}

/** Bind a baseline to the exact repository and case-sensitive branch. */
function connectionKey(connection: SyncConnection): string
{
    return `${connection.owner.toLowerCase()}/${connection.repository.toLowerCase()}@${connection.branch}`;
}

/** Resolve the internal state file and refuse a linked directory or file. */
async function statePath(directory: string): Promise<string>
{
    const path = join(directory, "github-sync.json");
    await ensureRegularSource(directory, path);
    return path;
}

/** Load bounded sync state; malformed records must not silently discard a pending upload. */
async function readState(directory: string): Promise<SyncState>
{
    const path = await statePath(directory);
    const stats = await lstatIfExists(path);
    if (!stats) return { version: 3, connection: null, base: null, pending: null };
    if (!stats.isFile() || stats.size > 320 * 1024 * 1024) throw new HalignError(`${path}: expected a sync state file of at most 320 MiB`);
    try
    {
        const state = STATE_SCHEMA.parse(JSON.parse(await fs.readFile(path, "utf8")));
        if (state.connection) validateSyncConnection(state.connection);
        return state;
    }
    catch
    {
        throw new HalignError(`${path}: invalid sync state; retain this file to recover any pending upload`);
    }
}

/** Persist credentials, baseline, and pending receipt together in one atomic file. */
async function writeState(directory: string, state: SyncState): Promise<void>
{
    state.version = 3;
    const bytes = Buffer.from(`${JSON.stringify(state)}\n`);
    if (bytes.length > 320 * 1024 * 1024) throw new HalignError("GitHub sync state exceeds 320 MiB; pending work was preserved");
    await atomicWrite(await statePath(directory), bytes);
}

/** Return a sanitized status without exposing stored credentials or source paths. */
function publicStatus(state: SyncState): SyncStatus
{
    const connection = state.connection;
    return {
        connected: connection !== null,
        owner: connection?.owner ?? "",
        repository: connection?.repository ?? "",
        branch: connection?.branch ?? "",
        lastSyncedAt: connection && state.base?.connectionKey === connectionKey(connection) ? state.base.syncedAt : null,
        hasPendingUpload: state.pending !== null,
        hasPendingApplication: (state.applications?.length ?? 0) > 0,
    };
}

/** Refuse to publish intermediate source or target state from an interrupted local operation. */
async function assertWorkspaceRecovered(root: string): Promise<void>
{
    for (const name of [".sync-recovery.json", ".edit-recovery.json", ".deployment-recovery.json"])
    {
        const path = join(root, ".harness-align", name);
        await ensureRegularSource(root, path);
        if (await lstatIfExists(path)) throw new HalignError(`${path}: local recovery is required; reload the workspace before reviewing sync`);
    }
}

/** Read local connection status without contacting GitHub. */
export async function getSyncStatus(directory: string, root?: string): Promise<SyncStatus>
{
    const state = await readState(directory);
    const status = publicStatus(state);
    if (!root || !state.connection) return status;
    try
    {
        await assertWorkspaceRecovered(root);
        if (!state.base || state.base.connectionKey !== connectionKey(state.connection)) return { ...status, localState: "uninitialized" };
        const local = portableSyncSnapshot(await readSyncSnapshot(root));
        const actual = await inspectFileSyncTargets(root, local, root);
        const changed = status.hasPendingApplication || Object.keys((await readSyncSnapshot(root)).legacyFiles ?? {}).length > 0
            || syncSnapshotHash(withoutFileContents(local)) !== syncSnapshotHash(withoutFileContents(portableSyncSnapshot(state.base.snapshot)))
            || actual.some((target) => target.state !== "ready" || target.content !== state.base!.snapshot.files[target.key]);
        return { ...status, localState: changed ? "changed" : "current" };
    }
    catch (error)
    {
        return { ...status, localState: "unknown", localError: error instanceof Error ? error.message : String(error) };
    }
}

/** Read encrypted credentials only for Main's OS credential boundary. */
export async function getSyncEncryptedToken(directory: string): Promise<string>
{
    const connection = (await readState(directory)).connection;
    if (!connection) throw new HalignError("Remote is not connected");
    return connection.encryptedToken;
}

/** Call only GitHub's API with bounded bodies, a timeout, and errors that cannot echo the token. */
async function github(connection: SyncConnection, token: string, path: string, method = "GET", body?: unknown): Promise<unknown>
{
    if (!token || token.length > 1024 || /\s/u.test(token)) throw new HalignError("GitHub token: expected a non-empty personal access token without whitespace");
    const url = `https://api.github.com/repos/${encodeURIComponent(connection.owner)}/${encodeURIComponent(connection.repository)}${path}`;
    const signal = AbortSignal.timeout(60_000);
    try
    {
        const response = await fetchRemote(url, {
            method,
            headers: {
                Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2026-03-10",
                "User-Agent": "HarnessAlign/1.0", "Content-Type": "application/json",
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            redirect: "error",
            signal,
        });
        if (!response.ok)
        {
            await response.body?.cancel();
            const hint = githubRateLimitHint(response) ?? (response.status === 401 ? "renew the token"
                : response.status === 403 || response.status === 429 ? "check Contents read/write permission, repository policy, and API rate limits; retry later"
                    : response.status === 404 ? "check the selected private repository, initialized branch, and token access"
                        : response.status === 409 || response.status === 422 ? "the branch changed or repository rules rejected the commit; preview again"
                            : "retry when GitHub is available");
            throw new HalignError(`GitHub ${method} ${path || "/"}: HTTP ${response.status}; ${hint}`);
        }
        return JSON.parse((await readResponseBytes(response, MAX_RESPONSE_BYTES, "GitHub response")).toString("utf8"));
    }
    catch (error)
    {
        if (error instanceof HalignError) throw error;
        const cause = error instanceof Error ? error.cause : undefined;
        const code = cause instanceof Error && "code" in cause && typeof cause.code === "string" ? cause.code
            : error instanceof Error ? error.message.match(/\bnet::ERR_[A-Z_]+\b/u)?.[0] : undefined;
        const safeCode = code && code.length <= 80 && /^(?:E[A-Z_]+|UND_ERR_[A-Z_]+|net::ERR_[A-Z_]+)$/u.test(code) ? code.replaceAll(token, "[redacted]") : undefined;
        const detail = signal.aborted ? "request timed out after 60s" : error instanceof SyntaxError ? "invalid JSON response"
            : `network failure${safeCode ? ` (${safeCode})` : ""}`;
        throw new HalignError(`GitHub ${method} ${path || "/"}: ${detail}; check connectivity and proxy settings, then preview again`);
    }
}

/** Require a private, writable repository on every sync, including after visibility changes. */
async function checkRepository(connection: SyncConnection, token: string): Promise<void>
{
    const repository = z.object({ private: z.boolean(), archived: z.boolean(), permissions: z.object({ push: z.boolean() }).optional() }).parse(await github(connection, token, ""));
    if (!repository.private || repository.archived || repository.permissions?.push === false) throw new HalignError("GitHub Sync requires a private, unarchived repository with write access");
}

/** Validate a connection before replacing its locally encrypted credential. */
export async function connectSync(directory: string, input: SyncConnectionInput, encryptedToken: string): Promise<SyncStatus>
{
    validateSyncConnection(input);
    const connection: SyncConnection = { owner: input.owner, repository: input.repository, branch: input.branch, encryptedToken };
    const state = await readState(directory);
    if (state.pending && state.pending.connectionKey !== connectionKey(connection)) throw new HalignError("Resolve the pending upload on the previous repository before connecting another repository");
    await checkRepository(connection, input.token);
    REFERENCE_SCHEMA.parse(await github(connection, input.token, `/git/ref/heads/${encodeURIComponent(connection.branch)}`));
    state.connection = connection;
    await writeState(directory, state);
    retainedPreview = undefined;
    clearRemoteCache();
    return publicStatus(state);
}

/** Remove the local credential while retaining recoverable history and any pending upload. */
export async function disconnectSync(directory: string): Promise<SyncStatus>
{
    const state = await readState(directory);
    state.connection = null;
    await writeState(directory, state);
    retainedPreview = undefined;
    clearRemoteCache();
    return publicStatus(state);
}

/** Compute the Git blob identity without requiring an installed Git executable. */
function blobHash(bytes: Buffer): string
{
    return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

/** Read a blob by immutable id and validate its decoded size and hash. */
async function readBlob(connection: SyncConnection, token: string, sha: string): Promise<Buffer>
{
    const blob = z.object({ encoding: z.literal("base64"), content: z.string(), size: z.number().int().nonnegative() }).parse(await github(connection, token, `/git/blobs/${sha}`));
    const bytes = Buffer.from(blob.content.replace(/\s/gu, ""), "base64");
    if (bytes.length > SYNC_MAX_FILE_BYTES || bytes.length !== blob.size || blobHash(bytes) !== sha)
    {
        throw new HalignError(`GitHub blob ${sha}: invalid content hash or size; maximum file size is 8 MiB`);
    }
    return bytes;
}

/** Stop scheduling on failure and drain active downloads before releasing the workspace queue. */
async function loadBlobs(connection: SyncConnection, token: string, shas: Iterable<string>): Promise<Map<string, Buffer>>
{
    const unique = [...new Set(shas)];
    const used = new Map<string, Buffer>();
    let next = 0;
    let failed = false;
    const results = await Promise.allSettled(Array.from({ length: Math.min(6, unique.length) }, async () =>
    {
        while (!failed && next < unique.length)
        {
            const sha = unique[next++];
            if (sha === undefined) break;
            try
            {
                used.set(sha, blobCache.get(sha) ?? await readBlob(connection, token, sha));
            }
            catch (error)
            {
                failed = true;
                throw error;
            }
        }
    }));
    for (const result of results) if (result.status === "rejected") throw result.reason;
    return used;
}

/** Read a complete source subtree from one immutable commit, never a moving branch archive. */
async function readRemote(connection: SyncConnection, token: string, baseline?: { head: string; snapshot: SyncSnapshot }): Promise<RemoteSnapshot>
{
    const key = connectionKey(connection);
    const head = REFERENCE_SCHEMA.parse(await github(connection, token, `/git/ref/heads/${encodeURIComponent(connection.branch)}`)).object.sha;
    if (cachedRemote?.connectionKey === key && cachedRemote.remote.head === head)
    {
        upgradeSyncConfig(cachedRemote.remote.snapshot);
        return cachedRemote.remote;
    }
    const rootTree = COMMIT_SCHEMA.parse(await github(connection, token, `/git/commits/${head}`)).tree.sha;
    if (baseline?.head === head)
    {
        upgradeSyncConfig(baseline.snapshot);
        const remote = remoteFromSnapshot(head, rootTree, baseline.snapshot, false);
        cachedRemote = { connectionKey: key, remote };
        return remote;
    }
    const root = TREE_SCHEMA.parse(await github(connection, token, `/git/trees/${rootTree}`));
    if (root.truncated) throw new HalignError("GitHub root tree is truncated; use a smaller dedicated sync repository");
    const source = root.tree.find((entry) => entry.path.toLowerCase() === REMOTE_DIRECTORY);
    if (!source)
    {
        const remote = { head, rootTree, snapshot: emptySyncSnapshot(), blobs: new Set<string>(), empty: true };
        cachedRemote = { connectionKey: key, remote };
        return remote;
    }
    if (source.path !== REMOTE_DIRECTORY || source.type !== "tree" || source.mode !== "040000") throw new HalignError(`${source.path}: expected the Git directory ${REMOTE_DIRECTORY} with exact casing`);
    const tree = TREE_SCHEMA.parse(await github(connection, token, `/git/trees/${source.sha}?recursive=1`));
    if (tree.truncated || tree.tree.length > SYNC_MAX_ENTRIES) throw new HalignError(`GitHub sync tree is truncated or exceeds ${SYNC_MAX_ENTRIES} entries`);
    const snapshot = emptySyncSnapshot();
    const blobs = new Set<string>();
    let total = 0;
    for (const entry of tree.tree)
    {
        if (entry.path !== REMOTE_MANIFEST) assertSyncPath(entry.path, entry.type === "tree");
        if (entry.type === "tree" && entry.mode === "040000") snapshot.directories.push(entry.path);
        else if (entry.type === "blob" && (entry.mode === "100644" || entry.mode === "100755"))
        {
            if (entry.size === undefined || entry.size > SYNC_MAX_FILE_BYTES) throw new HalignError(`GitHub file ${entry.path}: expected a blob of at most 8 MiB`);
            total += entry.size;
            if (total > SYNC_MAX_TOTAL_BYTES) throw new HalignError("GitHub sync source exceeds 32 MiB");
        }
        else throw new HalignError(`GitHub path ${entry.path}: symbolic links, submodules, and unsupported Git modes are not allowed`);
    }
    const manifestEntry = tree.tree.find((entry) => entry.path === REMOTE_MANIFEST && entry.type === "blob");
    if (!manifestEntry) throw new HalignError(`${REMOTE_DIRECTORY}/${REMOTE_MANIFEST}: missing sync format marker; use an empty sync directory or a repository created by Harness Align`);
    const used = await loadBlobs(connection, token, tree.tree.flatMap((entry) => entry.type === "blob" ? [entry.sha] : []));
    blobCache = used;
    for (const entry of tree.tree)
    {
        if (entry.type !== "blob") continue;
        blobs.add(entry.sha);
        const bytes = used.get(entry.sha);
        if (!bytes) throw new HalignError(`GitHub blob ${entry.sha}: missing after fetch`);
        if (entry.path !== REMOTE_MANIFEST) snapshot.files[entry.path] = bytes.toString("base64");
    }
    const marker = used.get(manifestEntry.sha);
    if (!marker) throw new HalignError(`${REMOTE_DIRECTORY}/${REMOTE_MANIFEST}: missing sync format marker; use an empty sync directory or a repository created by Harness Align`);
    const manifest = z.object({ version: z.union([z.literal(1), z.literal(2), z.literal(3)]), directories: z.array(z.string()), stoppedFiles: z.array(z.string()).optional(), files: z.array(z.string()).optional() }).parse(JSON.parse(marker.toString("utf8")));
    if (manifest.version === 1 && manifest.stoppedFiles !== undefined) throw new HalignError("GitHub sync marker: stoppedFiles requires version 2");
    snapshot.directories.push(...manifest.directories);
    const hasHarnessFiles = [...Object.keys(snapshot.files), ...snapshot.directories].some((path) => path === "harness-files" || path.startsWith("harness-files/"));
    const checked = parseSyncSnapshot({ ...snapshot, version: manifest.version === 3 ? 4 : manifest.version === 2 ? 3 : hasHarnessFiles ? 2 : 1,
        ...(manifest.version === 3 ? { filePaths: manifest.files } : {}),
        ...(manifest.stoppedFiles !== undefined ? { stoppedFiles: manifest.stoppedFiles } : {}) });
    if (manifest.version === 3 && (!manifest.files || syncFilePaths(checked).some((path) => !Object.hasOwn(checked.files, path)))) throw new HalignError("GitHub sync marker: each registered file requires content");
    await validateSyncSources(checked, true);
    const remote = { head, rootTree, snapshot: checked, blobs, empty: false };
    cachedRemote = { connectionKey: key, remote };
    return remote;
}

/** Publish a whole source tree as one commit, keeping unrelated repository paths unchanged. */
async function createSyncCommit(connection: SyncConnection, token: string, remote: RemoteSnapshot, snapshot: SyncSnapshot): Promise<RemoteSnapshot>
{
    const files = { ...snapshot.files, [REMOTE_MANIFEST]: manifestBytes(snapshot).toString("base64") };
    const tree: { path: string; mode: string; type: string; sha?: string; content?: string }[] = [];
    const blobs = new Set<string>();
    for (const [path, encoded] of Object.entries(files))
    {
        const bytes = Buffer.from(encoded, "base64");
        const sha = blobHash(bytes);
        blobs.add(sha);
        const entry = { path, mode: "100644", type: "blob" };
        if (remote.blobs.has(sha)) tree.push({ ...entry, sha });
        else
        {
            const text = bytes.toString("utf8");
            if (!text.includes("\0") && Buffer.from(text).equals(bytes)) tree.push({ ...entry, content: text });
            else tree.push({ ...entry, sha: OBJECT_SCHEMA.parse(await github(connection, token, "/git/blobs", "POST", { content: encoded, encoding: "base64" })).sha });
        }
    }
    const sourceTree = OBJECT_SCHEMA.parse(await github(connection, token, "/git/trees", "POST", { tree })).sha;
    const rootTree = OBJECT_SCHEMA.parse(await github(connection, token, "/git/trees", "POST", {
        base_tree: remote.rootTree, tree: [{ path: REMOTE_DIRECTORY, mode: "040000", type: "tree", sha: sourceTree }],
    })).sha;
    const head = OBJECT_SCHEMA.parse(await github(connection, token, "/git/commits", "POST", { message: "Sync Harness Align configuration", tree: rootTree, parents: [remote.head] })).sha;
    return { head, rootTree, snapshot, blobs, empty: false };
}

/** Save a common baseline only after local sources match the accepted snapshot. */
async function finishSync(root: string, directory: string, state: SyncState, before: SyncSnapshot, snapshot: SyncSnapshot, head: string): Promise<void>
{
    const hydrated = await hydrateSyncSkills(snapshot, before);
    await ensureFileSyncCompatibility(root);
    await applySyncSources(root, before, hydrated);
    state.base = { connectionKey: connectionKey(state.connection!), head, snapshot, syncedAt: new Date().toISOString() };
    state.applications = state.pending?.applications ?? [];
    state.pending = null;
    await writeState(directory, state);
}

/** Continue the separately persisted actual-file stage without repeating a successful cloud publication. */
async function applyPendingFiles(root: string, directory: string, state: SyncState): Promise<SyncResult>
{
    if (!state.applications?.length) return { status: publicStatus(state), message: "Configuration synced. Additional files are current on this device; use Setup for generated rules and agents." };
    const applications = state.applications;
    try
    {
        const result = await applyFileSyncTargets(root, state.applications, root);
        const local = await readSyncSnapshot(root);
        if (local.legacyFiles)
        {
            const next = parseSyncSnapshot(local);
            for (const application of applications)
            {
                if (!result.skipped.includes(application.target.key) && next.legacyFiles?.[application.target.key] === application.content) delete next.legacyFiles[application.target.key];
            }
            await applySyncSources(root, local, next);
        }
        state.applications = state.applications.filter((application) => result.skipped.includes(application.target.key));
        await writeState(directory, state);
        const pending = state.applications.length > 0;
        return { status: publicStatus(state), applicationPending: pending,
            message: pending ? `Remote synced. ${result.applied} Local file(s) updated; ${state.applications.length} await an existing harness or parent folder. Review sync after creating the folders.`
                : `Remote synced; ${result.applied} Local file(s) updated.` };
    }
    catch (error)
    {
        state.applications = applications;
        return { status: publicStatus(state), applicationPending: true,
            message: `Remote synced; Local updates are pending. Local edits are preserved. Review or resume sync. ${error instanceof Error ? error.message : String(error)}` };
    }
}

/** Resolve uncertain publication by checking immutable commit ancestry before retrying any upload. */
async function recoverUpload(root: string, directory: string, state: SyncState, token: string, remote: RemoteSnapshot): Promise<string>
{
    const pending = state.pending;
    if (!pending) return "";
    const connection = state.connection!;
    if (pending.connectionKey !== connectionKey(connection)) throw new HalignError("The pending upload belongs to a different repository; reconnect it to recover");
    let published = pending.head === remote.head;
    if (!published && remote.head !== pending.parent)
    {
        const comparison = z.object({ status: z.enum(["ahead", "behind", "identical", "diverged"]) }).parse(await github(connection, token, `/compare/${pending.head}...${remote.head}`));
        published = comparison.status === "ahead" || comparison.status === "identical";
    }
    const local = await readSyncSnapshot(root);
    if (published && remote.empty) throw new HalignError(`${REMOTE_DIRECTORY}: the published archive is missing; restore it before recovering sync`);
    if (published && (syncSnapshotHash(pending.before) === syncSnapshotHash(local)
        || syncSnapshotHash(portableSyncSnapshot(pending.snapshot.version === 4 ? withoutFileContents(pending.snapshot) : pending.snapshot)) === syncSnapshotHash(portableSyncSnapshot(local))))
    {
        await finishSync(root, directory, state, local, pending.snapshot, pending.head);
        return "Recovered an earlier upload. The local workspace was refreshed; review any newer remote changes below.";
    }
    state.pending = null;
    await writeState(directory, state);
    return published
        ? "An earlier upload completed, but local files changed afterward. Review the merge below; local edits were preserved."
        : "The earlier upload is not on the current branch. Review changes before retrying.";
}

/** Read the remote archive shared by interactive preview and the startup check. */
async function readSyncRemote(state: SyncState, token: string): Promise<RemoteSnapshot>
{
    if (!state.connection) throw new HalignError("Remote is not connected");
    const key = connectionKey(state.connection);
    const known = state.base?.connectionKey === key ? state.base : null;
    if (known && cachedRemote?.connectionKey !== key) rememberSnapshotBlobs(known.snapshot);
    await checkRepository(state.connection, token);
    const remote = await readRemote(state.connection, token, known ?? undefined);
    if (known && remote.empty) throw new HalignError(`${REMOTE_DIRECTORY}: the previously synced archive is missing; restore it before syncing`);
    return remote;
}

/** True when the remote config.json bytes are still format 1 and would upload as format 3. */
function remoteConfigNeedsUpgrade(remote: RemoteSnapshot): boolean
{
    return remote.snapshot.files["config.json"] !== upgradeSyncConfig(remote.snapshot).files["config.json"];
}

/** Upgrade legacy removals without confusing content-free declarations with missing files. */
function withFileStops(base: SyncSnapshot, snapshot: SyncSnapshot): SyncSnapshot
{
    let next = withoutFileContents(snapshot);
    const present = new Set([...syncFilePaths(next), ...next.directories].map((key) => key.toLowerCase()));
    for (const key of syncFilePaths(base)) if (!present.has(key.toLowerCase())) next = stopSyncFile(next, key);
    return next;
}

/** Reject unsupported first-use actions before planning any file collection. */
function assertSyncMode(preview: RetainedPreview, mode: SyncApplyInput["mode"]): void
{
    if (preview.remote.empty && (!preview.public.firstSync || mode !== "initialize")) throw new HalignError("The remote archive is not initialized; use Initialize archive explicitly before syncing");
    if (!preview.remote.empty && mode === "initialize") throw new HalignError("The remote archive already exists; initialization cannot replace it");
    if (mode !== "merge" && !preview.public.firstSync) throw new HalignError("Whole-workspace adoption is only available on the first sync");
}

/** Compare the actual file and GitHub against the last accepted baseline, retaining only reviewed recovery bytes. */
async function buildFileSyncPlan(root: string, state: SyncState, retained: RetainedPreview, input: SyncApplyInput): Promise<SyncPreview>
{
    assertSyncMode(retained, input.mode);
    const base = withoutFileContents(portableSyncSnapshot(retained.base));
    let local = withFileStops(base, portableSyncSnapshot(retained.local));
    const remote = withFileStops(base, portableSyncSnapshot(retained.remote.snapshot));
    const fileChoices = input.fileChoices ?? {};
    const identities = Object.keys(fileChoices).map((key) => key.toLowerCase());
    if (new Set(identities).size !== identities.length) throw new HalignError("File choices contain duplicate paths without case sensitivity");
    const known = new Set([...syncFilePaths(local), ...syncFilePaths(remote)].map((key) => key.toLowerCase()));
    for (const [key, choice] of Object.entries(fileChoices))
    {
        if (!known.has(key.toLowerCase())) throw new HalignError(`${key}: file decision is not part of this preview`);
        if (choice === "stop") local = stopSyncFile(local, key);
    }
    const metadataChoices = { ...input.choices };
    for (const [key, choice] of Object.entries(fileChoices)) if (choice === "target" || choice === "remote" || choice === "legacy") metadataChoices[key.toLowerCase()] = choice === "remote" ? "remote" : "local";
    const merged = mergeConfigSnapshots(base, local, remote, metadataChoices);
    let next = upgradeSyncConfig(input.mode === "remote" ? remote : input.mode === "local" || input.mode === "initialize" ? local : merged.snapshot);
    for (const [key, choice] of Object.entries(fileChoices)) if (choice === "stop") next = stopSyncFile(next, key);
    const nextPaths = new Set([...syncFilePaths(next), ...next.directories].map((key) => key.toLowerCase()));
    for (const key of new Set([...syncFilePaths(local), ...syncFilePaths(remote)])) if (!nextPaths.has(key.toLowerCase())) next = stopSyncFile(next, key);
    const config = parseConfigSource(Buffer.from(next.files["config.json"]!, "base64")).config;
    const observationSnapshot = parseSyncSnapshot({ version: 4, files: { "config.json": next.files["config.json"]! }, directories: [],
        filePaths: syncFilePaths(next).filter((key) => config.harnesses.some((harness) => harness.name === key.split("/")[1])) });
    const observations = await inspectFileSyncTargets(root, observationSnapshot, root);
    const fileChanges: SyncFileChange[] = [];
    const applications: FileSyncApplication[] = [];
    const changes = merged.changes.filter((change) => !change.key.startsWith("harness-files/") || change.key.endsWith("/"));
    const candidate = withoutFileContents(retained.local);
    /** Resolve a Windows file identity while retaining the selected spelling. */
    const bytesAt = (snapshot: SyncSnapshot, key: string): string | undefined =>
    {
        const path = Object.keys(snapshot.files).find((path) => path.toLowerCase() === key.toLowerCase());
        return path === undefined ? undefined : snapshot.files[path];
    };
    for (const key of syncFilePaths(next))
    {
        const target = observations.find((item) => item.key === key);
        const incoming = bytesAt(retained.remote.snapshot, key);
        const baseConfig = retained.base.files["config.json"];
        const baseHarness = baseConfig === undefined ? undefined : parseConfigSource(Buffer.from(baseConfig, "base64")).config.harnesses.find((harness) => harness.name === key.split("/")[1]);
        const sameTarget = baseHarness && target?.target === `${baseHarness.configPath}/${key.split("/").slice(2).join("/")}`;
        const previous = sameTarget ? bytesAt(retained.base, key) : undefined;
        const actual = target?.content ?? undefined;
        const pending = state.applications?.find((item) => item.target.key.toLowerCase() === key.toLowerCase() && item.target.target === target?.target);
        const pendingUnchanged = pending && target?.content === pending.target.content && target.state === pending.target.state;
        const legacyKey = Object.keys(retained.local.legacyFiles ?? {}).find((path) => path.toLowerCase() === key.toLowerCase());
        const legacy = legacyKey ? retained.local.legacyFiles![legacyKey] : retained.local.version < 4 ? bytesAt(retained.local, key) : undefined;
        const migration = legacy !== undefined && legacy !== actual && !(pending && pending.content === legacy);
        const choice = Object.entries(fileChoices).find(([path]) => path.toLowerCase() === key.toLowerCase())?.[1];
        const localContent = pendingUnchanged ? pending.content : actual;
        let content: string | undefined;
        let needsChoice = false;
        let localState: FileSyncState = target?.state !== "ready" ? target?.state ?? "unsafe" : "match";
        const registeredHere = syncFilePaths(retained.local).some((path) => path.toLowerCase() === key.toLowerCase());
        if (choice === "target")
        {
            if (actual === undefined) throw new HalignError(`${key}: Local file is unavailable`);
            content = actual;
        }
        else if (choice === "remote")
        {
            if (incoming === undefined) throw new HalignError(`${key}: Remote has no file to restore`);
            content = incoming;
        }
        else if (choice === "legacy")
        {
            if (legacy === undefined) throw new HalignError(`${key}: no legacy change awaits migration`);
            content = legacy;
        }
        else if (migration) needsChoice = true;
        else if (target?.state === "folder-missing" || target?.state === "parent-missing") content = incoming ?? pending?.content ?? previous;
        else if (target?.state === "missing" && registeredHere && !pendingUnchanged) needsChoice = true;
        else if (input.mode === "remote") content = incoming;
        else if (localContent === incoming) content = localContent;
        else if (localContent === undefined) content = incoming;
        else if (incoming === undefined || incoming === previous) content = localContent;
        else if (localContent === previous) content = incoming;
        else needsChoice = true;
        if (merged.conflicts.includes(key.toLowerCase())) needsChoice = true;
        if (migration) localState = "migration";
        else if (target?.state === "ready") localState = needsChoice ? "conflict" : actual === incoming ? "match" : content === actual ? "local-changed" : "remote-changed";
        if (!target || target.state === "unsafe") needsChoice = true;
        if (content === undefined) needsChoice = true;
        if (actual !== undefined) candidate.files[key] = actual;
        if (content !== undefined) next.files[key] = content;
        const unavailable = target?.state === "folder-missing" || target?.state === "parent-missing";
        const upload = content !== incoming;
        const apply = content !== actual;
        const action = needsChoice ? "conflict" : unavailable ? "unavailable" : upload && apply ? "upload-apply" : upload ? "upload" : apply ? "apply" : "unchanged";
        fileChanges.push({ key, target: target ? `~/${target.target}` : key, state: localState, action, needsChoice,
            canUseTarget: actual !== undefined, canUseSource: incoming !== undefined, hasLegacy: migration,
            ...(!target ? { error: `Harness ${key.split("/")[1]} is absent from the selected configuration. Stop syncing this file or resolve the configuration first.` } : target.error ? { error: target.error } : {}) });
        if (target && content !== undefined) applications.push({ target, content });
        if (action !== "unchanged") changes.push({ key: key.toLowerCase(), paths: [key], direction: needsChoice ? "conflict" : upload ? "upload" : "download" });
    }
    for (const key of next.stoppedFiles ?? [])
    {
        if (!known.has(key.toLowerCase())) continue;
        fileChanges.push({ key, target: key, state: "match", action: "stop", needsChoice: false, canUseTarget: false, canUseSource: false, hasLegacy: false });
        changes.push({ key: key.toLowerCase(), paths: [key], direction: remote.stoppedFiles?.some((path) => path.toLowerCase() === key.toLowerCase()) ? "download" : "upload" });
    }
    let planError: string | undefined;
    try { await validateSyncSources(next, true); }
    catch (error) { planError = error instanceof Error ? error.message : String(error); }
    const unresolved = input.mode === "merge" ? merged.conflicts : [];
    const formatUpgrade = !retained.remote.empty && retained.remote.snapshot.version !== 4;
    const preview: SyncPreview = {
        ...retained.public, id: randomUUID(), changes,
        uploadCount: changes.filter((change) => change.direction === "upload" || change.direction === "conflict").length + (formatUpgrade ? 1 : 0) + (remoteConfigNeedsUpgrade(retained.remote) && !changes.some((change) => change.key === "config.json" && (change.direction === "upload" || change.direction === "conflict")) ? 1 : 0),
        downloadCount: changes.filter((change) => change.direction === "download" || change.direction === "conflict").length,
        fileChanges, applyCount: fileChanges.filter((change) => change.action === "apply" || change.action === "upload-apply").length,
        unresolvedCount: unresolved.length + fileChanges.filter((change) => change.needsChoice).length + (planError ? 1 : 0),
        recoveryRequired: state.pending !== null, ...(planError ? { planError } : {}),
    };
    if (!planError) delete preview.planError;
    retained.public = preview;
    retained.plan = { next, candidate, observations, observationSnapshot, applications };
    return preview;
}

/** Read immutable remote/source evidence without recovering an earlier write or upgrading source files. */
async function prepareSyncReview(root: string, directory: string, token: string): Promise<{ state: SyncState; retained: RetainedPreview }>
{
    await assertWorkspaceRecovered(root);
    const state = await readState(directory);
    if (!state.connection) throw new HalignError("Remote is not connected");
    const remote = await readSyncRemote(state, token);
    const local = await readSyncSnapshot(root);
    const base = state.base?.connectionKey === connectionKey(state.connection) ? state.base : null;
    const notice = [state.pending ? "An earlier confirmed sync needs recovery. Resume it before starting another sync." : "",
        state.applications?.length ? "Remote is synced. Local updates are pending; later edits are preserved." : "",
        remoteConfigNeedsUpgrade(remote) ? "The remote configuration uses format 1. Confirming sync upgrades it to format 3." : "",
        !remote.empty && remote.snapshot.version !== 4 ? "This sync upgrades the Remote archive. Update other devices before syncing them." : ""].filter(Boolean).join("\n");
    const retained: RetainedPreview = {
        public: { id: randomUUID(), head: remote.head, firstSync: base === null, remoteEmpty: remote.empty, uploadCount: 0, downloadCount: 0,
            changes: [], notice, fileChanges: [], applyCount: 0, unresolvedCount: 0, recoveryRequired: state.pending !== null },
        connectionKey: connectionKey(state.connection), baseHead: base?.head ?? null, local, remote, base: base?.snapshot ?? emptySyncSnapshot(),
    };
    await buildFileSyncPlan(root, state, retained, { previewId: retained.public.id, mode: remote.empty ? "initialize" : "merge", choices: {} });
    return { state, retained };
}

/** Compare actual files and cloud state without writing or retaining an applicable preview. */
export async function checkSync(root: string, directory: string, token: string): Promise<SyncCheckResult>
{
    if (!(await readState(directory)).connection) return { pending: false };
    const { state, retained } = await prepareSyncReview(root, directory, token);
    return { pending: syncPreviewHasWork(retained.public, state.pending !== null || (state.applications?.length ?? 0) > 0) };
}

/** Prepare a new read-only plan whose file effects are shown before any collection or application. */
export async function previewSync(root: string, directory: string, token: string): Promise<SyncPreview>
{
    retainedPreview = undefined;
    const { retained } = await prepareSyncReview(root, directory, token);
    retainedPreview = retained;
    return retained.public;
}

/** Replan from retained remote/source evidence; changing any choice invalidates the prior plan id. */
export async function planSync(root: string, directory: string, input: SyncApplyInput): Promise<SyncPreview>
{
    const retained = requirePreview(input.previewId);
    const { state } = await readPreviewSources(root, directory, retained);
    return buildFileSyncPlan(root, state, retained, input);
}

/** Explicitly resume an already confirmed upload or local application, preserving later external edits. */
export async function resumeSync(root: string, directory: string, token: string): Promise<SyncResult>
{
    retainedPreview = undefined;
    const state = await readState(directory);
    if (!state.connection) throw new HalignError("Remote is not connected");
    let notice = "";
    if (state.pending) notice = await recoverUpload(root, directory, state, token, await readSyncRemote(state, token));
    const result = await applyPendingFiles(root, directory, state);
    return { ...result, message: [notice, result.message].filter(Boolean).join("\n") };
}

/** Compare upgraded copies while keeping remote version-only writes visible in the existing review. */
function mergeConfigSnapshots(base: SyncSnapshot, local: SyncSnapshot, remote: SyncSnapshot, choices: Record<string, "local" | "remote"> = {}): SyncMerge
{
    const upgradedRemote = upgradeSyncConfig(remote);
    const merged = mergeSyncSnapshots(upgradeSyncConfig(base), upgradeSyncConfig(local), upgradedRemote, choices);
    if (remote.files["config.json"] !== upgradedRemote.files["config.json"])
    {
        const change = merged.changes.find((entry) => entry.key === "config.json");
        if (!change) merged.changes.unshift({ key: "config.json", paths: ["config.json"], direction: "upload" });
        else if (change.direction === "same") change.direction = "upload";
    }
    return merged;
}

/** Require a current server-owned preview instead of trusting renderer file content. */
function requirePreview(id: string): RetainedPreview
{
    if (!retainedPreview || retainedPreview.public.id !== id) throw new HalignError("The sync preview expired; preview again");
    return retainedPreview;
}

/** Build a bounded text view while retaining size and hash for binary or large content. */
function fileView(encoded: string | undefined): SyncFileView | null
{
    if (encoded === undefined) return null;
    const bytes = Buffer.from(encoded, "base64");
    const text = bytes.toString("utf8");
    const isText = !text.includes("\0") && Buffer.from(text).equals(bytes);
    return { bytes: bytes.length, hash: blobHash(bytes), text: isText ? text.slice(0, 16_000) : null, truncated: isText && text.length > 16_000 };
}

/** Inspect retained versions without exposing filesystem access to the renderer. */
export function inspectSync(previewId: string, key: string): SyncDetail
{
    const preview = requirePreview(previewId);
    const change = preview.public.changes.find((item) => item.key === key);
    const file = preview.public.fileChanges.find((item) => item.key === key);
    if (!change && !file) throw new HalignError("Sync change is not part of this preview");
    const paths = change?.paths.slice() ?? [key];
    if (key.startsWith("skills/") && !paths.includes("skills/index.json")) paths.push("skills/index.json");
    return {
        files: paths.slice(0, 20).map((path) => ({ path, local: fileView(preview.plan?.candidate.files[path] ?? preview.local.files[path]), remote: fileView(preview.remote.snapshot.files[path]),
            ...(path.startsWith("harness-files/") ? { actual: fileView(preview.plan?.observations.find((target) => target.key === path)?.content ?? undefined),
                saved: fileView(preview.local.legacyFiles?.[path] ?? (preview.local.version < 4 ? preview.local.files[path] : undefined)), result: fileView(preview.plan?.next.files[path]) } : {}) })),
        omittedFiles: Math.max(0, paths.length - 20),
    };
}

/** Recheck the connection, baseline, recovery state, and local bytes before any preview-based write. */
async function readPreviewSources(root: string, directory: string, preview: RetainedPreview): Promise<{ state: SyncState; connection: SyncConnection; local: SyncSnapshot }>
{
    await assertWorkspaceRecovered(root);
    const state = await readState(directory);
    if (!state.connection || connectionKey(state.connection) !== preview.connectionKey || (state.base?.connectionKey === preview.connectionKey ? state.base.head : null) !== preview.baseHead)
    {
        throw new HalignError("The sync connection or baseline changed; preview again");
    }
    if (state.pending) throw new HalignError("An upload needs recovery; preview again before syncing");
    const local = await readSyncSnapshot(root);
    if (syncSnapshotHash(local) !== syncSnapshotHash(preview.local)) throw new HalignError("Local sources changed after preview; preview again");
    return { state, connection: state.connection, local };
}

/** Restore one reviewed remote source locally without publishing or advancing the common baseline. */
export async function discardSync(root: string, directory: string, token: string, input: SyncDiscardInput): Promise<SyncResult>
{
    const preview = requirePreview(input.previewId);
    if (preview.remote.empty) throw new HalignError("The remote archive is not initialized; local restoration is unavailable");
    if (input.key.startsWith("harness-files/")) throw new HalignError("Additional files must be resolved in the sync plan so Local and Remote are reviewed together");
    const change = preview.public.changes.find((entry) => entry.key === input.key);
    if (!change || !["upload", "conflict"].includes(change.direction)) throw new HalignError(`sync change ${input.key}: expected a preview entry with local changes`);
    if (change.key.endsWith("/") && change.paths.length === 0) throw new HalignError(`sync change ${input.key}: discard individual files instead of a directory entry`);
    const { state, connection, local } = await readPreviewSources(root, directory, preview);
    const next = upgradeSyncConfig(restoreSyncChange(portableSyncSnapshot(preview.base), portableSyncSnapshot(local), portableSyncSnapshot(preview.remote.snapshot), input.key));
    if (local.legacyFiles) next.legacyFiles = { ...local.legacyFiles };
    await validateSyncSources(next, true);
    await checkRepository(connection, token);
    const head = REFERENCE_SCHEMA.parse(await github(connection, token, `/git/ref/heads/${encodeURIComponent(connection.branch)}`)).object.sha;
    if (head !== preview.remote.head) throw new HalignError("The remote branch changed after preview; preview again");
    await applySyncSources(root, local, await hydrateSyncSkills(next, local));
    retainedPreview = undefined;
    return { status: publicStatus(state), message: `${input.key}: restored to the remote version. Other local changes were kept; a local backup is available.` };
}

/** Apply reviewed decisions only while both local sources and the remote head still match the preview. */
export async function applySync(root: string, directory: string, token: string, input: { previewId: string }): Promise<SyncResult>
{
    const preview = requirePreview(input.previewId);
    const { state, connection, local } = await readPreviewSources(root, directory, preview);
    const plan = preview.plan;
    if (!plan || preview.public.unresolvedCount) throw new HalignError(`Resolve sync conflicts before applying: ${preview.public.planError ?? "choose versions for the highlighted files"}`);
    const next = plan.next;
    const actual = await inspectFileSyncTargets(root, plan.observationSnapshot, root);
    if (JSON.stringify(actual) !== JSON.stringify(plan.observations)) throw new HalignError("Local files or alignment baselines changed after preview; preview again");
    await validateSyncSources(next, true);
    await checkRepository(connection, token);
    const currentHead = REFERENCE_SCHEMA.parse(await github(connection, token, `/git/ref/heads/${encodeURIComponent(connection.branch)}`)).object.sha;
    if (currentHead !== preview.remote.head) throw new HalignError("The remote branch changed after preview; preview again");
    const needsUpload = preview.remote.empty || preview.remote.snapshot.version !== 4 || syncSnapshotHash(next) !== syncSnapshotHash(preview.remote.snapshot);
    const uploaded = needsUpload ? await createSyncCommit(connection, token, preview.remote, next) : preview.remote;
    if (syncSnapshotHash(await readSyncSnapshot(root)) !== syncSnapshotHash(local)
        || JSON.stringify(await inspectFileSyncTargets(root, plan.observationSnapshot, root)) !== JSON.stringify(plan.observations))
    {
        throw new HalignError("Local sources or files changed while preparing the upload; preview again before publishing");
    }
    await assertWorkspaceRecovered(root);
    // A receipt covers publication and a crash between local adoption and saving the baseline.
    state.pending = { connectionKey: preview.connectionKey, head: uploaded.head, parent: currentHead, before: local, snapshot: next, applications: plan.applications };
    await writeState(directory, state);
    if (needsUpload)
    {
        // Never force: concurrent uploads must be re-read and reviewed against a new baseline.
        await github(connection, token, `/git/refs/heads/${encodeURIComponent(connection.branch)}`, "PATCH", { sha: uploaded.head, force: false });
    }
    await finishSync(root, directory, state, local, next, uploaded.head);
    rememberSnapshotBlobs(next);
    cachedRemote = { connectionKey: preview.connectionKey, remote: uploaded };
    retainedPreview = undefined;
    return applyPendingFiles(root, directory, state);
}
