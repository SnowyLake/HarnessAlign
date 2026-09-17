# 配置参考

## 目录

- [配置目录](#配置目录)
- [配置文件](#配置文件)
- [Rules 与 Layer](#rules-与-layer)
- [Subagent](#subagent)
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
| `skills/` | 已安装 Skills 和来源记录, 见 [Skills 管理](skills.md) |
| `generated/` | 生成结果, 请通过应用重新生成, 不要手工修改 |

配置目录中的 `AGENTS.md` 说明各文件能否直接修改, 规则如何组合, Subagent 如何转换和部署, 并附[项目源码链接](https://github.com/SnowyLake/HarnessAlign). 你可以在这个目录里让 Agent 修改配置源, 然后自行生成和部署, 不必让 Agent 操作 GUI.

应用访问配置目录时会补齐缺失的指引, 刷新带生成标记的版本, 保留无标记的自定义文件. 内容相同时不重写. 这份指引不参与助手规则生成, 部署或 GitHub 同步.

## 配置文件

`config.json` 使用版本 `1`. 下面的示例声明三个 Harness, 并选用两个 Layer. 使用时, `layers` 中的选项必须有对应文件.

```json
{
  "version": 1,
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

`harnesses` 可以为 `[]`, 之后可在 Harnesses 页面手动添加. 新建配置的默认候选和检测方式见[安装与首次启动](usage.md#安装与首次启动).

| 字段 | 约束与用途 |
| --- | --- |
| `name` | 匹配 `[A-Za-z0-9][A-Za-z0-9_-]*`, 忽略大小写后唯一. 用于 Rule `targets`, Agent `harnesses` 键和生成目录名 |
| `config_path` | 相对于 `%USERPROFILE%` 的部署目录. 使用 `/`, 不允许绝对路径或 `..` |
| `agent_format` | `toml` 或 `yaml`, 决定 Subagent metadata 的输出格式 |
| `agent_extension` | 文件扩展名, 不含点或路径分隔符. 名称规则见[名称和大小写](#名称和大小写) |
| `instructions_field` | TOML Harness 必填, 用于保存共享 Markdown 正文; YAML Harness 不使用 |

不同 `config_path` 不能重叠, 也不能占用 `.agents/shared-rules`, `.agents/skills` 或 `.harness-align`. Setup 只更新已经存在的 Harness 根目录, 详见[生成和部署](usage.md#生成和部署).

### Layer 字段

| 字段 | 约束与用途 |
| --- | --- |
| `name` | 匹配 `[A-Za-z0-9][A-Za-z0-9_-]*`, 忽略大小写后唯一. 对应 `layers/<layer>/` 目录名 |
| `selected` | 匹配 `[A-Za-z0-9][A-Za-z0-9_-]*`, 必须存在对应 `.md` 文件. 指定保存的默认选项 |

`layers` 可以为空, 表示没有选用 Layer. Layer 目录也可以暂时没有 Option, 但空 Layer 不能启用生成. 未写入 `config.json` 的 Layer 目录仍然有效, 只是不参与生成.

可选字段 `skill_sources` 用于登记 GitHub Skill 仓库, 省略或写成 `[]` 都表示没有远端来源. 通过 Skills 页的 Sources 管理来源, 见[安装说明](skills.md#从-github-安装).

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

每个 Harness 块中的 metadata 没有字段白名单, 会按该 Harness 的格式输出. 同名 metadata 可以覆盖输出中的公共 `name` 或 `description`. TOML Harness 的正文使用 `instructions_field`, 不要在 metadata 中重复声明该字段, 它也不能命名为 `name` 或 `description`.

保存前, 应用会检查公共 `name` 是否与其他 Agent 忽略大小写后重名. 存在冲突时保留原文件.

## 名称和大小写

Agent, Layer, Layer Option 和 Harness 名称允许英文字母大小写, 保留原始拼写, 忽略大小写后必须唯一. `targets`, `harnesses` 键和 Layer 选择中的引用必须与名称的大小写一致.

Agent 和 Rule, 包括 Shared 规则, 支持仅修改文件名大小写. 重名检查会排除当前文件, 仍然拒绝与其他文件忽略大小写后重名. Layer 和 Layer Option 也支持这类重命名, 并同步更新已保存的选择.

`agent_extension` 和 `instructions_field` 允许英文字母大小写, 数字, 下划线和连字符, 必须以字母或数字开头. 输出保留原始拼写. 在界面编辑 Harness 时, 只要不切换格式, 就会保留原有扩展名. `agent_format` 仍只能填写 `toml` 或 `yaml`. Rule 文件名和 Skill id 使用各自的命名规则.

返回[项目首页](../README.md).
