# Skills 管理

## 目录

- [从 GitHub 安装](#从-github-安装)
- [导入本机 Skills](#导入本机-skills)
- [部署到用户目录](#部署到用户目录)
- [多设备同步时的版本](#多设备同步时的版本)

## 从 GitHub 安装

在侧栏打开 Skills, 点击 Sources 登记 GitHub 仓库. 关闭弹窗后, 在 Discover 页签发现并安装 Skills. Installed 页签用于检查更新和管理已安装项.

当前项目已安装的 Skill 在 Discover 中显示 Installed, 不能再次勾选. 判定按 id 匹配且不区分大小写, 包括本地导入或其他来源的同名项; 移除已安装项后可以重新选择.

应用可以发现仓库根目录和子目录中的 `SKILL.md`. 根目录 Skill 使用仓库名作为 id, 同样支持安装和检查更新. 移除来源需要确认, 已安装的 Skills 会保留.

安装后的内容保存在 `.harness-align/skills/<id>/`. 每个 Skill 目录带有 `SKILL.md`, `skills/index.json` 记录来源, 请让应用维护这个文件. 根目录 Skill 的 `sourcePath` 为空字符串是正常记录.

## 导入本机 Skills

点击 Import, 从 `%USERPROFILE%\.agents\skills` 选择已有 Skills 导入. 本地导入和部署会保留非隐藏的空目录, 跳过名称以 `.` 开头的文件和目录.

批量安装和导入会先检查所有选中项的来源与大小写冲突. 存在冲突时整批不安装. 写入过程中如果发生磁盘错误, 此前已经成功的项可能保留, 可以在 Installed 页签查看结果.

下载的 ZIP 路径必须使用 `/`. 应用会拒绝包含反斜杠或路径逃逸的归档. 网络和代理问题见[排查说明](usage.md#查看日志与排查问题).

## 部署到用户目录

安装或导入后, 点击 Setup, 将 `.harness-align/skills/` 中的内容部署到 `%USERPROFILE%\.agents\skills\<id>\`. 同名 Skill 目录会被覆盖, 无关 Skills 会保留, `index.json` 不会复制过去.

Skills 安装与导入直接生效, 不需要 Save all. Setup 只部署已经安装的内容. 如果没有项目 Skills, 或目录中只有 `index.json`, 会跳过 Skills 部署并视为成功. shared-rules 仍然必需, 详见[生成和部署](usage.md#生成和部署).

## 多设备同步时的版本

本地导入或来源不明的 Skills 会同步完整文件. GitHub 下载的 Skills 只同步已安装清单和来源记录, 接收设备按记录补齐内容, 不会顺带更新到上游最新版.

GitHub Skill 的本地修改不会上传. 本机内容与来源记录不一致时, 应用会重新下载并替换. 如果要保留自己的修改, 应将内容作为本地 Skill 导入.

固定版本, 旧来源记录和下载失败的处理见[同步中的 Skills](github-sync.md#skills-如何同步). 返回[项目首页](../README.md).
