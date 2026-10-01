/**
 * Workspace DTOs shared by Main, preload, and renderer.
 * These types must stay JSON-serializable and must not import the engine.
 */

/** Subagent metadata format declared by a harness. */
export type AgentFormat = "toml" | "yaml";
/** Untyped harness-specific metadata mapping. */
export type Metadata = Record<string, unknown>;

/** One harness declared in `.harness-align/config.json`. */
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

/** Validated `.harness-align/config.json` document. */
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
    | { kind: "github"; owner: string; name: string; branch: string; sourcePath: string; contentHash: string; commit?: string }
    | { kind: "local"; contentHash: string }
    | { kind: "unknown" };

/** Installed project skill metadata without file bodies. */
export interface ProjectSkill extends UserSkill
{
    origin: SkillOrigin;
}

/** Skill discovered under a remote GitHub skill source. */
export interface RemoteSkill extends UserSkill, SkillSource
{
    previewId: string;
    sourcePath: string;
    conflict: boolean;
}

/** Result of comparing an installed skill against its remote source. */
export interface SkillUpdate
{
    id: string;
    currentHash: string;
    remoteHash: string;
    previewId?: string;
    error?: string;
}

/** Fixed-version update review with bounded Markdown text and file classifications. */
export interface SkillUpdatePreview
{
    previewId: string;
    id: string;
    oldCommit: string | null;
    newCommit: string;
    files: Array<{ path: string; status: "added" | "modified" | "deleted" | "unchanged" }>;
    oldText: string;
    newText: string;
    truncated: boolean;
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
export interface LayerOption extends LayerOptionInput
{
    layer: string;
    name: string;
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

/** One real file currently present under `.harness-align/generated/`. */
export interface GeneratedFile
{
    path: string;
    content: string;
}

/** Actual managed output status relative to saved sources, independent of operation history. */
export interface GenerationStatus
{
    state: "current" | "stale" | "missing" | "partial";
    changes: Array<{ path: string; status: "missing" | "modified" | "obsolete" }>;
}

/** Existing workspace file identity whose containing folder may be opened by Main. */
export type WorkspaceItemTarget =
    | { kind: "source"; path: string }
    | { kind: "generated"; path: string }
    | { kind: "skill"; id: string };

/** One reviewed deployment change under a user harness, shared-rule, or skill directory. */
export interface SetupChange
{
    path: string;
    status: "added" | "modified" | "deleted" | "unchanged" | "skipped";
    external?: string;
}

/** Server-owned deployment preview; execution accepts only its identity. */
export interface SetupPreview
{
    id: string;
    changes: SetupChange[];
}

/** Opened source identity checked by Main before saving or renaming. */
export interface SourceGuard
{
    path: string;
    revision: string | null;
}

/** Loaded `.harness-align` workspace shown in the desktop shell. */
export interface Workspace
{
    sourceRevisions: Record<string, string>;
    config: Config;
    rootRules: RuleInput[];
    layerOptions: Record<string, LayerOption[]>;
    sharedRules: SharedRule[];
    agents: Agent[];
    skills: ProjectSkill[];
    generatedFiles: GeneratedFile[];
    generationStatus: GenerationStatus;
    harnessRoots: Array<{ name: string; state: "ready" | "missing" | "unsafe" }>;
}
