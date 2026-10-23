# 配置参考

## 目录

- [配置目录](#配置目录)
- [配置文件](#配置文件)
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
├─ harness-files/
│  └─ <harness>/
│     └─ <relative-path>
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
| `rules/` | 参与各助手 `AGENTS.md` 生成的公共规则 |
| `rules/shared/` | 单独部署到 `%USERPROFILE%\.agents\shared-rules` 的共享规则 |
| `layers/` | 可切换的规则选项, 不必全部加入当前生成序列 |
| `agents/` | Subagent 共享正文和各 Harness 的 metadata |
| `harness-files/<harness>/` | 部署到该 Harness 目录的额外文件, 见[额外文件](#额外文件) |
| `skills/` | 已安装 Skills 和来源记录, 见 [Skills 管理](skills.md) |
| `generated/` | 生成结果, 请通过应用重新生成, 不要手工修改 |

配置目录中的 `AGENTS.md` 说明各文件能否直接修改, 规则如何组合, Subagent 如何转换和部署, 并附[项目源码链接](https://github.com/SnowyLake/HarnessAlign). 你可以在这个目录里让 Agent 修改配置源, 然后自行生成和部署, 不必让 Agent 操作 GUI.

应用访问配置目录时会补齐缺失的指引, 刷新带生成标记的版本, 保留无标记的自定义文件. 内容相同时不重写. 这份指引不参与助手规则生成, 部署或 GitHub 同步.

## 配置文件

`config.json` 使用版本 `3`. 下面的示例声明三个 Harness, 并选用两个 Layer. 使用时, `layers` 中的选项必须有对应文件.

```json
{
  "version": 3,
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
      "name": "codex",
      "config_path": ".codex",
      "agent_format": "toml",
      "agent_extension": "toml",
      "instructions_field": "developer_instructions"
    },
    {
      "name": "cursor",
      "config_path": ".cursor",
      "agent_format": "yaml",
      "agent_extension": "md"
    },
    {
      "name": "opencode",
      "config_path": ".config/opencode",
      "agent_format": "yaml",
      "agent_extension": "md"
    }
  ]
}
```

### Harness 字段

每个 Harness 声明名称, 相对用户主目录的配置路径, 以及 Subagent 输出格式.

`harnesses` 可以为 `[]`, 之后可在 Home 页面手动添加. 新建配置的默认候选和检测方式见[安装与首次启动](usage.md#安装与首次启动).

| 字段 | 约束与用途 |
| --- | --- |
| `name` | 匹配 `[A-Za-z0-9][A-Za-z0-9_-]*`, 忽略大小写后唯一. 用于 Rule `targets`, Agent `harnesses` 键和生成目录名 |
| `config_path` | 相对于 `%USERPROFILE%` 的部署目录. 使用 `/`, 不允许绝对路径或 `..` |
| `agent_format` | `toml` 或 `yaml`, 决定 Subagent metadata 的输出格式 |
| `agent_extension` | 文件扩展名, 不含点或路径分隔符. 名称规则见[名称和大小写](#名称和大小写) |
| `instructions_field` | TOML Harness 必填, 用于保存共享 Markdown 正文; YAML Harness 不使用 |

不同 `config_path` 不能重叠, 也不能占用 `.agents/shared-rules`, `.agents/skills`, `.agents/.harness-align.lock.json` 或 `.harness-align`. Setup 只更新已经存在的 Harness 根目录, 详见[生成和部署](usage.md#生成和部署).

### Layer 字段

| 字段 | 约束与用途 |
| --- | --- |
| `name` | 匹配 `[A-Za-z0-9][A-Za-z0-9_-]*`, 忽略大小写后唯一. 对应 `layers/<layer>/` 目录名 |
| `selected` | 匹配 `[A-Za-z0-9][A-Za-z0-9_-]*`, 必须存在对应 `.md` 文件. 指定保存的默认选项 |

`layers` 可以为空, 表示没有选用 Layer. Layer 目录也可以暂时没有 Option, 但空 Layer 不能启用生成. 未写入 `config.json` 的 Layer 目录仍然有效, 只是不参与生成.

可选字段 `skill_sources` 用于登记 GitHub Skill 仓库, 省略或写成 `[]` 都表示没有远端来源. 通过 Skills 页的 Sources 管理来源, 见[安装说明](skills.md#从-github-安装).

## 配置版本与自动升级

`config.version` 表示整套用户配置源的格式与解释规则, 与应用的 SemVer 独立. 应用更新但配置协议不变时, 配置版本不变. 配置源结构, 必填要求或已有字段含义发生不兼容变化时才递增; 新写出的可选字段也要检查旧应用能否正确读取和无损保存. 同步存档, 生成 manifest 和恢复记录分别管理自身版本, 不跟随配置版本改号.

当前应用新建和保存配置都使用 v3, 兼容读取现行 Layer 格式的 v1. 访问工作区时先完成中断操作的恢复, 完整验证配置源, 再自动持久升级. 读取函数和内存预览本身不写文件. 已是 v3 时保持配置的原始字节, 不重复备份或改写.

v1 到 v3 只更新原始配置对象中的 `version`, 保留其他字段, 省略状态, Layer 顺序和源文件内容. 缺失或空 `targets` 继续表示不对任何 Harness 生效, 不推测开发期曾使用的默认行为. 格式升级可能调整 `config.json` 的缩进与换行, 原始字节保存在 `.harness-align/.config-backup-v1-<sha256>.json`. 备份保留在本机, 不参与生成, 部署或 GitHub 同步. 写回复用 `.edit-recovery.json` 的中断恢复和外部修改保护.

存在待确认 GitHub 上传, 或本机同步状态无法安全读取时, 自动持久升级会延迟, Console 显示原因. 待确认上传先按原始内容恢复, 再升级; 处理方法见[失败与中断恢复](github-sync.md#失败与中断恢复). 升级成功会在 Console 显示结果和原始配置备份的文件名, 不自动 Generate, Setup 或上传远端.

延迟期间仍按当前模型读取配置. 主动保存配置或级联更新 Harness 等操作会使用 v3, 同样保留原始 v1 配置备份; 这些主动修改在后续同步中按真实本地变化审阅.

历史 Profile 格式 v2 不支持自动转换, 该编号不会复用. 当前应用无法识别的格式, 非法版本和未来版本都会报错并保留源文件, 不以默认配置覆盖. 不通过手改版本号绕过校验.

旧应用可能无法读取 v3. 需要回退时, 先关闭当前应用并另存当前 `config.json`, 再将对应升级备份复制为 `config.json`, 使用支持该 v1 Layer 格式的旧应用. 这份备份只恢复升级前的配置文件, 不撤销升级后的其他编辑; 再次用当前应用打开仍会升级到 v3.

## Rules 与 Layer

公共 Rule 按 `priority` 排序后, 按各 Harness 的 `targets` 筛选. 之后, 当前选中的 Layer 按 `config.json` 顺序各贡献一个 Option.

`targets` 是严格白名单. 省略它或写成 `targets: []`, 都表示内容不对任何 Harness 生效. 要应用到全部助手, 必须显式列出所有 Harness 名称. 桌面应用保存时会写出显式 `targets` 数组.

Layer Option 可以是纯 Markdown, 也可以带只包含可选 `targets` 的 YAML frontmatter. 纯 Markdown 没有声明 Targets, 因此同样不对任何 Harness 生效. Layer 不使用 `priority`. 空文件可作为不输出内容的选项.

```markdown
---
targets:
  - codex
  - cursor
---

# Soul

Arona soul content.
```

生成的 `AGENTS.md` 只有 `config.json` 中 `name` 指定的一个一级标题. 规则正文中, fenced code 之外的一至五级标题会降一级, 六级标题保持不变.

Shared 规则不参与上述组合, 它们会单独部署到用户共享规则目录.

## Subagent

Subagent 源文件包含公共 `name`, `description`, `harnesses` 和 Markdown 正文. 各 Harness 共用正文, metadata 分别填写.

每个 Harness 块中的 metadata 没有字段白名单, 会按该 Harness 的格式输出. 同名 metadata 可以覆盖输出中的公共 `name` 或 `description`. 将 `name` 设为 `null` 会从该 Harness 的生成结果中省略 `name`; 省略该键则继承公共名称. OpenCode 的 Agent 编辑页提供 Generate name field 开关, 默认开启; 关闭后写入 `name: null`. TOML Harness 的正文使用 `instructions_field`, 不要在 metadata 中重复声明该字段, 它也不能命名为 `name` 或 `description`.

保存前, 应用会检查公共 `name` 是否与其他 Agent 忽略大小写后重名. 存在冲突时保留原文件.

## 额外文件

`harness-files/<harness>/<relative>` 中的每个文件都会在 Setup 时复制到该 Harness 目录下的相同相对路径. 例如 `harness-files/grok/config.toml` 部署到 `%USERPROFILE%\.grok\config.toml`. 有文件即表示参与同步, `config.json` 不增加字段, 配置版本保持 `3`.

路径必须位于 Harness 目录内. 应用拒绝绝对路径, `..`, 反斜杠, 空目录段, Windows 保留名, 以及 `AGENTS.md` 和 `agents/` 下的路径, 避免覆盖生成结果. 也不能占用 `.agents/shared-rules`, `.agents/skills` 或部署 lock. 父目录必须已经存在, Setup 不会创建它. 父目录缺失时状态为 Parent folder missing, 预览会拒绝部署. Harness 根目录不存在时跳过该助手, 不创建根目录. 根目录是符号链接或 junction 时状态为 Folder unsafe, Setup 会停止, 而不是跳过该助手.

文件必须是无 BOM 的 UTF-8 文本, 可以包含 CRLF, 引擎保存和部署都保留原始字节. 编辑器会保留整份文件统一的 CRLF 或 CR; 同一文件混用多种换行时, 保存会记成 LF. 单个文件不超过 8 MiB. 超过该大小的目标文件不会在打开工作区或 Adopt 时整文件读入. 令牌, API key 和其他秘密会按原样进入 GitHub 同步, 应放在环境变量或 `${VAR}` 中.

删除同步源后, 助手目录中的副本保留到下一次 Setup. Setup 只删除该文件, 不删除父目录. Adopt target content 用助手目录里的当前文件替换同步源; 目标不存在时改为删除同步源. 这不会上传 GitHub, 也不会提前更新部署记录.

未在 `config.json` 中声明的 `harness-files` 子目录会使配置无法加载. 删除最后一个文件后, 空目录会一并移除.

## 名称和大小写

Agent, Layer, Layer Option 和 Harness 名称允许英文字母大小写, 保留原始拼写, 忽略大小写后必须唯一. `targets`, `harnesses` 键和 Layer 选择中的引用必须与名称的大小写一致.

Agent 和 Rule, 包括 Shared 规则, 支持仅修改文件名大小写. 重名检查会排除当前文件, 仍然拒绝与其他文件忽略大小写后重名. Layer 和 Layer Option 也支持这类重命名, 并同步更新已保存的选择.

`agent_extension` 和 `instructions_field` 允许英文字母大小写, 数字, 下划线和连字符, 必须以字母或数字开头. 输出保留原始拼写. 在界面编辑 Harness 时, 只要不切换格式, 就会保留原有扩展名. `agent_format` 仍只能填写 `toml` 或 `yaml`. Rule 文件名和 Skill id 使用各自的命名规则.

返回[项目首页](../README.md).
