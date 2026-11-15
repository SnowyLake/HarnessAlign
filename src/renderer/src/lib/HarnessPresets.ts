/**
 * User-level harness defaults for the Add Harness form.
 * Presets only fill editable drafts; Main still validates every saved configuration.
 */

import type { HarnessConfig } from "../../../shared/models/Workspace.js";
import type { FormSnapshot } from "../stores/AppStore.js";

/** Built-in Windows user-directory presets, without changing first-run detection. */
export const HARNESS_PRESETS: readonly { label: string; config: HarnessConfig; notice?: string }[] = [
    {
        label: "Codex",
        config: { name: "Codex", configPath: ".codex", instructionsFile: "AGENTS.md", agentsDir: "agents",
                  agentFormat: "toml", agentExtension: "toml", instructionsField: "developer_instructions" },
    },
    {
        label: "Claude Code",
        config: { name: "ClaudeCode", configPath: ".claude", instructionsFile: "CLAUDE.md", agentsDir: "agents", agentFormat: "yaml", agentExtension: "md" },
    },
    {
        label: "Antigravity",
        config: { name: "Antigravity", configPath: ".gemini/config", instructionsFile: "AGENTS.md", agentsDir: "agents", agentFormat: "yaml", agentExtension: "md" },
    },
    {
        label: "Cursor",
        config: { name: "Cursor", configPath: ".cursor", instructionsFile: "AGENTS.md", agentsDir: "agents", agentFormat: "yaml", agentExtension: "md" },
        notice: "User subagents are supported. Cursor does not document ~/.cursor/AGENTS.md as global rules; configure global instructions in Cursor's User Rules settings.",
    },
    {
        label: "Grok Build",
        config: { name: "GrokBuild", configPath: ".grok", instructionsFile: "AGENTS.md", agentsDir: "agents", agentFormat: "yaml", agentExtension: "md" },
    },
    {
        label: "GitHub Copilot CLI",
        config: { name: "CopilotCLI", configPath: ".copilot", instructionsFile: "copilot-instructions.md", agentsDir: "agents", agentFormat: "yaml", agentExtension: "md" },
    },
    {
        label: "Devin CLI",
        config: { name: "DevinCLI", configPath: "AppData/Roaming/devin", instructionsFile: "AGENTS.md", agentsDir: "agents", agentFormat: "yaml", agentExtension: "md" },
        notice: "Devin CLI subagents are experimental. This preset assumes %APPDATA% is ~/AppData/Roaming; adjust Config path if it differs within your user profile.",
    },
    {
        label: "Factory",
        config: { name: "Factory", configPath: ".factory", instructionsFile: "AGENTS.md", agentsDir: "droids", agentFormat: "yaml", agentExtension: "md" },
    },
];

/** Explain why a preset cannot be added without conflicting with a configured harness. */
export function harnessPresetConflict(preset: HarnessConfig, harnesses: readonly HarnessConfig[]): string | undefined
{
    const name = preset.name.toLowerCase();
    const configPath = preset.configPath.toLowerCase();
    for (const harness of harnesses)
    {
        if (harness.name.toLowerCase() === name) return "Already configured";
        const existing = harness.configPath.toLowerCase();
        if (existing === configPath) return "Already configured";
        if (existing.startsWith(`${configPath}/`) || configPath.startsWith(`${existing}/`)) return "Overlaps an existing config path";
    }
    return undefined;
}

/** Build a complete native-form snapshot for one preset or the blank custom form. */
export function harnessPresetSnapshot(name: string): FormSnapshot
{
    const preset = HARNESS_PRESETS.find((item) => item.config.name === name);
    if (name !== "custom" && !preset) throw new Error(`Unknown Harness preset: ${name}`);
    const config = preset?.config;
    const values: FormSnapshot = {
        preset: [name],
        name: [config?.name ?? ""],
        configPath: [config?.configPath ?? ""],
        instructionsFile: [config?.instructionsFile ?? "AGENTS.md"],
        agentsDir: [config?.agentsDir ?? "agents"],
        agentFileFormat: [config?.agentFormat === "toml" ? "toml" : "md"],
        ...(config?.agentFormat === "toml" ? { instructionsField: [config.instructionsField!] } : {}),
    };
    return Object.fromEntries(Object.entries(values).sort(([left], [right]) => left.localeCompare(right)));
}
