#!/usr/bin/env node

/*
阅读路线 (按数据流, 不是按文件名字母序):

1. `model.ts` — 领域类型, `unknown` 收窄 helper, `HalignError`
2. `fs-safe.ts` — 路径 containment, reparse 拒绝, UTF-8 读, 原子写入
3. `load.ts` — 配置 / Rule / Agent 发现与验证
4. `render.ts` — Markdown 标题降级, TOC, 可配置 Harness renderer
5. `generate.ts` — `buildOutputs`, manifest, `generate`, `check`
6. `setup.ts` — 部署到已存在的用户 Harness 根目录
7. 本文件 — ESM CLI 边界; 同时 re-export 公开 API 供测试导入

面向 C++/C# 开发者的 TypeScript 心智模型:

- TypeScript 的 `interface`, type alias, union 和泛型只服务于编译期. `tsc` 会擦除它们, Node 实际执行的是 JavaScript.
- 本项目是 ESM. `import`/`export` 在模块加载时工作, `import.meta.url` 是当前模块 URL.
- TypeScript 采用结构类型. 信任边界不能把未验证对象直接断言成领域类型.
*/

import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { check, generate } from "./generate.js";
import { errorText, HalignError } from "./model.js";
import { setup } from "./setup.js";

export type { AgentFormat, Config, Harness, HarnessConfig, OutputMap } from "./model.js";
export { HalignError } from "./model.js";
export { atomicWrite } from "./fs-safe.js";
export { loadConfig, validateConfig } from "./load.js";
export { downgradeMarkdownHeadings, renderMarkdownToc } from "./render.js";
export { buildOutputs, check, generate, safeOutputRelative } from "./generate.js";
export { setup } from "./setup.js";

function usage(error?: string): number
{
    if (error) process.stderr.write(`error: ${error}\n`);
    process.stderr.write("usage: halign <generate|check|setup> [--profile <profile>]\n");
    return 2;
}

export async function main(argv: string[], root = process.cwd()): Promise<number>
{
    if (argv.length === 1 && ["--help", "-h"].includes(argv[0]!))
    {
        process.stdout.write("usage: halign <generate|check|setup> [--profile <profile>]\n");
        return 0;
    }
    const command = argv[0];
    if (command !== "generate" && command !== "check" && command !== "setup") return usage("command must be generate, check, or setup");
    let profile: string | undefined;
    for (let index = 1; index < argv.length; index += 1)
    {
        const argument = argv[index]!;
        if (argument === "--profile")
        {
            profile = argv[index + 1];
            if (profile === undefined) return usage("--profile requires a value");
            index += 1;
        }
        else if (argument.startsWith("--profile="))
        {
            profile = argument.slice("--profile=".length);
        }
        else
        {
            return usage(`unknown argument ${argument}`);
        }
    }
    try
    {
        if (command === "generate")
        {
            const outputs = await generate(root, profile);
            const managedFileCount = [...outputs.keys()].filter((path) => path !== ".manifest.json").length;
            process.stdout.write(`Generation complete. ${managedFileCount} managed files are up to date.\n`);
            return 0;
        }
        if (command === "setup")
        {
            await setup(root, profile);
            process.stdout.write("Setup complete. Generated files and enabled harness installations are up to date.\n");
            return 0;
        }
        const differences = await check(root, profile);
        if (differences.length > 0)
        {
            process.stdout.write(`Check failed:\n${differences.join("\n")}\n`);
            return 1;
        }
        process.stdout.write("Check passed. Generated output is up to date.\n");
        return 0;
    }
    catch (error)
    {
        if (error instanceof HalignError)
        {
            process.stderr.write(`error: ${error.message}\n`);
            return 1;
        }
        throw error;
    }
}

// ESM 没有 CommonJS 的 `require.main === module`. `npm link` 会让 `argv[1]` 经过目录联接,
// 因此先用 `realpathSync()` 消除联接, 再比较 file URL.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href)
{
    main(process.argv.slice(2)).then((code) =>
    {
        process.exitCode = code;
    }).catch((error: unknown) =>
    {
        process.stderr.write(`${errorText(error)}\n`);
        process.exitCode = 1;
    });
}
