/*
路径与文件系统安全边界:

- 路径安全不能用 `path.startsWith(root)`. `relative()` 之后检查 `..` 和绝对结果.
- `lstat` 读取链接本身. Windows junction/reparse point 和 symbolic link 都必须在访问前看到这一层.
*/

import { randomUUID } from "node:crypto";
import { promises as fs, type Stats } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { errorText, HalignError } from "./model.js";

export function display(root: string, path: string): string
{
    const pathRelative = relative(root, path);
    return pathRelative && !pathRelative.startsWith(`..${sep}`) && pathRelative !== ".." && !isAbsolute(pathRelative)
        ? pathRelative.split(sep).join("/")
        : path;
}

export function assertContained(root: string, path: string, label: string): void
{
    const pathRelative = relative(root, path);
    if (pathRelative === ".." || pathRelative.startsWith(`..${sep}`) || isAbsolute(pathRelative))
    {
        throw new HalignError(`${label}: path must stay inside the project root`);
    }
}

// 只有 ENOENT 被建模为 `undefined`. 其他 I/O 错误继续 rejected.
export async function lstatIfExists(path: string): Promise<Stats | undefined>
{
    try
    {
        return await fs.lstat(path);
    }
    catch (error)
    {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
    }
}

export function reparseError(root: string, path: string, output: boolean): HalignError
{
    return new HalignError(
        `${display(root, path)}: symbolic link ${output ? "outputs" : "sources"} are not allowed`,
    );
}

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

export async function readUtf8(root: string, path: string, context = display(root, path)): Promise<string>
{
    try
    {
        // 普通 utf8 解码会替换坏字节. 生成输入必须用 fatal decoder 拒绝它们.
        return new TextDecoder("utf-8", { fatal: true }).decode(await fs.readFile(path));
    }
    catch (error)
    {
        throw new HalignError(`${context}: expected UTF-8 text, got ${errorText(error)}`);
    }
}

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
    const temporary = join(parent, `.halign-${randomUUID()}.tmp`);
    try
    {
        // 临时文件必须和目标位于同一目录, 才能让 rename 保持单文件 replace 语义.
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
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        });
    }
}
