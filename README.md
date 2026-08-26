# Harness Align

## 目录

- [这是什么](#这是什么)
- [开始使用](#开始使用)
- [日常工作流](#日常工作流)
- [命令](#命令)
- [桌面应用](#桌面应用)
- [配置目录](#配置目录)
- [配置文件](#配置文件)
- [规则, Layer 与 Subagent](#规则-layer-与-subagent)
- [Skills](#skills)
- [部署结果](#部署结果)
- [安全说明](#安全说明)
- [从源码构建](#从源码构建)

## 这是什么

Harness Align 让你用一份 `.halign` 配置, 为多个编码助手生成各自需要的 `AGENTS.md` 和 Subagent 文件.

Cursor, Codex, OpenCode 等工具都要读项目规则, 但目录位置和 Subagent 格式并不相同. 你在一个配置目录里维护公共规则, 可选 Layer 和共享 Subagent 正文, 然后由 `halign` 按每个 Harness 的格式写出结果, 再部署到当前用户已经启用的助手目录.

CLI 命令名是 `halign`. 桌面应用 Harness Align 编辑同一份配置, 并调用同一套生成, 检查和部署能力.

本仓库只提供工具, 不保存你的 `.halign` 配置. 每个用户只有一份配置, 固定放在 `%USERPROFILE%\.halign`, 与工具安装目录相互独立. 第一次运行 CLI 或打开桌面应用时, 如果该目录还不存在, 工具会创建它并写入默认 `config.json`.

## 开始使用

需要 Windows, Node.js 24 和 npm 11.

在工具工程目录安装并注册全局命令:

```powershell
npm ci
npm run build:engine
npm link
```

确认命令可用:

```powershell
halign --help
```

命令始终读写 `%USERPROFILE%\.halign`, 不依赖当前工作目录:

```powershell
halign generate
halign check
halign setup
```

也可以在工具工程目录启动桌面应用:

```powershell
npm run dev
```

窗口打开同一份用户配置. 主题和窗口位置保存在 Electron `userData`, 不会写入本仓库或 `%USERPROFILE%\.halign`. 同时只运行一个窗口; 再次启动会聚焦已有窗口.

Windows 安装包可用 `npm run build:win` 生成, 产物在 `release/`:

- `release/win-unpacked/HarnessAlign.exe` 可直接运行
- `release/HarnessAlign-1.0.0-setup.exe` 是 NSIS 安装包

## 日常工作流

1. 编辑 `%USERPROFILE%\.halign` 里的规则, Layer, Subagent 或 Skills. 可以用桌面应用, 也可以直接改文件.
2. 运行 `halign generate`, 或在窗口里点 Generate. 工具会校验配置, 并把结果写到 `%USERPROFILE%\.halign\generated`.
3. 运行 `halign check` 确认生成目录与当前配置一致. 适合在提交前做一次核对.
4. 运行 `halign setup` 把结果部署到当前用户已经存在的 Harness 根目录, 以及共享规则和项目 Skills.

`halign` 始终使用 `%USERPROFILE%` 作为配置根目录. 因此可以全局安装一份工具, 从任意工作目录调用它. 桌面应用打开同一份用户配置, 不再选择目录.

## 命令

| 命令 | 作用 | 成功退出码 |
| --- | --- | --- |
| `halign generate` | 校验配置并更新 `.halign/generated/` | `0` |
| `halign check` | 检查生成目录是否与当前配置一致 | `0` |
| `halign setup` | 先生成, 再部署到当前用户已经启用的 Harness | `0` |
| `halign --help` | 显示命令用法 | `0` |
| `halign --version` | 打印工具版本 | `0` |

三个业务命令都支持用可重复的 `--layer <layer>=<option>` 临时覆盖部分 Layer 选择:

```powershell
halign generate --layer soul=kei
halign check --layer soul=arona --layer workflow=fast
halign setup --layer soul=kei
```

未指定的 Layer 使用 `config.json` 里保存的选择. 同一个 Layer 不能重复传入; 未知 Layer 或不存在的选项会直接报错.

`check` 发现缺失, 修改或额外文件时会列出差异并返回 `1`. 无效命令或参数返回 `2`. 配置错误和其他领域错误返回 `1`, 并在 stderr 给出原因. `generate` 和 `setup` 成功时会列出写入的文件以及目标目录.

## 桌面应用

桌面应用采用简洁一致的现代界面, 使用顶部工作区命令栏, 横向模块导航, Home 数据概览和业务页主从编辑布局. 蓝色仅用于关键动作, 选中状态和反馈; Markdown 与 JSON 编辑器适合处理长文本和结构化内容.

窗口可以:

- 打开 `%USERPROFILE%\.halign` 这份用户配置.
- 在 Home 页编辑输出标题, Harness 列表, 以及当前项目选用的 Layer 顺序与选项.
- 在 Layers 页新建, 修改, 重命名或删除 Layer 及其选项.
- 在 Rules 页编辑参与 `AGENTS.md` 的根规则, 以及独立部署的 shared-rules.
- 在 Agents 页编辑共享正文, 并在单一 metadata 编辑器中按 Harness 切换各自的原生 metadata.
- 在 Skills 页从已注册的 GitHub 仓库发现, 下载, 检查或应用更新, 从 `%USERPROFILE%\.agents\skills` 导入, 或移除已安装的项目 Skills.
- 在 Generated 页查看最近一次生成结果. 不要手工改这些文件.
- 使用当前未保存的 Layer 选择执行 Generate, Check 和 Setup.
- 在 Settings 页切换主题, 或打开 `%USERPROFILE%\.halign`.

Home 页 Layers 下方可以注册或移除 GitHub skill 仓库地址. 点击顶部 Save 或按 Ctrl+S 后, 所有页面的草稿以及当前 Layer 顺序与选择会统一写回. 编辑树标签的右键 Save 仍只保存该标签, 不绑定 Ctrl+S.

桌面应用不创建 `%USERPROFILE%` 下缺失的 Harness 根目录. Setup 的部署规则与 CLI 相同. Skills 的 GitHub 下载只发生在桌面应用里; CLI 的 `setup` 只复制已经存在于 `.halign/skills/` 的内容.

## 配置目录

用户配置 `%USERPROFILE%\.halign` 的核心结构如下:

```text
.halign\
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

`.halign/config.json` 当前使用版本 `1`. 每个 Harness 必须声明名称, 相对用户主目录的配置路径, 以及 Subagent 输出格式.

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
| `name` | 匹配 `[a-z0-9][a-z0-9_-]*`, 忽略大小写后唯一 | `.halign/layers/<layer>/` 目录名 |
| `selected` | 匹配 `[a-z0-9][a-z0-9_-]*`, 且必须存在对应 `.md` 文件 | 未传 `--layer` 时使用的项目选择 |

`layers` 可以为空, 表示当前项目未选择任何 Layer. `.halign/layers/<layer>/` 目录构成 Layer 目录, 每个目录必须至少包含一个直接 `.md` 文件. 未写入 `config.json` 的 Layer 目录仍然有效, 只是不参与生成.

Harness 字段:

| 字段 | 约束 | 用途 |
| --- | --- | --- |
| `name` | 匹配 `[a-z0-9][a-z0-9_-]*`, 忽略大小写后唯一 | Rule `targets`, Agent `harnesses` 键和生成目录名 |
| `config_path` | 使用 `/` 的相对路径, 不允许绝对路径或 `..` | 相对于 `%USERPROFILE%` 的部署根目录 |
| `agent_format` | `toml` 或 `yaml` | Subagent metadata 序列化格式 |
| `agent_extension` | 不含点或路径分隔符 | 生成的 Subagent 文件扩展名 |
| `instructions_field` | TOML Harness 必填; YAML Harness 不使用 | 保存共享 Markdown 正文的 TOML 字段名 |

`config_path` 之间不能重叠, 也不能占用 `.agents/shared-rules`, `.agents/skills` 或 `.halign`. 可选的 `skill_sources` 用来登记 GitHub skill 仓库; 省略或 `[]` 表示没有远端源.

## 规则, Layer 与 Subagent

公共 Rule 先按 `priority` 排序, 再按每个 Harness 的 `targets` 过滤. 之后每个已选 Layer 按 `config.json` 中的顺序贡献一个选项文件.

Layer 选项是纯 Markdown, 也可以带只包含可选 `targets` 的 YAML frontmatter. Layer 文件不使用 `priority`, 允许空文件作为显式关闭:

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

项目 Skills 放在 `.halign/skills/` 下, 每个 skill 一个目录, 并带 `SKILL.md`. `index.json` 记录来源, 不要手工编辑.

桌面应用可以从 Home 页登记的 GitHub 仓库发现并安装 skill, 也可以从 `%USERPROFILE%\.agents\skills` 导入已有目录. CLI 不会联网下载 skill; `halign setup` 只把已经安装到项目里的 skill 覆盖部署到用户目录.

没有项目 Skills, 或 `.halign/skills/` 里只有 `index.json` 时, skills 部署会跳过并视为成功. shared-rules 仍然必需.

## 部署结果

`generate` 只更新 `%USERPROFILE%\.halign\generated`. 每个已声明 Harness 会得到一份 `AGENTS.md` 和对应格式的 `agents/` 文件.

`setup` 在生成之后:

- 更新 `%USERPROFILE%\<config_path>\AGENTS.md`
- 替换该目录下的 `agents/`. 当前没有生成 Subagent 时, 目标 `agents/` 会被替换为空目录
- 用 `.halign/rules/shared/` 完整替换 `%USERPROFILE%\.agents\shared-rules`
- 按 id 覆盖 `%USERPROFILE%\.agents\skills\<id>/`, 保留其他无关 skill, 也不复制 `index.json`

若某个 Harness 的根目录还不存在, Setup 会跳过它, 不会替你创建. 需要先由对应助手自己初始化那个目录.

## 安全说明

- 不要手工修改 `.halign/generated/`.
- `generate` 只删除它自己管理过, 且本次不再生成的文件, 不会删除未知文件.
- `setup` 会改真实用户配置. 确认目标 Harness 根目录已经存在, 并且就是你想更新的那一份.
- `setup` 不创建缺失的 Harness 根目录, 只更新配置中声明且已经存在的目标.
- 路径逃逸, symlink, junction 和其他 reparse point 会被拒绝.
- 配置或目标验证失败时, CLI 停止后续写入并返回非零退出码. 桌面应用把同一错误显示在日志区, 不写文件.

## 从源码构建

本仓库同时包含 CLI 引擎和桌面应用. 完整开发验证:

```powershell
npm ci
npm run verify
npm run build
```

`npm run verify` 会编译引擎, 类型检查桌面壳, 再运行测试. 修改 `package.json` 的 `bin` 路径或移动 CLI 入口后, 需要重新执行 `npm link`.

实现约束, 模块职责和改动流程见 `AGENTS.md`.
