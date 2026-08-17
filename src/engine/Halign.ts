#!/usr/bin/env node

/**
 * ESM CLI boundary for `halign`.
 * Terminal I/O stays in `main()`. The same module re-exports engine APIs for tests. Resolve `argv[1]` with `realpathSync` so a global bin link still runs `main()`.
 */

import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { check, generate, reportGenerate } from "./Generate.js";
import { errorText, HalignError } from "./Model.js";
import { reportSetup, setup } from "./Setup.js";

export type { Agent, AgentFormat, Config, Harness, HarnessConfig, OutputMap, Rule } from "./Model.js";
export type { SetupResult, SetupTargetReport } from "./Setup.js";
export type { RuleInput, SharedRule, Workspace } from "./Edit.js";
export { HalignError } from "./Model.js";
export { atomicWrite } from "./FsSafe.js";
export { loadConfig, loadSharedRules, validateConfig } from "./Load.js";
export { addHarness, addProfile, deleteSource, loadWorkspace, removeHarness, removeProfile, renameHarness, saveAgent, saveConfig, saveRule, saveSharedRule } from "./Edit.js";
export { downgradeMarkdownHeadings, renderMarkdownToc } from "./Render.js";
export { buildOutputs, check, generate, reportGenerate, safeOutputRelative } from "./Generate.js";
export { reportSetup, setup } from "./Setup.js";

/** Write usage to stderr and return the invalid-argument exit code. */
function usage(error?: string): number
{
    if (error) process.stderr.write(`error: ${error}\n`);
    process.stderr.write("usage: halign <generate|check|setup> [--profile <profile>]\n");
    return 2;
}

/** CLI entry used by the `halign` binary and by tests. */
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
            process.stdout.write(reportGenerate(join(resolve(root), ".halign", "generated"), outputs));
            return 0;
        }
        if (command === "setup")
        {
            process.stdout.write(reportSetup(await setup(root, profile)));
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

// Compare real paths so a directory junction from `pnpm link --global` still executes `main()`.
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
