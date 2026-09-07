# Harness Align

## 目录

- [这是什么](#这是什么)
- [开始使用](#开始使用)
- [日常工作流](#日常工作流)
- [桌面应用](#桌面应用)
- [配置目录](#配置目录)
- [配置文件](#配置文件)
- [规则, Layer 与 Subagent](#规则-layer-与-subagent)
- [Skills](#skills)
- [部署结果](#部署结果)
- [安全说明](#安全说明)
- [从源码构建](#从源码构建)

## 这是什么

Harness Align 让你用一份 `.harness-align` 配置, 为多个编码助手生成各自需要的 `AGENTS.md` 和 Subagent 文件.

Cursor, Codex, OpenCode 等工具都要读项目规则, 但目录位置和 Subagent 格式并不相同. 你在一个配置目录里维护公共规则, 可选 Layer 和共享 Subagent 正文, 然后由桌面应用按每个 Harness 的格式写出结果, 再部署到当前用户已经启用的助手目录.

Harness Align 是 GUI 软件, 提供配置编辑, 生成和部署功能.

本仓库只提供工具, 不保存你的 `.harness-align` 配置. 每个用户只有一份配置, 固定放在 `%USERPROFILE%\.harness-align`, 与工具安装目录相互独立. 第一次打开桌面应用时优先迁移旧配置, 没有配置时创建目录并写入默认 `config.json`.

## 开始使用

在 Windows 上运行 Harness Align 安装包, 安装后从桌面或开始菜单打开应用. 安装版不需要 Node.js 或 npm.

窗口自动加载当前用户配置. 主题和窗口位置保存在 Electron `userData`. 同时只运行一个窗口; 再次启动会聚焦已有窗口.

从源码启动需要 Node.js 24 和 npm 11:

```powershell
npm ci
npm run dev
```

Windows 安装包可用 `npm run build:win` 生成, 产物在 `release/`:

- `release/win-unpacked/HarnessAlign.exe` 可直接运行
- `release/HarnessAlign-1.0.0-setup.exe` 是 NSIS 安装包

## 日常工作流

1. 在应用中编辑规则, Layer, Subagent 或 Skills, 点击 Save 保存.
2. 点击 Generate 校验配置并生成输出, 在 Generated 页查看结果.
3. 点击 Setup 重新生成并部署到当前用户已经存在的 Harness 根目录, 以及共享规则和项目 Skills.

Generate 和 Setup 使用当前 Layer 顺序与选项. 有未保存的源文件草稿时, 先点击 Save 或按 Ctrl+S, 再生成或部署.

## 桌面应用

桌面应用使用顶部命令栏和主从编辑布局. 窄窗口下侧栏自动收起为图标, 文件列表可调整宽度或折叠. Markdown 与 JSON 编辑器支持长文本和结构化内容.

窗口可以:

- 自动加载当前用户配置. 配置根目录固定, 界面不显示或提供修改入口.
- 在 Harnesses 页通过紧凑列表查看名称, 配置路径和 Subagent 文件格式, 点击 Edit 在侧边面板中编辑单个 Harness, 或使用 Add harness 新建. 路径相对当前用户目录, Setup 跳过尚不存在的目标目录.
- 在 Layers 页按 Group 管理 Layer 及其选项. Group 开关控制是否参与生成, Generate option 选择生成时使用的选项, 拖动 Group 名称或点击上下箭头调整顺序. 启用的 Group 按生成顺序排列, 未启用的 Group 排在后面. Add layer 创建空 Group, 添加 Option 后才能启用.
- 在 Rules 的 Inline 子页面编辑参与 `AGENTS.md` 的根规则, 在 Shared 子页面编辑独立部署的 shared-rules. Rule 和 Layer Option 的 Targets 都是严格白名单, 未选择任何 Harness 时不会对任何 Harness 生效.
- 在 Agents 页编辑共享正文, 按 Harness 切换原生 metadata, 并通过 Enable 选择需要生成该 Agent 的 Harness.
- 在 Skills 的 Registration 子页面注册 GitHub 仓库, 在 Library 子页面发现, 下载, 检查或应用更新, 从 `%USERPROFILE%\.agents\skills` 导入, 或移除已安装的项目 Skills.
- 在 Generated 页查看最近一次生成结果. 不要手工改这些文件.
- 使用当前未保存的 Layer 选择执行 Generate 和 Setup.
- 在 Settings 页设置生成 `AGENTS.md` 的一级标题, 切换主题.

Settings 页的 `AGENTS.md title` 只控制生成文档的一级标题. 点击顶部 Save 或按 Ctrl+S 后, 所有页面的草稿以及当前 Layer 顺序与选择会统一写回. 文件行的操作菜单和右键菜单中的 Save 只保存当前文件. 切换页面会保留草稿, 关闭有未保存修改的窗口时会提示确认.

关闭 Group 开关会立即移出当前生成序列, 保留源文件和编辑能力. 操作反馈统一显示在顶部; 点击生成或部署提示, 或顶部 Output 图标可查看完整输出. 工作区加载失败时可点击 Retry 重试.

Harness 编辑面板的 Save harness 只保存当前项. 关闭面板会保留草稿, 列表用 Unsaved 标记未保存项; Discard changes 放弃当前草稿. 新建草稿关闭后可通过 Continue new harness 继续编辑. 删除操作位于编辑面板内, 并需要再次确认. 保存 Harness 后再运行 Generate 或 Setup.

桌面应用不创建 `%USERPROFILE%` 下缺失的 Harness 根目录. Setup 只复制已经安装到 `.harness-align/skills/` 的 Skills.

Setup 先准备完整的替换内容, 再更新部署目标. 替换失败时尝试恢复原文件, 错误输出会指出未能恢复的目标和备份位置.

## 配置目录

配置固定保存在 `%USERPROFILE%\.harness-align`, 不可修改. 当新目录不存在且旧的 `%USERPROFILE%\.halign` 存在时, 应用自动将整个旧目录迁移到新路径, 保留配置, 规则, Layer, Agent, Skills 和生成文件的原始内容. 如果两个目录同时存在, 使用新目录并保留旧目录, 不自动合并或覆盖. 迁移拒绝符号链接和 junction.

用户配置 `%USERPROFILE%\.harness-align` 的核心结构如下:

```text
.harness-align\
├─ config.json
├─ rules\
│  └─ shared\
├─ layers\
│  └─ <layer>\
│     └─ <option>.md
├─ agents\
├─ skills\
│  ├─ index.json
│  └─ <skill-id>\
│     └─ SKILL.md
└─ generated\
```

- `config.json` 声明输出标题, 当前项目选用的 Layer, 以及要生成的 Harness.
- `rules/` 保存写入各 Harness `AGENTS.md` 的公共规则.
- `layers/` 保存可切换的 Markdown 选项. `config.json` 不必覆盖这里的全部目录.
- `rules/shared/` 保存部署到 `%USERPROFILE%\.agents\shared-rules` 的共享规则, 不进入生成的 `AGENTS.md`.
- `agents/` 保存 Subagent 的共享正文与各 Harness 原生 metadata.
- `skills/` 保存项目 Skills. `setup` 按 id 覆盖部署到用户 Skills 目录, 不复制 `index.json`.
- `generated/` 保存生成结果, 不应手工编辑.

## 配置文件

`.harness-align/config.json` 当前使用版本 `1`. 每个 Harness 必须声明名称, 相对用户主目录的配置路径, 以及 Subagent 输出格式.

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

Layer 字段:

| 字段 | 约束 | 用途 |
| --- | --- | --- |
| `name` | 匹配 `[a-z0-9][a-z0-9_-]*`, 忽略大小写后唯一 | `.harness-align/layers/<layer>/` 目录名 |
| `selected` | 匹配 `[a-z0-9][a-z0-9_-]*`, 且必须存在对应 `.md` 文件 | 保存的默认选项 |

`layers` 可以为空, 表示当前项目未选择任何 Layer. `.harness-align/layers/<layer>/` 目录构成 Layer 目录, 并允许暂时不包含 Option. 空 Layer 不能启用生成; 未写入 `config.json` 的 Layer 目录仍然有效, 只是不参与生成.

Harness 字段:

| 字段 | 约束 | 用途 |
| --- | --- | --- |
| `name` | 匹配 `[a-z0-9][a-z0-9_-]*`, 忽略大小写后唯一 | Rule `targets`, Agent `harnesses` 键和生成目录名 |
| `config_path` | 使用 `/` 的相对路径, 不允许绝对路径或 `..` | 相对于 `%USERPROFILE%` 的部署根目录 |
| `agent_format` | `toml` 或 `yaml` | Subagent metadata 序列化格式 |
| `agent_extension` | 不含点或路径分隔符 | 生成的 Subagent 文件扩展名 |
| `instructions_field` | TOML Harness 必填; YAML Harness 不使用 | 保存共享 Markdown 正文的 TOML 字段名 |

`config_path` 之间不能重叠, 也不能占用 `.agents/shared-rules`, `.agents/skills` 或 `.harness-align`. 可选的 `skill_sources` 用来登记 GitHub skill 仓库; 省略或 `[]` 表示没有远端源.

## 规则, Layer 与 Subagent

公共 Rule 先按 `priority` 排序, 再按每个 Harness 的 `targets` 严格白名单过滤. 手工源文件省略 `targets` 与写成 `targets: []` 含义相同, 都不对任何 Harness 生效; 要应用到全部 Harness, 必须显式列出所有 Harness 名称. 桌面应用保存时始终写入显式 `targets` 数组. 之后每个已选 Layer 按 `config.json` 中的顺序贡献一个选项文件.

Layer 选项是纯 Markdown, 也可以带只包含可选 `targets` 的 YAML frontmatter, 并遵循相同的严格白名单语义. Layer 文件不使用 `priority`, 允许空文件作为显式关闭:

```markdown
---
targets:
  - codex
  - cursor
---

# Soul

Arona soul content.
```

生成的 `AGENTS.md` 只有配置里的 `name` 这一个一级标题. 规则正文里, fenced code 之外的一至五级标题会降一级, 六级标题保持不变.

Subagent 文件使用公共 `name`, `description`, `harnesses` 和 Markdown 正文. 每个 Harness 块里的 metadata 没有字段白名单, 会按该 Harness 的格式原样写出. 同名字段可以覆盖该 Harness 输出中的公共 `name` 或 `description`. TOML Harness 的正文占用 `instructions_field`, 不要在 metadata 里重复声明这个字段.

## Skills

项目 Skills 放在 `.harness-align/skills/` 下, 每个 skill 一个目录, 并带 `SKILL.md`. `index.json` 记录来源, 不要手工编辑.

桌面应用可以从 Skills 的 Registration 子页面登记 GitHub 仓库, 再从 Library 子页面发现并安装 skill, 也可以从 `%USERPROFILE%\.agents\skills` 导入已有目录. Setup 把已经安装到项目里的 skill 覆盖部署到用户目录.

没有项目 Skills, 或 `.harness-align/skills/` 里只有 `index.json` 时, skills 部署会跳过并视为成功. shared-rules 仍然必需.

## 部署结果

`generate` 只更新 `%USERPROFILE%\.harness-align\generated`. 每个已声明 Harness 会得到一份 `AGENTS.md` 和对应格式的 `agents/` 文件.

`setup` 在生成之后:

- 更新 `%USERPROFILE%\<config_path>\AGENTS.md`
- 替换该目录下的 `agents/`. 当前没有生成 Subagent 时, 目标 `agents/` 会被替换为空目录
- 用 `.harness-align/rules/shared/` 完整替换 `%USERPROFILE%\.agents\shared-rules`
- 按 id 覆盖 `%USERPROFILE%\.agents\skills\<id>/`, 保留其他无关 skill, 也不复制 `index.json`

若某个 Harness 的根目录还不存在, Setup 会跳过它, 不会替你创建. 需要先由对应助手自己初始化那个目录.

## 安全说明

- 不要手工修改 `.harness-align/generated/`.
- `generate` 只删除它自己管理过, 且本次不再生成的文件, 不会删除未知文件.
- `setup` 会改真实用户配置. 确认目标 Harness 根目录已经存在, 并且就是你想更新的那一份.
- `setup` 不创建缺失的 Harness 根目录, 只更新配置中声明且已经存在的目标.
- 路径逃逸, symlink, junction 和其他 reparse point 会被拒绝.
- 配置或目标验证失败时, 应用停止后续写入, 并在日志区显示原因.

## 从源码构建

本仓库包含桌面应用及其生成部署引擎. 完整开发验证:

```powershell
npm ci
npm run verify
npm run build
```

`npm run verify` 会编译引擎, 类型检查桌面壳, 再运行测试.

实现约束, 模块职责和改动流程见 `AGENTS.md`.
