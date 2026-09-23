# 上手与日常操作

## 目录

- [安装与首次启动](#安装与首次启动)
- [升级应用](#升级应用)
- [编辑和保存](#编辑和保存)
- [管理助手与规则](#管理助手与规则)
- [生成和部署](#生成和部署)
- [查看日志与排查问题](#查看日志与排查问题)

## 安装与首次启动

在 Windows 上运行 Harness Align 安装包, 安装后从桌面或开始菜单打开应用. 安装版不需要 Node.js 或 npm. 如果你要自行运行源码或打包, 见[构建说明](build.md).

应用会自动加载 `%USERPROFILE%\.harness-align` 中的配置. 首次启动时, 如果存在旧的 `.halign` 目录, 应用会迁移它; 没有配置时会创建目录和默认 `config.json`. 配置目录固定, 与应用安装位置无关, 界面不提供修改入口. 迁移规则见[配置目录](configuration.md#配置目录).

新建配置时, 应用依次检测用户目录下的 `.codex`, `.cursor`, `.grok` 和 `.config/opencode`, 只将已有配置目录的 Codex, Cursor, Grok Build 和 OpenCode 加入 Harnesses. 文件, 符号链接和 junction 不计入检测结果. 检测依据是配置目录, 卸载后的残留目录仍可能被识别; 已安装但尚未初始化目录的工具需要先启动一次, 再通过 Add harness 手动添加. 全部未检测到时列表为空, 应用仍可正常使用. 已有配置和迁移配置保持原样, 后续启动不会自动增删 Harnesses.

应用同时只运行一个窗口, 再次启动会聚焦已有窗口. Settings 中可以切换主题. 主题和窗口位置保存在本机.

## 升级应用

安装版可以在 Settings 的 Application 中升级, 不需要再打开发布页面下载.

1. 点击 Check for updates. 应用只查看 GitHub 上最新的正式版.
2. 发现新版本后, 点击 Download and install. 应用下载安装包, 校验后退出, 静默安装并重新打开.

升级替换安装目录里的程序文件. `%USERPROFILE%\.harness-align` 中的配置, 以及保存在安装目录外的主题和 GitHub 同步凭据, 都会保留. 安装开始后应用会关闭, 尚未保存的编辑会丢弃.

尚未包含应用内更新的已安装版本, 需要先手动安装一次包含该功能的版本. 从源码运行的窗口不能在软件内升级. 当前安装包未签名, 升级时 Windows 仍可能显示安全提示.

应用更新默认使用 Windows 系统代理. 启动时如果设置了 `HTTP_PROXY` 或 `HTTPS_PROXY`, 更新请求优先使用该代理, 并遵守 `NO_PROXY`.

## 编辑和保存

侧栏提供 Harnesses, Rules, Layers, Agents 和 Skills, 底部是 Generated, Console 和 Settings. 窄窗口下侧栏会收起为图标. 文件列表可以折叠或调整宽度, Layers, Rules 和 Agents 的列表默认占 28%, 可在 20% 到 45% 之间调整. 在 Rules, Layers 和 Agents 中切换条目时, 右侧编辑区会保持滚动位置.

日常修改按以下顺序进行:

1. 在对应页面编辑内容, 用 Save file 保存当前文件, 或用顶部 Save all 保存全部草稿.
2. 点击 Generate, 在 Generated 页查看输出.
3. 确认后点击 Setup, 更新本机助手目录.

文件列表顶部的 Add 用于新建内容. 编辑区的 Create 或 Save file, 文件行菜单和右键菜单中的 Save, 都只保存当前项. Discard changes 会恢复当前项的已保存内容.

Save all 和 `Ctrl+S` 会保存所有页面的草稿, 以及当前 Layer 顺序与选项. 切换页面会保留草稿, 关闭有未保存修改的窗口时会提示确认. Skills 操作直接生效, 不需要再点 Save all.

在软件外修改本地文件后, 点击顶部 Reload 重新读取文件. 没有未保存修改时会直接刷新; 有草稿或未保存的 Layer 顺序与选项时, 可以 Cancel 保留当前内容, 或选择 Discard and reload 丢弃软件内全部未保存修改, 以本地文件为准. 读取或校验失败时保留原有页面内容和草稿, 详情见 Console. 重载后保留当前页面和仍存在的选中项; 选中项被外部删除时会选择该页面的其他可用项.

Reload 不会自动合并软件内外的修改. 同一文件在软件内外都被修改时, 先确认要保留的内容再选择保存或重载; 保存仍使用现有写回行为, 不会检测或提示外部修改冲突.

Settings 中的 `AGENTS.md title` 只控制生成文档的一级标题, 随 Save all 一起保存.

## 管理助手与规则

### Harnesses

一个 Harness 对应一个编码助手的输出格式和配置目录. 点击 Add harness 新建, 或点击卡片上的 Edit 编辑. 路径填写 `.codex` 这样的相对用户主目录路径, 卡片会显示为 `~/.codex`. 点击路径可以打开已经存在的文件夹, 应用不会创建缺失目录.

Save harness 只保存当前助手. 关闭编辑面板会保留草稿, 卡片用 Unsaved 标记未保存项. 新建草稿可以通过 Continue new harness 继续编辑. Discard changes 放弃当前草稿; 删除操作位于编辑面板内, 需要再次确认. 保存 Harness 后再执行 Generate 或 Setup.

### Rules 与 Layers

Rules 页通过 Root / Shared 切换规则类型. Root 规则参与生成各助手的 `AGENTS.md`, Shared 规则单独部署到用户共享规则目录. 切换时保留列表宽度和未保存草稿.

Rule 和 Layer Option 的 Targets 指定内容适用于哪些助手. 没有选择任何 Harness 时, 该内容不会生成到任何助手的配置中. 要应用到全部助手, 需要逐一选中它们.

Layers 页按 Group 管理选项. Group 开关决定是否参与生成, Generate option 选择本次使用的选项. 拖动 Group 名称或使用上下箭头可以调整顺序. 启用的 Group 按生成顺序排列, 未启用的排在后面.

Add layer 创建空 Group, 添加 Option 后才能启用. 关闭 Group 开关会将它移出生成序列, 源文件仍然保留, 也可以继续编辑.

### Agents 与 Skills

在 Agents 页编辑 Subagent 的共享正文, 按 Harness 切换各自的 metadata, 用 Enable 选择需要生成该 Agent 的助手. OpenCode 标签页在 Enable 同行右侧提供相同样式的 Generate name field 勾选项, 默认勾选; 取消勾选后生成的 frontmatter 不包含 `name`. 切换 Agent 时会保持当前 Harness 标签页. 字段和文件格式见[配置参考](configuration.md).

Skills 页可以安装 GitHub Skills, 检查更新和导入本机内容. 具体操作见[Skills 管理](skills.md).

## 生成和部署

Generate 和 Setup 使用当前 Layer 顺序与选项, 包括尚未保存的选择. 有未保存的源文件草稿时, 先用 Save all 或 `Ctrl+S` 保存, 再生成或部署.

Generate 只更新 `%USERPROFILE%\.harness-align\generated`. 每个已声明 Harness 都会得到 `AGENTS.md` 和对应格式的 `agents/` 文件. 应用只删除自己管理过且本次不再生成的文件, 保留未知文件. Generated 页用于查看结果, 不要手工修改输出文件.

Setup 会重新生成, 然后按下表更新本机目录. 执行前请确认 Harness 中的路径指向你要更新的助手配置.

| 目标 | 更新方式 |
| --- | --- |
| `%USERPROFILE%\<config_path>\AGENTS.md` | 替换为本次生成的规则 |
| `%USERPROFILE%\<config_path>\agents\` | 整个目录替换为本次生成的 Subagent; 没有生成项时替换为空目录 |
| `%USERPROFILE%\.agents\shared-rules\` | 整个目录替换为 `.harness-align/rules/shared/` 的内容 |
| `%USERPROFILE%\.agents\skills\<id>\` | 按 Skill id 覆盖同名目录, 保留无关 Skills, 不复制 `index.json` |

Setup 只处理配置中声明且根目录已存在的 Harness. 缺失的根目录会被跳过, 需要先由对应助手初始化. `generated/` 中的未知文件不会部署. 没有已安装 Skills 时会跳过 Skills 部署, shared-rules 仍然必需.

应用会拒绝路径逃逸, 符号链接, junction 和其他 reparse point. 配置或目标校验失败时会停止后续写入, 在 Console 显示原因. 部署会先准备完整替换内容, 替换失败时尝试恢复原文件. 如果恢复失败, 日志会列出目标和备份位置.

## 查看日志与排查问题

顶部提示显示简短结果, Console 按时间保留操作记录, 完整报告和错误详情. 日志只保留在本次运行中, 切换页面或刷新窗口不会丢失, 关闭应用后清空. Console 支持自动滚动和手动清空, 操作进行中或工作区加载失败时也能查看. 加载失败后可点击 Retry 重试.

Skills 下载和 GitHub 同步默认使用 Windows 系统代理, 包括自动代理配置. 启动时设置 `HTTP_PROXY` 或 `HTTPS_PROXY` 会优先使用环境变量代理, 并遵守 `NO_PROXY`. 修改这些变量后需要重启应用.

网络失败时, 在 Console 查看连接错误码, 检查代理设置和 GitHub 连通性. 单次同步请求超过 60 秒会超时; Skills 下载同样有 60 秒超时限制. Skills 只有在 `main` 或 `master` 返回 HTTP 404 时才尝试另一个分支, 连接失败不会触发分支重试.

同步冲突或中断后的处理见[GitHub 多设备同步](github-sync.md). 返回[项目首页](../README.md).
