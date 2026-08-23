#!/usr/bin/env node

/**
 * ESM CLI boundary for `halign`.
 * Terminal I/O stays in `main()`. The same module re-exports engine APIs for tests. Resolve `argv[1]` with `realpathSync` so a global bin link still runs `main()`.
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ensureUserWorkspace } from "./Edit.js";
import { check, generate, reportGenerate } from "./Generate.js";
import { loadConfig } from "./Load.js";
import { errorText, HalignError, type LayerSelection } from "./Model.js";
import { reportSetup, setup } from "./Setup.js";

export type { Agent, AgentFormat, Config, Harness, HarnessConfig, LayerConfig, LayerOption, LayerSelection, OutputMap, ProjectSkill, Rule, SkillOrigin, SkillSource, UserSkill } from "./Model.js";
export type { SetupResult, SetupSkillsReport, SetupTargetReport } from "./Setup.js";
export type { LayerOptionInput, RuleInput, SharedRule, Workspace } from "./Edit.js";
export { HalignError } from "./Model.js";
export { atomicWrite, resolveUserHome } from "./FsSafe.js";
export { loadConfig, loadLayerOptions, loadSharedRules, validateConfig } from "./Load.js";
export {
    addHarness, addLayer, addLayerOption, addSkillSource, deleteSource, ensureUserWorkspace, importUserSkills, listUserSkills, loadWorkspace,
    removeHarness, removeLayer, removeLayerOption, removeSkill, removeSkillSource, renameHarness, renameLayer, renameLayerOption, renameSource, saveAgent,
    saveConfig, saveLayerOption, saveRule, saveSharedRule, updateHarness,
} from "./Edit.js";
export { assertSafeZipEntry, hashSkillDirectory, installSkillFromDirectory, loadSkills, parseGitHubSkillSource, readSkillFrontmatter } from "./Skills.js";
export { downgradeMarkdownHeadings, renderMarkdownToc } from "./Render.js";
export { buildOutputs, check, generate, reportGenerate, safeOutputRelative } from "./Generate.js";
export { reportSetup, setup } from "./Setup.js";

/** CLI usage text written for `--help` and invalid arguments. */
const USAGE = "usage: halign <generate|check|setup> [--layer <layer>=<option>]...\n       halign --help\n       halign --version\n";

/** Read `package.json` version by walking up from this module, covering `src/` and `dist/`. */
function packageVersion(): string
{
    let directory = dirname(fileURLToPath(import.meta.url));
    for (let index = 0; index < 5; index += 1)
    {
        const candidate = join(directory, "package.json");
        if (existsSync(candidate))
        {
            const parsed: unknown = JSON.parse(readFileSync(candidate, "utf8"));
            if (typeof parsed === "object" && parsed !== null && "version" in parsed && typeof parsed.version === "string")
            {
                return parsed.version;
            }
        }
        directory = join(directory, "..");
    }
    throw new HalignError("package.json: version was not found");
}

/** Write usage to stderr and return the invalid-argument exit code. */
function usage(error?: string): number
{
    if (error) process.stderr.write(`error: ${error}\n`);
    process.stderr.write(USAGE);
    return 2;
}

/** CLI entry used by the `halign` binary and by tests. */
export async function main(argv: string[], userProfile = process.env.USERPROFILE): Promise<number>
{
    if (argv.includes("--help") || argv.includes("-h"))
    {
        process.stdout.write(USAGE);
        return 0;
    }
    if (argv.includes("--version") || argv.includes("-v"))
    {
        process.stdout.write(`${packageVersion()}\n`);
        return 0;
    }
    const command = argv[0];
    if (command !== "generate" && command !== "check" && command !== "setup") return usage("command must be generate, check, or setup");
    const overrides = new Map<string, string>();
    for (let index = 1; index < argv.length; index += 1)
    {
        const argument = argv[index]!;
        let value: string | undefined;
        if (argument === "--layer")
        {
            value = argv[index + 1];
            if (value === undefined) return usage("--layer requires a value");
            index += 1;
        }
        else if (argument.startsWith("--layer="))
        {
            value = argument.slice("--layer=".length);
        }
        else
        {
            return usage(`unknown argument ${argument}`);
        }
        const separator = value.indexOf("=");
        if (separator <= 0 || separator === value.length - 1 || value.indexOf("=", separator + 1) >= 0)
        {
            return usage("--layer must use <layer>=<option>");
        }
        const name = value.slice(0, separator);
        const option = value.slice(separator + 1);
        if (overrides.has(name)) return usage(`--layer must not repeat ${name}`);
        overrides.set(name, option);
    }
    try
    {
        const root = await ensureUserWorkspace(userProfile);
        let selection: LayerSelection[] | undefined;
        if (overrides.size > 0)
        {
            const config = await loadConfig(root);
            const configured = new Set(config.layers.map((layer) => layer.name));
            const unknown = [...overrides.keys()].find((name) => !configured.has(name));
            if (unknown !== undefined) throw new HalignError(`unknown layer selection ${JSON.stringify(unknown)}; expected one of ${JSON.stringify([...configured].sort())}`);
            selection = config.layers.map((layer) => ({ name: layer.name, option: overrides.get(layer.name) ?? layer.selected }));
        }
        if (command === "generate")
        {
            const outputs = await generate(root, selection);
            process.stdout.write(reportGenerate(join(resolve(root), ".halign", "generated"), outputs));
            return 0;
        }
        if (command === "setup")
        {
            process.stdout.write(reportSetup(await setup(root, selection, userProfile)));
            return 0;
        }
        const differences = await check(root, selection);
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

// Compare real paths so a directory junction from a global package link still executes `main()`.
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
