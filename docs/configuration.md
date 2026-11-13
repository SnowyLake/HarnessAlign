# 配置参考

## 目录

- [配置目录](#配置目录)
- [配置文件](#配置文件)
- [内置 Harness 预设](#内置-harness-预设)
- [配置版本与自动升级](#配置版本与自动升级)
- [Rules 与 Layer](#rules-与-layer)
- [Subagent](#subagent)
- [额外文件](#额外文件)
- [名称和大小写](#名称和大小写)

## 配置目录

每个用户的配置固定保存在 `%USERPROFILE%\.harness-align`, 与应用安装目录和源码仓库分开. 应用不提供更换配置根目录的入口.

新目录不存在而旧的 `%USERPROFILE%\.halign` 存在时, 应用会迁移整个旧目录, 保留配置, 规则, Layer, Agent, Skills 和生成文件的原始内容. 两个目录同时存在时使用新目录, 保留旧目录, 不合并或覆盖. 迁移会拒绝符号链接和 junction.

```text
.harness-align/
├─ AGENTS.md
├─ config.json
├─ rules/
│  └─ shared/
├─ layers/
│  └─ <layer>/
│     └─ <option>.md
├─ agents/
├─ .file-sync.json
├─ skills/
│  ├─ index.json
│  └─ <skill-id>/
│     └─ SKILL.md
└─ generated/
```

| 路径 | 内容 |
| --- | --- |
| `AGENTS.md` | 应用生成的配置编辑指引 |
| `config.json` | 输出标题, Harness, 当前 Layer 选择和 Skills 来源 |
| `rules/` | 参与各助手规则文件生成的公共规则 |
| `rules/shared/` | 单独部署到 `%USERPROFILE%\.agents\shared-rules` 的共享规则 |
| `layers/` | 可切换的规则选项, 不必全部加入当前生成序列 |
| `agents/` | Subagent 共享正文和各 Harness 的 metadata |
| `.file-sync.json` | 应用维护的额外文件登记、停止记录及待解决迁移内容, 见[额外文件](#额外文件) |
| `skills/` | 已安装 Skills 和来源记录, 见 [Skills 管理](skills.md) |
| `generated/` | 生成结果, 请通过应用重新生成, 不要手工修改 |

配置目录中的 `AGENTS.md` 说明各文件能否直接修改, 规则如何组合, Subagent 如何转换和部署, 并附[项目源码链接](https://github.com/SnowyLake/HarnessAlign). 你可以在这个目录里让 Agent 修改配置源, 然后自行生成和部署, 不必让 Agent 操作 GUI.

应用访问配置目录时会补齐缺失的指引, 刷新带生成标记的版本, 保留无标记的自定义文件. 内容相同时不重写. 这份指引不参与助手规则生成, 部署或 GitHub 同步.

## 配置文件

`config.json` 使用版本 `4`. 下面的示例声明三个 Harness, 并选用两个 Layer. 使用时, `layers` 中的选项必须有对应文件.

```json
{
  "version": 4,
  "name": "AGENTS",
  "layers": [
    {
      "name": "soul",
      "selected": "arona"
    },
    {
      "name": "workflow",
      "selected": "strict"
    }
  ],
  "harnesses": [
    {
      "name": "Codex",
      "config_path": ".codex",
      "agent_format": "toml",
      "agent_extension": "toml",
      "instructions_field": "developer_instructions"
    },
    {
      "name": "Cursor",
      "config_path": ".cursor",
      "agent_format": "yaml",
      "agent_extension": "md"
    },
    {
      "name": "OpenCode",
      "config_path": ".config/opencode",
      "agent_format": "yaml",
      "agent_extension": "md"
    }
  ]
}
```

示例省略了可选的 `instructions_file` 和 `agents_dir`, 两者分别使用默认值 `AGENTS.md` 和 `agents`.

### Harness 字段

每个 Harness 声明名称, 相对用户主目录的配置路径, Subagent 输出格式, 以及可选的输出文件路径.

`harnesses` 可以为 `[]`, 之后可在 Home 页面手动添加. 新建配置的默认候选和检测方式见[安装与首次启动](usage.md#安装与首次启动).

| 字段 | 约束与用途 |
| --- | --- |
| `name` | 匹配 `[A-Za-z0-9][A-Za-z0-9_-]*`, 忽略大小写后唯一. 用于 Rule `targets`, Agent `harnesses` 键和生成目录名 |
| `config_path` | 相对于 `%USERPROFILE%` 的部署目录. 使用 `/`, 不允许绝对路径或 `..` |
| `instructions_file` | 可选, 默认 `AGENTS.md`. 相对 `config_path` 的规则输出文件路径, 可以包含嵌套目录 |
| `agents_dir` | 可选, 默认 `agents`. 相对 `config_path` 的 Subagent 输出目录, 可以包含嵌套目录 |
| `agent_format` | `toml` 或 `yaml`, 决定 Subagent metadata 的输出格式 |
| `agent_extension` | 文件扩展名, 不含点或路径分隔符. 名称规则见[名称和大小写](#名称和大小写) |
| `instructions_field` | TOML Harness 必填, 用于保存共享 Markdown 正文的 TOML 键; YAML Harness 不使用. 它不是输出文件路径 |

`instructions_file` 和 `agents_dir` 必须是规范化的相对路径: 使用 `/`, 不能是绝对路径, 不能包含 `..`, 反斜杠, 空段, Windows 保留名或 `.harness-align-*` 暂存名. 两者忽略大小写后不能相同或互为祖先目录. 它们与 `config_path` 拼出的实际路径也不能占用 `.agents/shared-rules`, `.agents/skills`, `.agents/.harness-align.lock.json` 或 `.harness-align`. Setup 会为嵌套路径创建所需父目录, 但 Harness 根目录仍必须已经存在.

修改 `config_path`, `instructions_file` 或 `agents_dir` 后, 旧路径下的部署内容会保留, 应用不自动迁移或删除. 确认对应助手不再从旧路径加载这些内容后再自行清理; `generated/` 中由旧 manifest 管理且本次不再生成的输出仍按正常 stale 规则删除.

在 `generated/` 内, 将规则文件 `prompts` 改为 `prompts/CLAUDE.md` 或反向调整时, Generate 会在完整预检后清理旧 manifest 证明归属的阻塞文件及必要空目录. 旧输出移到其他路径后, 已无当前输出的空父目录也会在更新 manifest 前清理, 避免之后重新使用该路径时被遗留空目录阻塞; 其中有未知内容时保留目录. 需要折叠的目录中如果有未知文件、未知空目录或链接, 会在修改前报错, 不递归清空目录. 写入或清理失败时保留旧 manifest, 修正报错原因后可重新 Generate; 生成缓存不提供多文件回滚. 这不改变助手目录中旧部署路径默认保留的行为.

不同 `config_path` 不能重叠, 也不能占用 `.agents/shared-rules`, `.agents/skills`, `.agents/.harness-align.lock.json` 或 `.harness-align`. Setup 只更新已经存在的 Harness 根目录, 详见[生成和部署](usage.md#生成和部署).

### Layer 字段

| 字段 | 约束与用途 |
| --- | --- |
| `name` | 匹配 `[A-Za-z0-9][A-Za-z0-9_-]*`, 忽略大小写后唯一. 对应 `layers/<layer>/` 目录名 |
| `selected` | 匹配 `[A-Za-z0-9][A-Za-z0-9_-]*`, 必须存在对应 `.md` 文件. 指定保存的默认选项 |

`layers` 可以为空, 表示没有选用 Layer. Layer 目录也可以暂时没有 Option, 但空 Layer 不能启用生成. 未写入 `config.json` 的 Layer 目录仍然有效, 只是不参与生成.

可选字段 `skill_sources` 用于登记 GitHub Skill 仓库, 省略或写成 `[]` 都表示没有远端来源. 通过 Skills 页的 Sources 管理来源, 见[安装说明](skills.md#从-github-安装).

## 内置 Harness 预设

Home 的 Add harness 可以选择以下预设, 或通过 Custom (blank) 手动填写. 所有路径均相对 `%USERPROFILE%`, `instructions_file` 和 `agents_dir` 再相对 `config_path`. 预设只是可编辑表单的起点, 保存后仍是普通 Harness 配置, 没有额外的预设标识或自动更新绑定. 不提供 Gemini 预设.

内置预设及首次初始化的默认配置名使用大驼峰, 如 `Codex`, `ClaudeCode` 和 `GrokBuild`; `CLI` 这类缩写保持全大写, 如 `CopilotCLI` 和 `DevinCLI`. 此约定不限制自定义名称, 也不会自动修改已有配置.

| 名称 (`name`) | `config_path` | `instructions_file` | `agents_dir` | 子代理格式 | 官方参考 |
| --- | --- | --- | --- | --- | --- |
| Codex (`Codex`) | `.codex` | `AGENTS.md` | `agents` | TOML, `.toml`; 正文键 `developer_instructions` | [规则](https://learn.chatgpt.com/codex/agent-configuration/agents-md), [子代理](https://learn.chatgpt.com/codex/agent-configuration/subagents) |
| Claude Code (`ClaudeCode`) | `.claude` | `CLAUDE.md` | `agents` | YAML frontmatter + Markdown, `.md` | [规则](https://code.claude.com/docs/en/memory), [子代理](https://code.claude.com/docs/en/sub-agents) |
| Antigravity (`Antigravity`) | `.gemini/config` | `AGENTS.md` | `agents` | YAML frontmatter + Markdown, `.md` | [发现路径](https://antigravity.google/docs/customization-discovery/), [子代理](https://antigravity.google/docs/subagents/) |
| Cursor (`Cursor`) | `.cursor` | `AGENTS.md` (见下方限制) | `agents` | YAML frontmatter + Markdown, `.md` | [规则](https://cursor.com/docs/rules), [子代理](https://cursor.com/docs/subagents) |
| Grok Build (`GrokBuild`) | `.grok` | `AGENTS.md` | `agents` | YAML frontmatter + Markdown, `.md` | [规则](https://docs.x.ai/build/features/project-rules), [子代理](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/16-subagents.md) |
| GitHub Copilot CLI (`CopilotCLI`) | `.copilot` | `copilot-instructions.md` | `agents` | YAML frontmatter + Markdown, `.md` | [规则](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions), [子代理](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli) |
| Devin CLI (`DevinCLI`) | `AppData/Roaming/devin` | `AGENTS.md` | `agents` | YAML frontmatter + Markdown, `.md` | [规则](https://docs.devin.ai/cli/extensibility/rules.md), [子代理](https://docs.devin.ai/cli/subagents.md) |
| Factory (`Factory`) | `.factory` | `AGENTS.md` | `droids` | YAML frontmatter + Markdown, `.md` | [规则](https://docs.factory.com/harness/agents-md.md), [子代理](https://docs.factory.com/harness/subagents.md) |

路径依据为 2026-11-14 的官方文档, 未对各工具做实机兼容性测试. Copilot CLI 接受 `.md` 和 `.agent.md` 两种代理文件名, 预设使用现有引擎支持的 `.md`. 预设不配置实验特性开关、模型或工具权限, 这些字段仍由各 Harness 的 Agent metadata 或工具本身管理.

Cursor 的用户级子代理目录有官方文档, 但官方未确认 `~/.cursor/AGENTS.md` 会作为全局规则加载. 预设保留默认输出文件名, 不承诺该文件被 Cursor 读取; 全局指令应在 Cursor 的 User Rules 设置中配置. 选择预设时会显示提示.

Devin 预设只针对本机 Devin CLI, 不覆盖云端 Devin. 其自定义子代理仍是实验功能, 且预设假定 `%APPDATA%` 位于 `~/AppData/Roaming`. 如果被重定向至用户主目录内的其他位置, 请修改 Config path; 现有部署不支持用户主目录以外的目标. 选择预设时会显示此限制.

选择预设不改写已有配置, 也不触发首次初始化的检测. 例如已有的 `grok` 不会自动改名为 `GrokBuild`; 同名、同目录或根目录嵌套的预设会在添加列表中禁用, 仍以 Main 的完整校验结果为准.

显式创建 Harness 的首次保存会为所有已有根 Rules 和全部 Layer Options 追加 `targets`, 并为所有已有 Agents 添加该名称的空 metadata 块. Shared Rules 不变, 不复制其他 Harness 的 metadata, 不改变全局 Layer 选择或顺序, 不自动 Generate / Setup. 普通配置保存、Harness 更新、重新加载、格式升级和同步不会补开关联. 删除 Harness 时移除这些关联; 空 Agent 保留源文件.

## 配置版本与自动升级

`config.version` 表示整套用户配置源的格式与解释规则, 与应用的 SemVer 独立. 应用更新但配置协议不变时, 配置版本不变. 配置源结构, 必填要求或已有字段含义发生不兼容变化时才递增; 新写出的可选字段也要检查旧应用能否正确读取和无损保存. 同步存档, 生成 manifest 和恢复记录分别管理自身版本, 不跟随配置版本改号.

当前应用新建和保存配置都使用 v4, 兼容读取现行 Layer 格式的 v1 和 v3. 访问工作区时先完成中断操作的恢复, 完整验证配置源, 再自动持久升级. 读取函数和内存预览本身不写文件. 已是 v4 时保持配置的原始字节, 不重复备份或改写.

v1 和 v3 不接受 `instructions_file` 或 `agents_dir`; 在旧版本文件中写入这两个字段会在校验时被拒绝, 需要配置版本为 v4. 升级只更新原始配置对象中的 `version`, 保留其他字段, 省略状态, Layer 顺序和源文件内容. 缺失或空 `targets` 继续表示不对任何 Harness 生效, 不推测开发期曾使用的默认行为. 格式升级可能调整 `config.json` 的缩进与换行, 原始字节保存在 `.harness-align/.config-backup-v<原版本>-<sha256>.json`, 例如 v1 或 v3 备份. 备份保留在本机, 不参与生成, 部署或 GitHub 同步. 写回复用 `.edit-recovery.json` 的中断恢复和外部修改保护.

存在待确认 GitHub 上传, 或本机同步状态无法安全读取时, 自动持久升级会延迟, Console 显示原因. 待确认上传先按原始内容恢复, 再升级; 处理方法见[失败与中断恢复](github-sync.md#失败与中断恢复). 升级成功会在 Console 显示结果和原始配置备份的文件名, 不自动 Generate, Setup 或上传远端.

延迟期间仍按当前模型读取配置. 主动保存配置或级联更新 Harness 等操作会使用 v4, 同样保留原始配置备份; 这些主动修改在后续同步中按真实本地变化审阅.

v4 还允许 Agent 使用 `harnesses: {}` 表示全部停用. 磁盘配置仍为 v1 / v3 时, 单独保存这一新状态会被拒绝, 需先升级配置并处理待确认同步.

历史 Profile 格式 v2 不支持自动转换, 该编号不会复用. 当前应用无法识别的格式, 非法版本和未来版本都会报错并保留源文件, 不以默认配置覆盖. 不通过手改版本号绕过校验.

旧应用可能无法读取 v4. 需要回退时, 先关闭当前应用并另存当前配置源, 再将对应升级备份复制为 `config.json`, 使用支持该备份原始格式的应用. 这份备份只恢复升级前的配置文件, 不撤销升级后的其他编辑; 若已有 `harnesses: {}` 的 Agent, 还需将其恢复为旧应用支持的非空关联. 再次用当前应用打开仍会升级到 v4.

## Rules 与 Layer

公共 Rule 按 `priority` 排序后, 按各 Harness 的 `targets` 筛选. 之后, 当前选中的 Layer 按 `config.json` 顺序各贡献一个 Option.

`targets` 是严格白名单. 省略它或写成 `targets: []`, 都表示内容不对任何 Harness 生效. 要应用到全部助手, 必须显式列出所有 Harness 名称. 桌面应用保存时会写出显式 `targets` 数组.

Layer Option 可以是纯 Markdown, 也可以带只包含可选 `targets` 的 YAML frontmatter. 纯 Markdown 没有声明 Targets, 因此同样不对任何 Harness 生效. Layer 不使用 `priority`. 空文件可作为不输出内容的选项.

```markdown
---
targets:
  - Codex
  - Cursor
---

# Soul

Arona soul content.
```

生成的规则指令文件只有 `config.json` 中 `name` 指定的一个一级标题. 规则正文中, fenced code 之外的一至五级标题会降一级, 六级标题保持不变.

Shared 规则不参与上述组合, 它们会单独部署到用户共享规则目录.

## Subagent

Subagent 源文件包含公共 `name`, `description`, `harnesses` 和 Markdown 正文. 各 Harness 共用正文, metadata 分别填写.

`harnesses` 的键表示启用该 Agent 的 Harness, 值为空对象 `{}` 时仍为启用, 仅使用公共名称、描述和正文. `harnesses: {}` 表示没有启用目标, 保留源文件但不生成输出. 删除最后一个关联 Harness 不会删除 Agent 源文件.

每个 Harness 块中的 metadata 没有字段白名单, 会按该 Harness 的格式输出. 同名 metadata 可以覆盖输出中的公共 `name` 或 `description`. 将 `name` 设为 `null` 会从该 Harness 的生成结果中省略 `name`; 省略该键则继承公共名称. OpenCode 的 Agent 编辑页提供 Generate name field 开关, 默认开启; 关闭后写入 `name: null`. TOML Harness 的正文使用 `instructions_field`, 它是 TOML 键, 不是全局规则文件路径 `instructions_file`. Subagent 文件的位置由 `agents_dir` 和 `agent_extension` 决定. 不要在 metadata 中重复声明 `instructions_field`, 它也不能命名为 `name` 或 `description`.

保存前, 应用会检查公共 `name` 是否与其他 Agent 忽略大小写后重名. 存在冲突时保留原文件.

## 额外文件

Additional files 直接同步助手目录中的实际文件和 GitHub. `.file-sync.json` 由应用维护路径登记和停止记录; 正常使用不再保存 `.harness-align/harness-files/` 副本. 例如登记 grok 的 `config.toml` 对应 `%USERPROFILE%\.grok\config.toml`. 登记额外文件不会给 `config.json` 增加字段, 配置版本保持 `4`.

路径必须位于已配置的 Harness 目录内. 应用拒绝绝对路径, `..`, 反斜杠, 空段, Windows 保留名、符号链接或 junction, 以及与各 Harness 有效 `instructions_file`, `agents_dir`, `.agents/shared-rules`, `.agents/skills` 或部署 lock 冲突的路径. 修改 Harness 的输出路径或保存配置时会预先校验已登记文件, 冲突时保留原配置和源文件. Harness 或父目录缺失时保留登记和待应用内容, 不创建目录. 实际文件缺失需要审阅恢复或停止同步.

文件必须是无 BOM 的 UTF-8 文本, 单个不超过 8 MiB, 同步内容总量不超过 32 MiB. 同步保留原始字节及换行. 文件内容按原样上传, 令牌、API key 和其他秘密应使用环境变量等外部来源.

Stop syncing 取消登记并传播停止决定, 保留各设备实际文件. 显式重新添加可以清除已接收的停止决定. 不手工编辑或删除 `.file-sync.json`.

旧版 `harness-files/` 在恢复中断操作后迁移. 相同内容直接转为登记, 不同或尚不可应用的旧内容保留为一次性 `legacyFiles` 迁移记录, 并保留 `.file-sync-migration-<hash>.json` 原始备份. 待确认上传先通过 Resume confirmed sync 恢复. 基线、备份及待应用记录供比较和恢复使用, 不提供本地副本编辑入口.

## 名称和大小写

Agent, Layer, Layer Option 和 Harness 名称允许英文字母大小写, 保留原始拼写, 忽略大小写后必须唯一. `targets`, `harnesses` 键和 Layer 选择中的引用必须与名称的大小写一致.

Agent 和 Rule, 包括 Shared 规则, 支持仅修改文件名大小写. 重名检查会排除当前文件, 仍然拒绝与其他文件忽略大小写后重名. Layer 和 Layer Option 也支持这类重命名, 并同步更新已保存的选择.

`agent_extension` 和 `instructions_field` 允许英文字母大小写, 数字, 下划线和连字符, 必须以字母或数字开头. 输出保留原始拼写. 在界面编辑 Harness 时, 只要不切换格式, 就会保留原有扩展名. `agent_format` 仍只能填写 `toml` 或 `yaml`. `instructions_file` 和 `agents_dir` 按路径规则校验, 不受这些名称规则约束. Rule 文件名和 Skill id 使用各自的命名规则.

返回[项目首页](../README.md).
