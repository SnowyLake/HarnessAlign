# Harness Align

## 目录

- [项目边界](#项目边界)
- [目录职责](#目录职责)
- [命令契约](#命令契约)
- [实现约束](#实现约束)
- [生成规则](#生成规则)
- [修改流程](#修改流程)
- [验证命令](#验证命令)
- [部署安全](#部署安全)
- [语言与文档](#语言与文档)

## 项目边界

- 本仓库实现独立的 `halign` TypeScript CLI, 不保存用户的 `.halign` 配置源.
- CLI 必须以调用者的当前工作目录作为配置根目录. 不得把工具安装目录或源码目录当作配置根目录.
- 行为验证以 `tests/` 中的临时目录用例为准, 不依赖仓库外任何配置或路径.
- 只实现 Codex, Cursor 和 OpenCode 已明确需要的能力. 不为未经需求证明的 Harness, 插件, 模板或扩展点预留抽象.

## 目录职责

- `src/` 按数据流拆分生产实现, 不拆分 package, 不创建单实现抽象或 renderer registry:
  - `model.ts` — 领域类型, 常量, `HalignError`, 收窄 helper
  - `fs-safe.ts` — 路径 containment, reparse 拒绝, UTF-8 读, 原子写入
  - `load.ts` — 配置 / Rule / Agent 发现与验证
  - `render.ts` — Markdown 标题降级, TOC, Codex / Cursor / OpenCode 渲染
  - `generate.ts` — `buildOutputs`, manifest, `generate`, `check`
  - `setup.ts` — 部署到已存在的用户 Harness 根目录
  - `halign.ts` — ESM CLI 入口, 并对测试 re-export 公开 API
- `tests/halign.test.ts` 是唯一测试源文件, 使用 Node 内置 `node:test` 覆盖解析, 渲染, 生成, 检查, 部署和路径安全.
- `dist/` 是 `tsc` 生成的 JavaScript 输出, 镜像 `src/` 与 `tests/`. CLI 入口仍是 `dist/src/halign.js`. 不得手工编辑.
- `node_modules/` 保存本地依赖, 由 npm 根据 `package-lock.json` 管理. 不得手工编辑或提交其内部文件.
- `package.json` 定义 ESM package, Node 版本, `halign` 可执行入口, scripts 和直接依赖.
- `package-lock.json` 锁定完整依赖树. 依赖变化时使用 npm 更新, 不手工拼改.
- `tsconfig.json` 使用 `NodeNext`, `ES2023` 和严格类型检查, 将 `src/` 与 `tests/` 编译到 `dist/`.
- `README.md` 面向使用者说明安装, 命令, 运行原理和开发验证.
- `AGENTS.md` 是本仓库的开发约束, 不属于 HALIGN 生成结果.

## 命令契约

- `halign generate [--profile <profile>]` 验证配置并更新当前目录下的 `.halign/generated/`, 成功时输出受管理文件数量.
- `halign check [--profile <profile>]` 比较期望输出与 `.halign/generated/`, 一致时输出成功摘要并返回 `0`, 存在差异时列出差异并返回 `1`.
- `halign setup [--profile <profile>]` 先生成, 再把结果部署到当前用户已经存在的 Harness 根目录, 成功时输出部署摘要.
- 无效命令或参数输出 usage 并返回 `2`. 领域错误输出到 stderr 并返回 `1`.
- `package.json` 的 `bin.halign` 必须指向 `dist/src/halign.js`. 修改入口路径后必须重新执行 `npm link`.
- ESM 入口判断必须先解析 `npm link` 产生的真实路径, 避免目录联接导致 `main()` 未执行.

## 实现约束

- 支持 Node 24, 当前 `engines` 范围是 `>=24 <25`.
- Runtime 仅使用 `yaml`. `typescript`, `@types/node` 和 `smol-toml` 仅用于开发或测试.
- 优先复用现有函数和数据流. 不创建 renderer registry, dependency injection, 通用模板系统或单实现接口.
- 输入必须先完整验证, 再修改 `.halign/generated/` 或用户部署目录.
- 保持 UTF-8 without BOM, LF 和确定性排序.
- 保持 symbolic link, junction, 路径逃逸, manifest 管理范围和单文件原子写入安全检查.
- 错误信息必须包含足以定位问题的文件路径, 字段, 实际值和期望约束.
- CLI 输出只放在 `main()` 边界. 可复用领域函数通过返回值或异常表达结果, 不直接写终端.

## 生成规则

- `.halign/config.json` 定义版本, 输出标题, Profile 和 Harness 列表.
- `.halign/rules/` 中的根 Rule 按 `(priority, repository_relative_path)` 排序, 再按 Harness targets 独立过滤.
- `.halign/domains/<profile>/rules/` 只加载当前选中的 Profile.
- `.halign/rules/shared/` 是独立部署的共享规则, 不参与 `AGENTS.md` 渲染, 不出现在生成 manifest 中.
- `.halign/agents/` 中的 Subagent 共享 Markdown body, 但保留 Codex, Cursor 和 OpenCode 各自的原生 metadata.
- 生成的 `AGENTS.md` 只允许配置的 `name` 产生一个一级标题.
- Rule 中 fenced code 之外的一至五级 ATX 标题必须降一级, 六级标题保持不变.
- Codex `developer_instructions` 使用 TOML 多行字符串, 不得将正文换行写成字面量 `\n`.
- 只删除旧 manifest 记录且本次不再生成的文件. 不删除 manifest 未管理的文件.
- 所有新文件写入与 stale 删除成功后, 才写入新的 manifest.

## 修改流程

1. 阅读目标文件及其所有调用点, 确认真实数据流, CLI 边界和失败边界.
2. 实施满足需求的最小改动, 不做无关重构.
3. 为新增分支, 解析规则或安全行为在 `tests/halign.test.ts` 补充一个最小可运行测试.
4. 运行 `npm run verify`.
5. 重新注册或修改 CLI 入口时运行 `npm link`.

## 验证命令

```powershell
npm ci
npm run verify
npm link
```

- `npm run verify` 等价于先执行 `npm run typecheck`, 再执行 `npm test`.
- `npm test` 会先构建, 再使用 `node --test` 运行 `dist/tests/halign.test.js`.
- 本仓库根目录不包含 `.halign`, 不得用 npm script 包装 `generate`, `check` 或 `setup`; 这些命令的行为由 `tests/` 用临时目录覆盖.
- Windows sandbox 可能阻止 Node test runner 创建子进程. 发生真实权限错误时在获得权限后复跑, 不修改测试绕过边界.

## 部署安全

- `generate` 只更新调用目录中的 `.halign/generated/`.
- `setup` 只更新用户已经启用且根目录已经存在的 Codex, Cursor 和 OpenCode. 不因部署而创建缺失的 Harness 根目录.
- 对已启用 Harness, `setup` 替换其 `agents` 目录并更新根 `AGENTS.md`.
- `setup` 还会更新 `%USERPROFILE%\.agents\shared-rules`.
- 部署前必须验证解析后的目标位于 `USERPROFILE` 或项目生成目录内, 并拒绝既有 symlink 或 junction.
- `setup` 相关验证只使用测试构造的临时 `USERPROFILE`, 不触碰开发机上的真实用户目录.
- 不递归删除含有 reparse point 的部署目标.

## 语言与文档

- 代码使用英文. TypeScript 教学注释使用中文, 面向熟练 C++ 或 C# 但初次接触 TypeScript 的高级开发者, 重点解释类型系统, ESM, Node API, 不变量和失败边界.
- 注释不逐行复述语法, 但不得省略 TypeScript 与 C++ 或 C# 行为不同且容易误解的关键点.
- Markdown 保持一个一级标题, 完整 TOC 和连续标题层级.
- 路径, 命令, 类型名, 字段名和文件名使用反引号.
