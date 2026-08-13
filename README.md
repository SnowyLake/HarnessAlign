# Harness Align

## 目录

- [项目简介](#项目简介)
- [工程与配置分离](#工程与配置分离)
- [环境要求](#环境要求)
- [安装与注册](#安装与注册)
- [使用方式](#使用方式)
- [配置目录](#配置目录)
- [配置文件](#配置文件)
- [运行原理](#运行原理)
- [工程目录](#工程目录)
- [开发与验证](#开发与验证)
- [依赖说明](#依赖说明)
- [安全边界](#安全边界)

## 项目简介

Harness Align 是一个使用 TypeScript 编写的本地 CLI. 它从统一的 `.halign` 配置为任意已声明 Harness 生成 `AGENTS.md` 与 Subagent 文件, 并能检查生成结果或部署到当前用户的 Harness 配置目录.

CLI 命令名是 `halign`. 工具成功时会输出简短摘要, 失败时返回非零退出码并给出错误原因.

## 工程与配置分离

工具工程与用户配置目录相互独立:

```text
D:\Workspace\AI\harness-align\
├─ src\
├─ tests\
├─ dist\
├─ node_modules\
├─ AGENTS.md
├─ README.md
├─ package.json
├─ package-lock.json
└─ tsconfig.json

C:\Users\fengh\OneDrive\Configs\AI\HarnessAlign\
├─ .agent-sessions\
├─ .halign\
├─ generate.cmd
└─ setup.cmd
```

`halign` 始终把执行命令时的当前工作目录作为配置根目录. 因此可以全局安装一份工具, 再从任意包含 `.halign` 的目录调用它.

## 环境要求

- Windows PowerShell 或 CMD.
- Node.js 24. `package.json` 当前限制为 `>=24 <25`.
- npm 11 或与 Node.js 24 配套的兼容版本.

## 安装与注册

首次安装或依赖变化后, 在工具工程目录执行:

```powershell
cd D:\Workspace\AI\harness-align
npm ci
npm run build
npm link
```

`npm ci` 根据 `package-lock.json` 安装本地依赖. `npm run build` 将 TypeScript 编译到 `dist/`. `npm link` 根据 `package.json` 的 `bin` 字段创建全局 `halign` 命令, 但实际代码仍保留在本工具目录.

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

三个业务命令都支持选择 Profile:

```powershell
halign generate --profile kei
halign check --profile=kei
halign setup --profile kei
```

`check` 发现缺失, 修改或额外文件时会列出差异并返回 `1`. 无效命令或参数返回 `2`. `generate` 和 `setup` 成功时会列出写入的文件以及目标目录.

配套配置目录中的 `generate.cmd` 和 `setup.cmd` 是便捷封装. 它们会切换到自身所在目录, 调用全局 `halign`, 保留退出码, 并通过 `pause` 防止窗口执行后立即关闭.

## 配置目录

一个配置目录的核心结构如下:

```text
.halign\
├─ config.json
├─ rules\
│  └─ shared\
├─ domains\
│  └─ <profile>\rules\
├─ agents\
└─ generated\
```

- `.halign/config.json` 定义格式版本, 输出标题, 默认 Profile, 可用 Profile 和 Harness 配置.
- `.halign/rules/` 保存参与各 Harness `AGENTS.md` 的公共 Rule.
- `.halign/domains/<profile>/rules/` 保存 Profile 专属 Rule.
- `.halign/rules/shared/` 保存独立部署到 `%USERPROFILE%\.agents\shared-rules` 的共享规则.
- `.halign/agents/` 保存 Subagent 的共享正文与各 Harness 原生 metadata.
- `.halign/generated/` 保存生成结果和所有权 manifest, 不应手工编辑.

## 配置文件

`.halign/config.json` 当前使用版本 `2`. 版本 `1` 的字符串 Harness 数组不再接受, 每个 Harness 必须声明名称, 用户配置路径和 Subagent 输出格式.

```json
{
  "version": 2,
  "name": "AGENTS",
  "default_profile": "arona",
  "profiles": ["arona", "kei"],
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

Harness 配置字段如下:

| 字段 | 约束 | 用途 |
| --- | --- | --- |
| `name` | 匹配 `[a-z0-9][a-z0-9_-]*` 且忽略大小写后唯一 | Rule `targets`, Agent `harnesses` 键和生成目录名 |
| `config_path` | 使用 `/` 的规范化相对路径, 不允许绝对路径, `..`, Harness 间路径重叠或占用 `.agents/shared-rules` | 相对于 `%USERPROFILE%` 的部署根目录 |
| `agent_format` | `toml` 或 `yaml` | Subagent metadata 序列化格式 |
| `agent_extension` | 不含点或路径分隔符的安全扩展名 | 生成的 Subagent 文件扩展名 |
| `instructions_field` | TOML Harness 必填, 匹配 `[a-z0-9][a-z0-9_-]*` 且不是 `name` 或 `description`; YAML Harness 不使用 | 保存共享 Markdown 正文的 TOML 字段名 |

Subagent 文件仍使用公共 `name`, `description`, `harnesses` 和 Markdown 正文. 每个 Harness 块中的 metadata 不再有字段白名单, 所有标量, 数组和嵌套映射都会交给对应格式的序列化器. Harness metadata 在公共 `name` 和 `description` 之后合并, 因而同名字段可以覆盖该 Harness 输出中的公共值. TOML Harness 配置的 `instructions_field` 由 Markdown 正文占用, 不允许在 metadata 中重复声明.

## 运行原理

1. npm 通过全局 shim 启动 `dist/src/halign.js`.
2. CLI 使用 `process.cwd()` 确定当前配置根目录.
3. 读取并验证 `.halign/config.json`, Rule frontmatter, Profile 和 Subagent metadata.
4. 按配置的 Harness 名称和 Subagent 格式构建确定性的内存输出.
5. `generate` 在完整预检后原子写入变化文件, 清理 manifest 管理的过期文件, 最后提交新 manifest.
6. `check` 重新构建期望输出并按字节比较实际生成目录.
7. `setup` 先执行生成, 再对用户部署目标完成路径与 reparse point 预检, 最后替换已启用 Harness 的文件.

源码采用 ESM. CLI 入口会解析 `npm link` 目录联接后的真实路径, 从而正确区分直接执行与被测试代码 `import` 的情况.

## 工程目录

- `src/` 按数据流拆分生产实现 (`model`, `fs-safe`, `load`, `render`, `generate`, `setup`), `halign.ts` 是 CLI 入口; 关键边界保留面向 TypeScript 初学者的中文教学注释.
- `tests/halign.test.ts` 使用 Node 内置 `node:test`, 覆盖解析, 渲染, 生成, 检查, 部署和路径安全.
- `dist/src/halign.js` 是全局 `halign` 实际执行的编译结果.
- `dist/tests/halign.test.js` 是测试编译结果.
- `node_modules/` 保存项目本地依赖.
- `package.json` 定义 scripts, Node 版本, 依赖和全局命令入口.
- `package-lock.json` 锁定完整依赖树.
- `tsconfig.json` 定义严格 TypeScript 编译规则.
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
npm test
```

执行完整开发验证:

```powershell
npm run verify
```

`npm run verify` 依次执行类型检查和测试. `npm test` 会先编译 `src/` 与 `tests/`, 再运行 `dist/tests/halign.test.js`.

修改 `package.json` 的 `bin` 路径或移动 CLI 入口后, 必须重新执行:

```powershell
npm link
```

然后从外部配置目录运行 `halign generate` 和 `halign check`, 确认全局 shim 指向最新编译结果.

## 依赖说明

运行时直接依赖包括:

- `yaml`, 用于读取和生成 YAML frontmatter.
- `smol-toml`, 用于生成可配置 TOML Harness 的任意 metadata.

开发依赖包括:

- `typescript`, TypeScript 编译器.
- `@types/node`, Node.js API 的类型声明.

`package-lock.json` 中出现的其他 package 是上述直接依赖的传递依赖或平台支持 package. 它们由 npm 自动解析, 不代表项目代码直接使用了它们.

## 安全边界

- 不要手工修改 `.halign/generated/` 或 `dist/`.
- `generate` 只删除 manifest 明确管理的过期文件, 不删除未知文件.
- `generate` 和 `setup` 会拒绝路径逃逸, symlink, junction 和其他 reparse point 风险.
- `setup` 会修改真实用户配置. 日常开发测试必须使用临时 `USERPROFILE`, 不得直接覆盖真实配置.
- `setup` 不创建缺失的 Harness 根目录, 只更新配置中声明且已经存在的 Harness.
- 源文件或部署目标验证失败时, CLI 返回非零退出码并停止后续写入.
