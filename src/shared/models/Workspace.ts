/**
 * Workspace DTOs shared by Main, preload, and renderer.
 * These types must stay JSON-serializable and must not import the engine.
 */

/** Subagent metadata format declared by a harness. */
export type AgentFormat = "toml" | "yaml";
/** Untyped harness-specific metadata mapping. */
export type Metadata = Record<string, unknown>;

/** One harness declared in `.halign/config.json`. */
export interface HarnessConfig
{
    name: string;
    configPath: string;
    agentFormat: AgentFormat;
    agentExtension: string;
    instructionsField?: string;
}

/** Validated `.halign/config.json` document. */
export interface Config
{
    version: 2;
    name: string;
    defaultProfile: string;
    profiles: string[];
    harnesses: HarnessConfig[];
}

/** Editor payload for a root or domain rule. */
export interface RuleInput
{
    path: string;
    priority: number;
    targets?: string[];
    body: string;
}

/** Shared-rule markdown that is deployed independently of `AGENTS.md`. */
export interface SharedRule
{
    path: string;
    body: string;
}

/** Subagent source with per-harness metadata and a shared markdown body. */
export interface Agent
{
    path: string;
    name: string;
    description: string;
    harnesses: Record<string, Metadata>;
    body: string;
}

/** One real file currently present under `.halign/generated/`. */
export interface GeneratedFile
{
    path: string;
    content: string;
}

/** Loaded `.halign` workspace shown in the desktop shell. */
export interface Workspace
{
    root: string;
    config: Config;
    rootRules: RuleInput[];
    domainRules: Record<string, RuleInput[]>;
    sharedRules: SharedRule[];
    agents: Agent[];
    generatedFiles: GeneratedFile[];
}
