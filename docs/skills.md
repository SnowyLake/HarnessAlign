# Skills 管理

## 目录

- [从 GitHub 安装](#从-github-安装)
- [导入本机 Skills](#导入本机-skills)
- [部署到用户目录](#部署到用户目录)
- [多设备同步时的版本](#多设备同步时的版本)

## 从 GitHub 安装

在侧栏打开 Skills, 通过顶部 More > Sources 登记 GitHub 仓库. 切换到 Discover 视图, 通过 More > Discover skills 发现 Skills. 左侧选择一项后, 右侧显示只读的 `SKILL.md`, 文件名旁提供来源仓库链接; 点击右上角 Install 安装当前项. Installed 视图用于管理已安装项; 检查和批量应用更新也在 More 菜单中.

Skills 页左侧列出已安装项, 右侧显示选中 Skill 的 `SKILL.md`. GitHub 来源的内容只读. 本地导入和来源不明的 Skill 可以在右侧编辑并点击 Save file 保存; 未保存的内容会保留为草稿, 也可使用 Save all 一起保存. 这里只编辑 `SKILL.md`, 同目录脚本和参考文件仍保留原样.

Installed 文件行的省略号菜单和右键菜单提供 Open in explorer, 打开该已安装 Skill 的 `SKILL.md` 所在目录, 可在那里查看脚本和参考文件. Discover 中尚未安装的条目没有此操作.

当前项目已安装的 Skill 在 Discover 左侧名称置灰, 仍可选中预览; 右上角显示禁用的 Installed. 判定按 id 匹配且不区分大小写, 包括本地导入或其他来源的同名项; 移除已安装项后可以安装. 多个来源发现同名 Skill 时, 仍可逐项预览, 但不能安装, 禁用按钮会说明原因.

应用可以发现仓库根目录和子目录中的 `SKILL.md`. 根目录 Skill 使用仓库名作为 id, 同样支持安装和检查更新. 移除来源需要确认, 已安装的 Skills 会保留.

安装后的内容保存在 `.harness-align/skills/<id>/`. 每个 Skill 目录带有 `SKILL.md`, `skills/index.json` 记录来源, 请让应用维护这个文件. 根目录 Skill 的 `sourcePath` 为空字符串是正常记录.

Discover 与 Check updates 每次解析分支最新 commit. 已验证的下载与解压内容按来源 repo + commit 在本次会话中复用, 最多保留 8 个仓库版本且总内容不超过 512 MiB. Apply updates 使用检查时的固定版本. 再次发现或检查, 来源配置变化, 或已安装来源记录变化后, 需要重新检查并审阅.

## 导入本机 Skills

通过顶部 More > Import, 从 `%USERPROFILE%\.agents\skills` 选择已有 Skills 导入. 本地导入和部署会保留非隐藏的空目录, 跳过名称以 `.` 开头的文件和目录.

当前项目中已有 GitHub 来源记录的同名 Skill 不出现在导入列表, 即使用户目录中的副本后来被修改也是如此. 匹配 id 时忽略大小写. 如需改为本地版本, 先在 Installed 中移除该 GitHub Skill, 再导入用户目录中的副本. 其他本地或来源不明的 Skill 仍可导入.

安装和导入会先检查来源与大小写冲突. 批量导入存在冲突时整批不安装. 写入过程中如果发生磁盘错误, 此前已经成功的导入项可能保留, 可以在 Installed 视图查看结果.

下载的 ZIP 路径必须使用 `/`. 应用会拒绝包含反斜杠或路径逃逸的归档. 网络和代理问题见[排查说明](usage.md#查看日志与排查问题).

## 部署到用户目录

安装或导入后, 点击 Setup, 将 `.harness-align/skills/` 中的内容部署到 `%USERPROFILE%\.agents\skills\<id>\`. 同名 Skill 目录会被覆盖, 无关 Skills 会保留, `index.json` 不会复制过去.

Skills 安装与导入直接生效, 编辑 `SKILL.md` 需要保存. Setup 只部署已经安装且已保存的内容. 如果没有项目 Skills, 或目录中只有 `index.json`, 会跳过 Skills 部署并视为成功. shared-rules 仍然必需, 详见[生成和部署](usage.md#生成和部署).

## 多设备同步时的版本

本地导入或来源不明的 Skills 会同步完整文件. GitHub 下载的 Skills 只同步已安装清单和来源记录, 接收设备按记录补齐内容, 不会顺带更新到上游最新版.

GitHub Skill 的本地修改不会上传. 本机内容与来源记录不一致时, 应用会重新下载并替换. 如果要保留自己的修改, 应先移除项目中的 GitHub Skill, 再将内容作为本地 Skill 导入.

固定版本, 旧来源记录和下载失败的处理见[同步中的 Skills](github-sync.md#skills-如何同步). 返回[项目首页](../README.md).
