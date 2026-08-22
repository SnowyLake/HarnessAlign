# Harness Align

## 目录

- [项目简介](#项目简介)
- [工程与配置分离](#工程与配置分离)
- [环境要求](#环境要求)
- [安装与注册](#安装与注册)
- [使用方式](#使用方式)
- [桌面管理壳](#桌面管理壳)
- [配置目录](#配置目录)
- [配置文件](#配置文件)
- [运行原理](#运行原理)
- [工程目录](#工程目录)
- [开发与验证](#开发与验证)
- [依赖说明](#依赖说明)
- [安全边界](#安全边界)

## 项目简介

Harness Align 是一个使用 TypeScript 编写的本地 CLI, 并附带可选的 Electron 管理窗口. 它从统一的 `.halign` 配置为任意已声明 Harness 生成 `AGENTS.md` 与 Subagent 文件, 并能检查生成结果或部署到当前用户的 Harness 配置目录.

CLI 命令名是 `halign`. 工具成功时会输出简短摘要, 失败时返回非零退出码并给出错误原因. 桌面壳调用同一套生成与部署函数, 用来可视化管理 Rule, Agent, Layer, Harness, Skills 和配置字段.

## 工程与配置分离

工具工程与用户配置目录相互独立:

```text
D:\Workspace\AI\HarnessAlign\
├─ src\
│  ├─ engine\
│  ├─ main\
│  ├─ preload\
│  ├─ renderer\
│  └─ shared\
├─ tests\
├─ dist\
├─ out\
├─ node_modules\
├─ AGENTS.md
├─ README.md
├─ package.json
├─ package-lock.json
├─ .npmrc
├─ electron.vite.config.ts
└─ electron-builder.yml

C:\Users\fengh\OneDrive\Configs\AI\HarnessAlign\
├─ .agent-sessions\
├─ .halign\
├─ generate.cmd
└─ setup.cmd
```

`halign` 始终把执行命令时的当前工作目录作为配置根目录. 因此可以全局安装一份工具, 再从任意包含 `.halign` 的目录调用它. 桌面壳不使用安装目录, 启动后需要打开那个包含 `.halign` 的配置目录.

## 环境要求

- Windows PowerShell 或 CMD.
- Node.js 24. `package.json` 当前限制为 `>=24 <25`.
- npm 11. 本仓库以 `packageManager` 字段和 `package-lock.json` 锁定依赖.

## 安装与注册

首次安装或依赖变化后, 在工具工程目录执行:

```powershell
cd D:\Workspace\AI\HarnessAlign
npm ci
npm run build:engine
npm link
```

`npm ci` 根据 `package-lock.json` 安装完全一致的本地依赖. `npm run build:engine` 将 CLI 引擎编译到 `dist/`. `npm link` 根据 `package.json` 的 `bin` 字段创建全局 `halign` 命令, 但实际代码仍保留在本工具目录.

验证全局命令:

```powershell
halign --help
```

## 使用方式

进入包含 `.halign` 的配置目录后执行:

```powershell
cd C:\Users\fengh\OneDrive\Configs\AI\HarnessAlign
halign generate
halign check
halign setup
```

| 命令 | 功能 | 成功退出码 |
| --- | --- | --- |
| `halign generate` | 验证配置并更新 `.halign/generated/` | `0` |
| `halign check` | 检查生成目录是否与当前配置一致 | `0` |
| `halign setup` | 先生成, 再部署到当前用户已经启用的 Harness | `0` |
| `halign --help` | 显示命令用法 | `0` |

三个业务命令都支持通过可重复的 `--layer <layer>=<option>` 覆盖部分 Layer 选择:

```powershell
halign generate --layer soul=kei
halign check --layer soul=arona --layer workflow=fast
halign setup --layer soul=kei
```

未指定的 Layer 使用 `config.json` 中保存的 `selected`. 同一个 Layer 不得重复传入, 未知 Layer 或不存在的选项会直接报错.

`check` 发现缺失, 修改或额外文件时会列出差异并返回 `1`. 无效命令或参数返回 `2`. `generate` 和 `setup` 成功时会列出写入的文件以及目标目录.

配套配置目录中的 `generate.cmd` 和 `setup.cmd` 是便捷封装. 它们会切换到自身所在目录, 调用全局 `halign`, 保留退出码, 并通过 `pause` 防止窗口执行后立即关闭.

## 桌面管理壳

在工具工程目录执行:

```powershell
npm run dev
```

该命令使用 electron-vite 启动 Electron 开发窗口. Windows 安装包可用 `npm run build:win` 生成.

产物在 `release/`:

- `release/win-unpacked/HarnessAlign.exe` 可直接运行
- `release/HarnessAlign-1.0.0-setup.exe` 是 NSIS 安装包

窗口可以:

- 打开包含 `.halign` 的配置目录, 并记住上次路径和主题 (保存在 Electron `userData`, 不写入本仓库).
- 编辑 `config.json` 的标题, 有序 Layer 选择和 Harness 列表.
- 在 Project 页面 Layers 下方的 Skills 章节注册或移除 GitHub skill 仓库地址.
- 在 Layers 页面新建, 修改, 重命名或删除 Layer 及其选项; 在 Project 页面从已有 Layer 中选择添加, 拖拽顺序, 并为每个 Layer 选择一个选项.
- 在 Skills 页面发现, 下载, 检查或应用更新, 从 `%USERPROFILE%\.agents\skills` 导入, 或移除已安装的项目 Skills.
- 新建, 修改, 重命名或删除根 Rule, shared-rules 和 Subagent.
- 使用当前未保存的 Layer 选择执行 `Generate`, `Check` 和 `Setup`.
- 点击 Project 页面的 `Save` 后, 把当前 Layer 顺序与选择写回 `config.json`.

桌面壳不创建 `%USERPROFILE%` 下缺失的 Harness 根目录. `Setup` 的部署规则与 CLI 相同. Renderer 只通过 `window.appApi` 请求能力, 不直接访问文件系统. Skills 的 GitHub 下载与解压只发生在 Electron Main, CLI `setup` 只复制已存在的 `.halign/skills/`.

## 配置目录

一个配置目录的核心结构如下:

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

- `.halign/config.json` 定义格式版本, 输出标题, 有序 Layer 选择, Harness 配置和可选 `skill_sources`. `layers` 是项目选择, 不必覆盖 `.halign/layers` 下的全部目录.
- `.halign/rules/` 保存参与各 Harness `AGENTS.md` 的公共 Rule.
- `.halign/layers/<layer>/<option>.md` 保存一个 Layer 的可选 Markdown 文件. 每次生成从项目选中的每个 Layer 选择一个文件.
- `.halign/rules/shared/` 保存独立部署到 `%USERPROFILE%\.agents\shared-rules` 的共享规则.
- `.halign/skills/` 保存项目 Skills; `setup` 按 id 覆盖部署到 `%USERPROFILE%\.agents\skills\<id>\`, 不复制 `index.json`, 也不删除无关兄弟目录.
- `.halign/agents/` 保存 Subagent 的共享正文与各 Harness 原生 metadata.
- `.halign/generated/` 保存生成结果和所有权 manifest, 不应手工编辑. Skills 不进入生成 manifest.

## 配置文件

`.halign/config.json` 在当前本地开发阶段使用版本 `1`. 每个 Harness 必须声明名称, 用户配置路径和 Subagent 输出格式.

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

Layer 配置字段如下:

| 字段 | 约束 | 用途 |
| --- | --- | --- |
| `name` | 匹配 `[a-z0-9][a-z0-9_-]*` 且忽略大小写后唯一 | `.halign/layers/<layer>/` 目录名, UI 与 CLI 标识符 |
| `selected` | 匹配 `[a-z0-9][a-z0-9_-]*` 且必须存在对应 `.md` 文件 | CLI 无覆盖参数时使用的项目选择 |

`layers` 可以为空, 表示当前项目未选择任何 Layer. `.halign/layers/<layer>/` 目录构成 Layer 目录, 每个目录必须至少包含一个直接 `.md` 文件. 未写入 `config.json` 的 Layer 目录仍然有效, 只是不参与生成. 非 Markdown 文件, 嵌套目录, symlink 和 junction 都会导致加载失败.

Layer 选项是纯 Markdown, 也可以使用只包含可选 `targets` 的 YAML frontmatter. Layer 文件不使用 `priority`, 允许空文件作为显式 no-op:

```markdown
---
targets:
  - codex
  - cursor
---

# Soul

Arona soul content.
```

公共 Rule 先按 UI 写入的 `priority` 排序, 然后每个已选 Layer 按 `config.json` 或当前 Project 界面的顺序贡献一个选项文件. Layer 选项自身没有内部排序.

Harness 配置字段如下:

| 字段 | 约束 | 用途 |
| --- | --- | --- |
| `name` | 匹配 `[a-z0-9][a-z0-9_-]*` 且忽略大小写后唯一 | Rule `targets`, Agent `harnesses` 键和生成目录名 |
| `config_path` | 使用 `/` 的规范化相对路径, 不允许绝对路径, `..`, Harness 间路径重叠或占用 `.agents/shared-rules` / `.agents/skills` | 相对于 `%USERPROFILE%` 的部署根目录 |
| `agent_format` | `toml` 或 `yaml` | Subagent metadata 序列化格式 |
| `agent_extension` | 不含点或路径分隔符的安全扩展名 | 生成的 Subagent 文件扩展名 |
| `instructions_field` | TOML Harness 必填, 匹配 `[a-z0-9][a-z0-9_-]*` 且不是 `name` 或 `description`; YAML Harness 不使用 | 保存共享 Markdown 正文的 TOML 字段名 |

Subagent 文件仍使用公共 `name`, `description`, `harnesses` 和 Markdown 正文. 每个 Harness 块中的 metadata 不再有字段白名单, 所有标量, 数组和嵌套映射都会交给对应格式的序列化器. Harness metadata 在公共 `name` 和 `description` 之后合并, 因而同名字段可以覆盖该 Harness 输出中的公共值. TOML Harness 配置的 `instructions_field` 由 Markdown 正文占用, 不允许在 metadata 中重复声明.

## 运行原理

1. npm 通过全局 bin 启动 `dist/src/engine/Halign.js`, 或通过 `npm run dev` 启动 `out/main/index.js`.
2. CLI 使用 `process.cwd()` 确定当前配置根目录. 桌面壳使用用户选择的目录.
3. 读取并验证 `.halign/config.json`, Root Rule, Layer 目录和 Subagent metadata.
4. 合并有序 Root Rule 与当前 Layer 选择, 再按 Harness 名称和 Subagent 格式构建确定性的内存输出.
5. `generate` 在完整预检后原子写入变化文件, 清理 manifest 管理的过期文件, 最后提交新 manifest.
6. `check` 重新构建期望输出并按字节比较实际生成目录.
7. `setup` 先执行生成, 再对用户部署目标完成路径与 reparse point 预检, 最后替换已启用 Harness 的文件, 完整替换 `shared-rules`, 并按 id 覆盖部署项目 Skills.
8. 桌面壳对 Rule / Agent / Config / Skills 的保存走 `src/engine/Edit.ts` 与 Main 侧 `SkillRemoteService`: Renderer 调用 `window.appApi`, Main 校验后调用引擎或下载解压, 再原子写入 `.halign` 源文件.

源码采用 ESM. CLI 入口会解析 `npm link` 目录联接后的真实路径, 从而正确区分直接执行与被测试代码 `import` 的情况.

## 工程目录

- `src/engine/` 是 CLI 生产引擎 (`Model`, `FsSafe`, `Load`, `Render`, `Generate`, `Skills`, `Setup`, `Edit`, `Halign`).
- `src/main/`, `src/preload/`, `src/renderer/`, `src/shared/` 是 Electron 桌面壳. Renderer 只通过 `window.appApi` 访问引擎. Skills 下载使用 Main 侧 `fflate`.
- `tests/Halign.test.ts` 使用 Node 内置 `node:test`, 覆盖解析, 渲染, 生成, 检查, 部署, Skills, 源文件写回和路径安全.
- `dist/src/engine/Halign.js` 是全局 `halign` 实际执行的编译结果.
- `dist/tests/Halign.test.js` 是测试编译结果.
- `out/` 是 electron-vite 编译结果.
- `node_modules/` 保存项目本地依赖.
- `package.json` 定义 scripts, Node 版本, `packageManager`, 依赖和全局命令入口.
- `.npmrc` 对 npm 启用严格的 Node.js 和 npm 版本检查, `package.json` 的 `preinstall` 拒绝用其他包管理器安装.
- `package-lock.json` 锁定完整依赖树.
- `tsconfig.engine.json` 编译 CLI 引擎和测试. `tsconfig.node.json` 与 `tsconfig.web.json` 分别检查 Main/Preload 和 Renderer.
- `electron.vite.config.ts` 构建桌面壳. `electron-builder.yml` 定义 Windows NSIS 打包.
- `AGENTS.md` 定义本工程的自动化开发约束.

## 开发与验证

安装完全一致的依赖:

```powershell
npm ci
```

只进行类型检查:

```powershell
npm run typecheck
```

构建并运行测试:

```powershell
npm run test
```

执行完整开发验证:

```powershell
npm run verify
```

`npm run verify` 先编译引擎并类型检查 Main/Preload 与 Renderer, 再运行测试, 引擎只编译一次. `npm run typecheck` 检查引擎, Main/Preload 和 Renderer. `npm run test` 会先编译引擎, 再运行 `dist/tests/Halign.test.js`. `npm run build` 构建桌面壳.

启动桌面壳:

```powershell
npm run dev
```

修改 `package.json` 的 `bin` 路径或移动 CLI 入口后, 必须重新执行:

```powershell
npm link
```

然后从外部配置目录运行 `halign generate` 和 `halign check`, 确认全局 shim 指向最新编译结果.

## 依赖说明

运行时直接依赖包括:

- `yaml`, 用于读取和生成 YAML frontmatter.
- `smol-toml`, 用于生成可配置 TOML Harness 的任意 metadata.
- React, Zustand, Zod, Tailwind 和 Base UI, 用于桌面壳.
- `fflate`, 仅 Electron Main 用于解压 GitHub skill zip; 不进入 CLI 引擎运行时.

开发依赖包括:

- `@typescript/native` 通过 npm alias 提供 TypeScript 7 编译器, `typescript` 通过 npm alias 提供 TypeScript 6 API, 供 typescript-eslint 在 TypeScript 7 过渡期使用.
- `@types/node`, Node.js API 的类型声明.
- `electron`, `electron-vite`, `electron-builder`, 桌面壳运行时与打包.

`package-lock.json` 中出现的其他 package 是上述直接依赖的传递依赖或平台支持 package. 它们由 npm 自动解析, 不代表项目代码直接使用了它们.

## 安全边界

- 不要手工修改 `.halign/generated/`, `dist/` 或 `out/`.
- `generate` 只删除 manifest 明确管理的过期文件, 不删除未知文件.
- `generate` 和 `setup` 会拒绝路径逃逸, symlink, junction 和其他 reparse point 风险.
- `setup` 会修改真实用户配置. 日常开发测试必须使用临时 `USERPROFILE`, 不得直接覆盖真实配置.
- `setup` 不创建缺失的 Harness 根目录, 只更新配置中声明且已经存在的 Harness.
- `setup` 对 Skills 按目录覆盖同名 id, 保留 `%USERPROFILE%\.agents\skills` 下的其他兄弟目录.
- 源文件或部署目标验证失败时, CLI 返回非零退出码并停止后续写入. 桌面壳把同一错误显示在日志区, 不写文件.
- 桌面壳记住的上次配置目录只存在于 Electron `userData`.
