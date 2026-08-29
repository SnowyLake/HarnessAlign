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

/** One ordered layer and its project-selected option. */
export interface LayerConfig
{
    name: string;
    selected: string;
}

/** One ordered layer choice used for a generation command. */
export interface LayerSelection
{
    name: string;
    option: string;
}

/** One registered GitHub skill repository source. */
export interface SkillSource
{
    owner: string;
    name: string;
    branch: string;
}

/** Validated `.halign/config.json` document. */
export interface Config
{
    version: 1;
    name: string;
    layers: LayerConfig[];
    harnesses: HarnessConfig[];
    skillSources: SkillSource[];
}

/** Provenance recorded for an installed project skill. */
export type SkillOrigin =
    | { kind: "github"; owner: string; name: string; branch: string; sourcePath: string; contentHash: string }
    | { kind: "local"; contentHash: string }
    | { kind: "unknown" };

/** Installed project skill metadata without file bodies. */
export interface ProjectSkill
{
    id: string;
    title: string;
    description: string;
    origin: SkillOrigin;
}

/** Skill discovered under a remote GitHub skill source. */
export interface RemoteSkill
{
    id: string;
    title: string;
    description: string;
    owner: string;
    name: string;
    branch: string;
    sourcePath: string;
    conflict: boolean;
}

/** Result of comparing an installed skill against its remote source. */
export interface SkillUpdate
{
    id: string;
    currentHash: string;
    remoteHash: string;
    error?: string;
}

/** Skill discovered under the user profile skills directory. */
export interface UserSkill
{
    id: string;
    title: string;
    description: string;
}

/** Editor payload for a root rule. */
export interface RuleInput
{
    path: string;
    priority: number;
    targets: string[];
    body: string;
}

/** Selectable layer Markdown source shown in the desktop editor. */
export interface LayerOption
{
    path: string;
    layer: string;
    name: string;
    targets: string[];
    body: string;
}

/** Editor payload for a layer option Markdown source. */
export interface LayerOptionInput
{
    path: string;
    targets: string[];
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
    layerOptions: Record<string, LayerOption[]>;
    sharedRules: SharedRule[];
    agents: Agent[];
    skills: ProjectSkill[];
    generatedFiles: GeneratedFile[];
}
