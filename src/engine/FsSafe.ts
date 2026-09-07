/**
 * Path containment and reparse-point guards for source, generated, and deploy writes.
 * Do not use `path.startsWith(root)`; check `relative()` for `..` and absolute results, and `lstat` the link itself.
 */

import { randomUUID } from "node:crypto";
import { promises as fs, type Stats } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { errorText, HalignError, valueText } from "./Model.js";

/** Return whether a thrown value looks like a Node errno exception. */
function isErrnoException(error: unknown): error is NodeJS.ErrnoException
{
    return typeof error === "object" && error !== null && "code" in error;
}

/** Return a project-relative display path, or the original path if it escapes the root. */
export function display(root: string, path: string): string
{
    const pathRelative = relative(root, path);
    return pathRelative && !pathRelative.startsWith(`..${sep}`) && pathRelative !== ".." && !isAbsolute(pathRelative)
        ? pathRelative.split(sep).join("/")
        : path;
}

/** Resolve `%USERPROFILE%` and require an absolute path. */
export function resolveUserHome(userProfile = process.env.USERPROFILE): string
{
    if (!userProfile || !isAbsolute(userProfile)) throw new HalignError(`USERPROFILE must be an absolute path, got ${valueText(userProfile)}`);
    return resolve(userProfile);
}

/** Throw if `path` is outside `root`. */
export function assertContained(root: string, path: string, label: string): void
{
    const pathRelative = relative(root, path);
    if (pathRelative === ".." || pathRelative.startsWith(`..${sep}`) || isAbsolute(pathRelative))
    {
        throw new HalignError(`${label}: path ${valueText(path)} must stay inside ${valueText(root)}, got relative ${valueText(pathRelative)}`);
    }
}

/** Compare resolved paths using the platform's default filesystem casing rules. */
export function pathKey(path: string): string
{
    const full = resolve(path);
    return process.platform === "win32" ? full.toLowerCase() : full;
}

/** `lstat` a path, returning `undefined` when it does not exist. */
export async function lstatIfExists(path: string): Promise<Stats | undefined>
{
    try
    {
        return await fs.lstat(path);
    }
    catch (error)
    {
        if (isErrnoException(error) && error.code === "ENOENT") return undefined;
        throw error;
    }
}

/** Build the domain error used when a symlink or junction is found. */
export function reparseError(root: string, path: string, isOutput: boolean): HalignError
{
    return new HalignError(
        `${display(root, path)}: symbolic link ${isOutput ? "outputs" : "sources"} are not allowed`,
    );
}

/** Recursively reject reparse points under `path`. */
export async function assertNoReparseTree(root: string, path: string, isOutput = false): Promise<void>
{
    const stats = await lstatIfExists(path);
    if (!stats) return;
    if (stats.isSymbolicLink()) throw reparseError(root, path, isOutput);
    if (!stats.isDirectory()) return;
    for (const entry of await fs.readdir(path, { withFileTypes: true }))
    {
        await assertNoReparseTree(root, join(path, entry.name), isOutput);
    }
}

/** Walk every prefix of `path` and reject reparse points. */
export async function ensureRegularSource(root: string, path: string): Promise<void>
{
    assertContained(root, path, path);
    const pathRelative = relative(root, path);
    let current = root;
    const rootStats = await lstatIfExists(current);
    if (rootStats?.isSymbolicLink()) throw reparseError(root, current, false);
    for (const part of pathRelative.split(sep).filter(Boolean))
    {
        current = join(current, part);
        const stats = await lstatIfExists(current);
        if (!stats) return;
        if (stats.isSymbolicLink()) throw reparseError(root, current, false);
    }
}

/** Read a UTF-8 file with a fatal decoder so invalid bytes become domain errors. */
export async function readUtf8(root: string, path: string, context = display(root, path)): Promise<string>
{
    try
    {
        return new TextDecoder("utf-8", { fatal: true }).decode(await fs.readFile(path));
    }
    catch (error)
    {
        throw new HalignError(`${context}: expected UTF-8 text, got ${errorText(error)}`);
    }
}

/** Write `content` through a same-directory temporary file, skipping the write when bytes are unchanged. */
export async function atomicWrite(
    path: string,
    content: Buffer,
    replace: (oldPath: string, newPath: string) => Promise<void> = fs.rename,
): Promise<void>
{
    const existing = await lstatIfExists(path);
    if (existing?.isFile() && (await fs.readFile(path)).equals(content)) return;
    const parent = dirname(path);
    await fs.mkdir(parent, { recursive: true });
    const temporary = join(parent, `.harness-align-${randomUUID()}.tmp`);
    try
    {
        const handle = await fs.open(temporary, "wx", 0o600);
        try
        {
            await handle.writeFile(content);
        }
        finally
        {
            await handle.close();
        }
        await replace(temporary, path);
    }
    finally
    {
        await fs.unlink(temporary).catch((error: unknown) =>
        {
            if (!isErrnoException(error) || error.code !== "ENOENT") throw error;
        });
    }
}
