/**
 * Manual GitHub snapshot sync for Main, using GitHub's Git Data API rather than a local Git clone.
 * Electron credential encryption stays at the IPC boundary so this service can be tested without Electron.
 * Preview diffs against the persisted baseline and content-addressed blobs; it does not re-download an unchanged commit.
 */

import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { applySyncSources, validateSyncSources } from "../../engine/Edit.js";
import { atomicWrite, ensureRegularSource, lstatIfExists } from "../../engine/FsSafe.js";
import { HalignError } from "../../engine/Model.js";
import {
    assertSyncPath, emptySyncSnapshot, mergeSyncSnapshots, parseSyncSnapshot, readSyncSnapshot, restoreSyncChange, syncSnapshotHash,
    SYNC_MAX_ENTRIES, SYNC_MAX_FILE_BYTES, SYNC_MAX_TOTAL_BYTES, type SyncSnapshot,
} from "../../engine/Sync.js";
import type { SyncApplyInput, SyncConnectionInput, SyncDetail, SyncDiscardInput, SyncFileView, SyncPreview, SyncResult, SyncStatus } from "../../shared/models/Sync.js";
import { fetchRemote, readResponseBytes } from "./RemoteFetch.js";

/** Stored connection includes only an OS-encrypted token. */
interface SyncConnection extends Omit<SyncConnectionInput, "token">
{
    encryptedToken: string;
}

/** Persisted baseline and in-flight upload survive network failures and process exits. */
interface SyncState
{
    version: 1;
    connection: SyncConnection | null;
    base: { connectionKey: string; head: string; snapshot: SyncSnapshot; syncedAt: string } | null;
    pending: { connectionKey: string; head: string; parent: string; before: SyncSnapshot; snapshot: SyncSnapshot } | null;
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
const STATE_SCHEMA = z.object({
    version: z.literal(1),
    connection: CONNECTION_SCHEMA.nullable(),
    base: z.object({ connectionKey: z.string(), head: SHA_SCHEMA, snapshot: SNAPSHOT_SCHEMA, syncedAt: z.string() }).nullable(),
    pending: z.object({ connectionKey: z.string(), head: SHA_SCHEMA, parent: SHA_SCHEMA, before: SNAPSHOT_SCHEMA, snapshot: SNAPSHOT_SCHEMA }).nullable(),
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
    return Buffer.from(`${JSON.stringify({ version: 1, directories: snapshot.directories }, null, 2)}\n`);
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
    if (!stats) return { version: 1, connection: null, base: null, pending: null };
    if (!stats.isFile() || stats.size > 160 * 1024 * 1024) throw new HalignError(`${path}: expected a sync state file of at most 160 MiB`);
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
    await atomicWrite(await statePath(directory), Buffer.from(`${JSON.stringify(state)}\n`));
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
    };
}

/** Read local connection status without contacting GitHub. */
export async function getSyncStatus(directory: string): Promise<SyncStatus>
{
    return publicStatus(await readState(directory));
}

/** Read encrypted credentials only for Main's OS credential boundary. */
export async function getSyncEncryptedToken(directory: string): Promise<string>
{
    const connection = (await readState(directory)).connection;
    if (!connection) throw new HalignError("GitHub Sync is not connected");
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
            const hint = response.status === 401 ? "renew the token"
                : response.status === 403 || response.status === 429 ? "check Contents read/write permission, repository policy, and API rate limits; retry later"
                    : response.status === 404 ? "check the selected private repository, initialized branch, and token access"
                        : response.status === 409 || response.status === 422 ? "the branch changed or repository rules rejected the commit; preview again"
                            : "retry when GitHub is available";
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
    if (cachedRemote?.connectionKey === key && cachedRemote.remote.head === head) return cachedRemote.remote;
    const rootTree = COMMIT_SCHEMA.parse(await github(connection, token, `/git/commits/${head}`)).tree.sha;
    if (baseline?.head === head)
    {
        const remote = remoteFromSnapshot(head, rootTree, baseline.snapshot, false);
        cachedRemote = { connectionKey: key, remote };
        return remote;
    }
    const root = TREE_SCHEMA.parse(await github(connection, token, `/git/trees/${rootTree}`));
    if (root.truncated) throw new HalignError("GitHub root tree is truncated; use a smaller dedicated sync repository");
    const source = root.tree.find((entry) => entry.path === REMOTE_DIRECTORY);
    if (!source)
    {
        const remote = { head, rootTree, snapshot: emptySyncSnapshot(), blobs: new Set<string>(), empty: true };
        cachedRemote = { connectionKey: key, remote };
        return remote;
    }
    if (source.type !== "tree" || source.mode !== "040000") throw new HalignError(`${REMOTE_DIRECTORY}: expected a Git directory`);
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
    const manifest = z.object({ version: z.literal(1), directories: z.array(z.string()) }).parse(JSON.parse(marker.toString("utf8")));
    snapshot.directories.push(...manifest.directories);
    const checked = parseSyncSnapshot(snapshot);
    await validateSyncSources(checked);
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
    await applySyncSources(root, before, snapshot);
    state.base = { connectionKey: connectionKey(state.connection!), head, snapshot, syncedAt: new Date().toISOString() };
    state.pending = null;
    await writeState(directory, state);
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
    if (published && [syncSnapshotHash(pending.before), syncSnapshotHash(pending.snapshot)].includes(syncSnapshotHash(local)))
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

/** Prepare a fresh preview without publishing changes or overwriting unresolved local edits. */
export async function previewSync(root: string, directory: string, token: string): Promise<SyncPreview>
{
    retainedPreview = undefined;
    const state = await readState(directory);
    if (!state.connection) throw new HalignError("GitHub Sync is not connected");
    const key = connectionKey(state.connection);
    const known = state.base?.connectionKey === key ? state.base : null;
    if (known && cachedRemote?.connectionKey !== key) rememberSnapshotBlobs(known.snapshot);
    await checkRepository(state.connection, token);
    const remote = await readRemote(state.connection, token, known ?? undefined);
    const notice = await recoverUpload(root, directory, state, token, remote);
    const local = await readSyncSnapshot(root);
    const base = state.base?.connectionKey === key ? state.base : null;
    const merged = mergeSyncSnapshots(base?.snapshot ?? emptySyncSnapshot(), local, remote.snapshot);
    const preview: SyncPreview = {
        id: randomUUID(), head: remote.head, firstSync: base === null, remoteEmpty: remote.empty,
        uploadCount: merged.changes.filter((change) => change.direction === "upload" || change.direction === "conflict").length,
        downloadCount: merged.changes.filter((change) => change.direction === "download" || change.direction === "conflict").length,
        changes: merged.changes, notice,
    };
    retainedPreview = { public: preview, connectionKey: key, baseHead: base?.head ?? null, local, remote, base: base?.snapshot ?? emptySyncSnapshot() };
    return preview;
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
    if (!change) throw new HalignError("Sync change is not part of this preview");
    const paths = change.paths.slice();
    if (key.startsWith("skills/") && !paths.includes("skills/index.json")) paths.push("skills/index.json");
    return {
        files: paths.slice(0, 20).map((path) => ({ path, local: fileView(preview.local.files[path]), remote: fileView(preview.remote.snapshot.files[path]) })),
        omittedFiles: Math.max(0, paths.length - 20),
    };
}

/** Recheck the connection, baseline, recovery state, and local bytes before any preview-based write. */
async function readPreviewSources(root: string, directory: string, preview: RetainedPreview): Promise<{ state: SyncState; connection: SyncConnection; local: SyncSnapshot }>
{
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
    const change = preview.public.changes.find((entry) => entry.key === input.key);
    if (!change || !["upload", "conflict"].includes(change.direction)) throw new HalignError(`sync change ${input.key}: expected a preview entry with local changes`);
    if (change.key.endsWith("/") && change.paths.length === 0) throw new HalignError(`sync change ${input.key}: discard individual files instead of a directory entry`);
    const { state, connection, local } = await readPreviewSources(root, directory, preview);
    const next = restoreSyncChange(preview.base, local, preview.remote.snapshot, input.key);
    await validateSyncSources(next);
    await checkRepository(connection, token);
    const head = REFERENCE_SCHEMA.parse(await github(connection, token, `/git/ref/heads/${encodeURIComponent(connection.branch)}`)).object.sha;
    if (head !== preview.remote.head) throw new HalignError("The remote branch changed after preview; preview again");
    await applySyncSources(root, local, next);
    retainedPreview = undefined;
    return { status: publicStatus(state), message: `${input.key}: restored to the remote version. Other local changes were kept; a local backup is available.` };
}

/** Apply reviewed decisions only while both local sources and the remote head still match the preview. */
export async function applySync(root: string, directory: string, token: string, input: SyncApplyInput): Promise<SyncResult>
{
    const preview = requirePreview(input.previewId);
    const { state, connection, local } = await readPreviewSources(root, directory, preview);
    if (input.mode !== "merge" && !preview.public.firstSync) throw new HalignError("Whole-workspace adoption is only available on the first sync");
    if (input.mode === "remote" && preview.remote.empty) throw new HalignError("The remote has no Harness Align configuration to adopt");
    const merged = mergeSyncSnapshots(preview.base, local, preview.remote.snapshot, input.choices);
    if (input.mode === "merge" && merged.conflicts.length) throw new HalignError(`Resolve sync conflicts: ${merged.conflicts.join(", ")}`);
    const next = input.mode === "local" ? local : input.mode === "remote" ? preview.remote.snapshot : merged.snapshot;
    await validateSyncSources(next);
    await checkRepository(connection, token);
    const currentHead = REFERENCE_SCHEMA.parse(await github(connection, token, `/git/ref/heads/${encodeURIComponent(connection.branch)}`)).object.sha;
    if (currentHead !== preview.remote.head) throw new HalignError("The remote branch changed after preview; preview again");
    const needsUpload = preview.remote.empty || syncSnapshotHash(next) !== syncSnapshotHash(preview.remote.snapshot);
    const uploaded = needsUpload ? await createSyncCommit(connection, token, preview.remote, next) : preview.remote;
    // A receipt covers publication and a crash between local adoption and saving the baseline.
    state.pending = { connectionKey: preview.connectionKey, head: uploaded.head, parent: currentHead, before: local, snapshot: next };
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
    return { status: publicStatus(state), message: "Configuration synced. Run Setup when you are ready to deploy it on this device." };
}
