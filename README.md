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
- [GitHub 多设备同步](#github-多设备同步)
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

1. 在应用中编辑规则, Layer 或 Subagent, 点击 Save file 保存当前文件, 或点击顶部 Save all 保存全部草稿. Skills 操作直接生效.
2. 点击 Generate 校验配置并生成输出, 在 Generated 页查看结果.
3. 点击 Setup 重新生成并部署到当前用户已经存在的 Harness 根目录, 以及共享规则和项目 Skills.

Generate 和 Setup 使用当前 Layer 顺序与选项. 有未保存的源文件草稿时, 先点击 Save all 或按 Ctrl+S, 再生成或部署.

## 桌面应用

桌面应用使用顶部命令栏和主从编辑布局. 侧栏导航无横向分割线, 依次提供 Harnesses, Rules, Layers, Agents, Generated 和 Skills, 底部提供 Console 和 Settings. 窄窗口下侧栏自动收起为图标, 文件列表可调整宽度或折叠. Layers, Rules 和 Agents 的列表默认宽度统一为 28%, 可在 20% 到 45% 之间调整. Markdown 与 JSON 编辑器支持长文本和结构化内容.

窗口可以:

- 自动加载当前用户配置. 配置根目录固定, 界面不显示或提供修改入口.
- 在 Harnesses 页通过居中单列卡片查看名称和配置路径, 点击 Edit 在侧边面板中编辑单个 Harness, 或使用 Add harness 新建. 卡片使用 `~/.codex` 这样的形式表示用户目录下的路径, 编辑时填写 `.codex` 等相对路径. Setup 跳过尚不存在的目标目录.
- 在 Layers 页按 Group 管理 Layer 及其选项. Group 标题行的序号, 名称, 展开箭头和操作按钮垂直居中对齐. Group 开关控制是否参与生成, Generate option 选择生成时使用的选项, 拖动 Group 名称或点击上下箭头调整顺序. 启用的 Group 按生成顺序排列, 未启用的 Group 排在后面. Add layer 创建空 Group, 添加 Option 后才能启用.
- Rules 页的内部列表标题旁通过 Root / Shared 分段标签切换, 选中项高亮, 未选中项置灰且仍可点击. Root 编辑参与 `AGENTS.md` 的根规则, Shared 编辑独立部署的共享规则. 切换时保留列表宽度和未保存草稿. Rule 和 Layer Option 的 Targets 都是严格白名单, 未选择任何 Harness 时会显示提示, 该内容不会生成到任何 Harness.
- 在 Agents 页编辑共享正文, 按 Harness 切换原生 metadata, 并通过 Enable 选择需要生成该 Agent 的 Harness.
- 在 Generated 页查看最近一次生成结果. 不要手工改这些文件.
- Skills 位于侧栏 Generated 下方. 在 Skills 页面点击 Sources 管理 GitHub 仓库, 移除来源需要确认并保留已安装的 Skills. Installed 页签用于检查更新和管理已安装项, Discover 页签用于发现和安装远端 Skills; 点击 Import 从 `%USERPROFILE%\.agents\skills` 导入.
- 使用当前未保存的 Layer 选择执行 Generate 和 Setup.
- 在 Settings 页设置生成 `AGENTS.md` 的一级标题, 切换主题.

Settings 页的 `AGENTS.md title` 只控制生成文档的一级标题. 点击顶部 Save all 或按 Ctrl+S 后, 所有页面的草稿以及当前 Layer 顺序与选择会统一写回. 文件列表顶部的 Add 新建对应内容, 编辑区顶部的 Create 或 Save file 只保存当前项, Discard changes 恢复当前文件的已保存内容. 文件行操作菜单和右键菜单中的 Save 同样只保存当前文件. 切换页面会保留草稿, 关闭有未保存修改的窗口时会提示确认.

关闭 Group 开关会立即移出当前生成序列, 保留源文件和编辑能力. 顶部弹出提示只显示简短结果; 侧边栏 Settings 上方的 Console 独立页面按时间累计操作记录, 完整报告和错误详情. 日志仅保留在本次应用运行的内存中, 切换页面或刷新窗口不会丢失, 关闭应用后清空. Console 支持自动滚动和手动清空, 操作进行中或工作区加载失败时也可查看. 工作区加载失败时可点击 Retry 重试.

Harness 编辑面板的 Save harness 只保存当前项. 关闭面板会保留草稿, 卡片用 Unsaved 标记未保存项; Discard changes 放弃当前草稿. 新建草稿关闭后可通过 Continue new harness 继续编辑. 删除操作位于编辑面板内, 并需要再次确认. 保存 Harness 后再运行 Generate 或 Setup.

桌面应用不创建 `%USERPROFILE%` 下缺失的 Harness 根目录. Setup 只复制已经安装到 `.harness-align/skills/` 的 Skills.

Skills 下载和 GitHub 同步默认使用 Windows 系统代理, 包括自动代理配置. 启动时显式设置 `HTTP_PROXY` 或 `HTTPS_PROXY` 时, 优先使用环境变量代理, 并遵守 `NO_PROXY`. 网络失败会报告连接错误码, 单次请求超过 60 秒会超时; Skills 下载只有在 `main` 或 `master` 返回 HTTP 404 时才尝试另一个分支. 修改代理环境变量后需重新启动应用.

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
| `name` | 匹配 `[A-Za-z0-9][A-Za-z0-9_-]*`, 忽略大小写后唯一 | `.harness-align/layers/<layer>/` 目录名 |
| `selected` | 匹配 `[A-Za-z0-9][A-Za-z0-9_-]*`, 且必须存在对应 `.md` 文件 | 保存的默认选项 |

`layers` 可以为空, 表示当前项目未选择任何 Layer. `.harness-align/layers/<layer>/` 目录构成 Layer 目录, 并允许暂时不包含 Option. Layer 和 Layer Option 支持仅修改大小写的重命名, 并同步更新已保存的选择. 空 Layer 不能启用生成; 未写入 `config.json` 的 Layer 目录仍然有效, 只是不参与生成.

Harness 字段:

| 字段 | 约束 | 用途 |
| --- | --- | --- |
| `name` | 匹配 `[A-Za-z0-9][A-Za-z0-9_-]*`, 忽略大小写后唯一 | Rule `targets`, Agent `harnesses` 键和生成目录名 |
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

Agent 和 Rule (包括 shared-rules) 支持仅修改文件名大小写, 重名检查会排除当前文件, 仍拒绝与其他文件忽略大小写后重名. Agent, Layer, Layer Option 和 Harness 名称允许英文字母大小写, 保留原始拼写, 忽略大小写后必须唯一. `targets`, `harnesses` 键和 Layer 选择中的引用必须与名称大小写一致. `agent_extension` 和 `instructions_field` 使用同一标识符规则, 允许英文大小写, 数字, 下划线和连字符, 且以字母或数字开头; 输出保留原始拼写. Harness 编辑时未切换格式会保留配置中的扩展名. `agent_format` 仍为固定的 `toml` / `yaml` 值, `instructions_field` 仍不能占用 `name` 或 `description`. Rule 文件名和 Skill id 保留各自已有的字符范围.

Subagent 文件使用公共 `name`, `description`, `harnesses` 和 Markdown 正文. 保存前会检查公共 `name` 是否与其他 Agent 忽略大小写后重名, 冲突时保留原文件. 每个 Harness 块里的 metadata 没有字段白名单, 会按该 Harness 的格式原样写出. 同名字段可以覆盖该 Harness 输出中的公共 `name` 或 `description`. TOML Harness 的正文占用 `instructions_field`, 不要在 metadata 里重复声明这个字段.

## Skills

项目 Skills 放在 `.harness-align/skills/` 下, 每个 skill 一个目录, 并带 `SKILL.md`. `index.json` 记录来源, 不要手工编辑.

桌面应用可以从 Skills 页面的 Sources 弹窗登记 GitHub 仓库, 关闭弹窗后在 Discover 页签发现并安装 skill, 也可以从 `%USERPROFILE%\.agents\skills` 导入已有目录. Setup 把已经安装到项目里的 skill 覆盖部署到用户目录.

GitHub 仓库根目录和子目录中的 `SKILL.md` 均可发现, 安装和检查更新. 根目录 skill 使用仓库名作为 id, `index.json` 中的 `sourcePath` 为空字符串是正常记录.

本地导入和部署保留非隐藏的空目录, 跳过名称以 `.` 开头的文件和目录. 下载的 ZIP 路径必须使用 `/`, 包含反斜杠或路径逃逸的归档会被拒绝.

批量安装和导入会先检查全部选中项的来源与大小写冲突. 冲突时不安装任何选中项; 逐项写入期间发生磁盘错误时, 之前成功的项仍可能保留.

没有项目 Skills, 或 `.harness-align/skills/` 里只有 `index.json` 时, skills 部署会跳过并视为成功. shared-rules 仍然必需.

## GitHub 多设备同步

在 Settings 的 GitHub connection 中, 可以把多台设备连接到同一个 GitHub 私有仓库和分支. 顶部 Sync 按钮在各工作页面都可用, 打开后自动预览变更, 在独立对话框中处理冲突并执行同步. 同步通过 GitHub API 完成, 不需要安装 Git, 不需要自建服务器.

首次连接:

1. 在 GitHub 创建一个专用私有仓库, 勾选创建 README, 确保仓库已有分支.
2. 在 Settings 点击 Connect GitHub, 使用 Create token on GitHub 打开[创建链接模板](https://github.com/settings/personal-access-tokens/new?name=HarnessAlign-Sync&expires_in=90&contents=write). 模板预填名称 `HarnessAlign-Sync`, 90 天有效期和 `Contents: Read and write` 权限. 在 GitHub 选择正确的 Resource owner, 在 Repository access 中选择 Only select repositories 并仅勾选同步仓库, 然后创建 fine-grained personal access token. 可为名称追加设备名以便单独管理; 组织仓库可能需要管理员批准 Token.
3. 回到连接界面, 填写 Owner, Private repository, Existing branch 和 Token, 点击 Connect. Token 使用本机系统加密保存, 不写入同步仓库, 不会在界面中回显. Manage tokens 打开 GitHub 的 Fine-grained tokens 管理页.
4. 保存所有工作区草稿, 点击顶部 Sync 查看上传, 下载和冲突项. Refresh preview 可以重新获取变更. View versions 可以对照本地与远端内容; 大文件只显示部分文本, 二进制文件显示大小和哈希.
5. 首次接入已有配置时, 选择合并, 使用本机完整配置, 或使用远端完整配置. 选择某一方的完整配置会同时应用该方的删除操作. 确认后点击 Sync now.
6. 在其他设备连接相同仓库及分支. 同步完成后按需执行 Generate 或 Setup, 更新本机生成结果或助手目录.

同步使用仓库内的 `harness-align/` 目录, 保留 README 等其他仓库内容. 该目录中的 `sync.json` 记录同步格式版本和目录信息, 包括空 Layer. 不要删除或手工修改该文件. 如果该目录已有内容但没有同步标记, 应用会拒绝覆盖.

| 数据 | 同步行为 |
| --- | --- |
| `config.json` | 同步标题, Harness, Layer 选择及 Skills 来源 |
| `rules/`, 包括 `shared/` | 同步配置源 |
| `layers/`, `agents/` | 同步所有配置源, 保留空 Layer |
| `skills/`, 包括 `index.json` | 同步已安装文件, 二进制资产, 本地修改与来源记录 |
| `generated/` 与已部署的助手目录 | 不同步, 各设备自行生成和部署 |
| 主题, 窗口位置, Token, 同步基线与恢复记录 | 仅保留在本机 |

日常同步使用上次成功同步的版本作为共同基线. 不同文件的独立修改会自动合并, 同一文件的不同修改以及删除与修改之间的冲突需要选择 Keep local 或 Keep remote. 同一个 Skill 的所有文件和来源记录作为整体选择; 目录大小写别名或文件与目录之间的冲突也会连同相关子目录整体选择. 合并结果必须通过完整配置校验, 引用错误会阻止同步. 第一版不做逐行自动合并, 不提供设备专属配置覆盖或自动后台同步.

同步预览显示的是当时的版本. 预览后如果本地源文件或远端分支变化, Sync now 会要求重新预览. 远端更新使用一次非强制 Git commit, 不覆盖其他设备抢先上传的提交. 分支保护或仓库规则可能拒绝直接提交, 应用会报告失败, 不会绕过这些规则.

上传响应丢失或程序退出后, 应用保留待确认提交的信息. 再次打开顶部 Sync 或点击 Refresh preview 会查询提交是否已经发布, 避免直接重复上传. 已发布且本地没有后续修改时, 会恢复本地应用步骤并刷新工作区; 检测到后续修改时保留这些修改并重新展示合并预览.

本地替换前会保留最近一份 `.harness-align/.sync-backup.json` 备份, 并写入 `.sync-recovery.json` 恢复记录. 写入失败时尝试回滚; 程序中断后, 下次访问工作区会先恢复. 如果中断后又发生了外部编辑, 应用停止自动恢复并报告冲突文件和恢复记录位置, 避免丢弃这些编辑. 备份和恢复文件不上传.

单个同步文件最多 8 MiB, 配置源总大小最多 32 MiB, 文件与目录总数最多 5000. 超限, GitHub 返回不完整目录树, 路径逃逸, symlink 或 junction 都会阻止同步. Skills 中的文件是实际内容快照, 不会在另一台设备自动重新下载上游最新版.

Token 到期时在 Settings 中点击 Manage connection, 再使用 Update connection 更新凭据. Disconnect 只移除本机凭据, 保留本地配置, 同步基线和待恢复提交, 不删除远端数据. 有待恢复提交时, 需要先重新连接原仓库并完成恢复, 才能切换仓库. 私有仓库中的配置文件是明文内容, 不是端到端加密.

## 部署结果

`generate` 只更新 `%USERPROFILE%\.harness-align\generated`. 每个已声明 Harness 会得到一份 `AGENTS.md` 和对应格式的 `agents/` 文件.

`setup` 在生成之后:

- 更新 `%USERPROFILE%\<config_path>\AGENTS.md`
- 使用本次生成的文件替换该目录下的 `agents/`, 不部署 `generated/` 中的未知文件. 当前没有生成 Subagent 时, 目标 `agents/` 会被替换为空目录
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
