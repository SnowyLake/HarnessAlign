# GitHub 多设备同步

## 目录

- [连接仓库](#连接仓库)
- [首次同步](#首次同步)
- [日常同步与冲突处理](#日常同步与冲突处理)
- [还原某项本地修改](#还原某项本地修改)
- [同步范围](#同步范围)
- [Skills 如何同步](#skills-如何同步)
- [失败与中断恢复](#失败与中断恢复)
- [连接管理与限制](#连接管理与限制)

## 连接仓库

多台设备连接同一个 GitHub 私有仓库和分支, 就可以同步 Harness Align 配置. 同步由你手动发起, 不会在后台自动运行. 本机不需要安装 Git, 也不需要克隆仓库或自建服务器.

1. 在 GitHub 创建专用私有仓库, 勾选创建 README, 让仓库有一个可用分支.
2. 在 Settings 的 GitHub connection 中点击 Connect GitHub, 再点击 Create token on GitHub. [Token 创建模板](https://github.com/settings/personal-access-tokens/new?name=HarnessAlign-Sync&expires_in=90&contents=write)预填名称 `HarnessAlign-Sync`, 90 天有效期和 `Contents: Read and write` 权限.
3. 在 GitHub 选择正确的 Resource owner, 将 Repository access 设为 Only select repositories, 只选同步仓库, 然后创建 fine-grained personal access token. 名称可追加设备名, 方便分别管理; 组织仓库可能需要管理员批准.
4. 回到应用, 填写 Owner, Private repository, Existing branch 和 Token, 点击 Connect.

Token 使用本机系统加密保存, 不写入同步仓库, 也不会在界面中回显. Manage tokens 可以打开 GitHub 的 Fine-grained tokens 管理页.

## 首次同步

先保存或放弃所有工作区草稿, 再点击顶部 Sync. 该按钮在各工作页面都可用, 打开后会自动预览变更.

如果仓库还没有 Harness Align 存档, 确认显示的仓库和分支, 点击 Initialize archive, 将本机已保存的配置创建为远端存档. 初始化之前不能使用普通同步或 Discard local changes.

首次接入已有存档时, 可以选择:

| 选项 | 结果 |
| --- | --- |
| Merge local and remote | 合并双方独立修改, 由你处理冲突 |
| Use this device's complete configuration | 用本机完整配置替换远端配置 |
| Use the remote's complete configuration | 用远端完整配置替换本机配置, 保留本地备份 |

选择某一方的完整配置时, 也会应用该方的删除操作. 检查预览后点击 Sync now. 其他设备连接相同仓库及分支即可加入同步.

同步只更新配置源. 完成后按需执行 Generate 或 Setup, 更新这台设备的生成结果或助手目录.

## 日常同步与冲突处理

打开 Sync 查看上传, 下载和冲突项. Refresh preview 会核对远端当前版本, 并与本机上次成功同步的版本比较. 远端没有变化时只重读本地配置, 有变化时复用缓存, 下载缺少的内容.

View versions 用于对照本地和远端文件. 大文件只显示部分文本, 二进制文件显示大小和哈希.

不同文件的独立修改会自动合并. 同一文件的不同修改, 或一方删除而另一方修改时, 需要选择 Keep local 或 Keep remote. 应用不做逐行自动合并. 同一个 Skill 的文件和来源记录作为整体选择; 目录大小写冲突, 文件与目录的冲突也会连同相关内容整组处理.

处理完冲突后点击 Sync now. 合并结果必须通过完整配置校验, 引用错误会阻止同步. 应用不提供设备专属配置覆盖.

预览后如果本地文件或远端分支发生变化, 需要重新预览. 同步不会覆盖其他设备抢先上传的提交. 分支保护或仓库规则拒绝提交时, 应用会报告失败.

## 还原某项本地修改

在合并模式下, upload 或 conflict 项旁的 Discard local changes 会立即将该项恢复为预览中的远端版本, 不需要再点 Sync now.

- 远端没有该项时, 删除本地项.
- 本地删除而远端仍有文件时, 从远端恢复.
- 普通文件逐项处理; Skill 及其来源记录, 结构冲突涉及的文件和目录整组处理.

还原会保留其他本地修改和本地备份, 不上传内容, 也不改变上次成功同步的基线. 完成后刷新工作区和预览. 如果结果会让配置引用失效, 应用会在写入前拒绝操作. 本地或远端版本变化后, 同样需要重新预览.

## 同步范围

| 数据 | 同步方式 |
| --- | --- |
| `config.json` | 同步标题, Harness, Layer 选择和 Skills 来源 |
| `rules/`, 包括 `shared/` | 同步配置源 |
| `layers/`, `agents/` | 同步全部配置源, 保留空 Layer |
| 本地导入或来源不明的 Skills | 同步完整文件, 二进制资产和来源记录 |
| GitHub 下载的 Skills | 只同步已安装清单和来源记录, 接收设备补齐内容 |
| 配置目录中的 `AGENTS.md` | 不同步, 由本机应用维护编辑指引 |
| `generated/` 和已部署的助手目录 | 不同步, 各设备自行生成和部署 |
| 主题, 窗口位置, Token, 同步基线和恢复记录 | 只保留在本机 |

存档位于仓库的 `harness-align/` 目录, README 等其他仓库文件会保留. `harness-align/sync.json` 记录同步格式和目录信息, 包括空 Layer, 请不要删除或手工修改.

## Skills 如何同步

GitHub Skills 只上传来源记录. 接收设备会优先复用本机内容哈希匹配的 Skill, 再从来源仓库下载缺失或版本不同的内容, 校验通过后才替换本地文件. 同步不会触发上游更新.

新安装的 Skill 记录固定 commit. 旧来源记录没有 commit 时, 应用按原分支下载, 只有内容哈希匹配才接受. 如果旧分支已经变化, 可以在原设备检查并更新 Skill 后重新同步, 或将保留的旧内容作为本地 Skill 导入.

GitHub Skill 的本地文件用于缓存, 其中的修改不会同步. 内容不匹配时会按来源重新下载并替换, 应用不会提示将其转为本地 Skill. 需要保留的自定义内容应作为本地 Skill 导入, 见 [Skills 管理](skills.md).

下载或校验失败时, 应用保留现有工作区, 报告待重试的 Skill. 下次 Refresh preview 会重试未完成的同步. 所有下载内容通过完整配置校验后才会写入.

应用仍可读取旧版完整快照. 后续成功同步会从远端当前版本移除可重新下载的 Skill 文件, Git 历史提交中的文件仍然保留.

## 失败与中断恢复

### 远端存档无效或丢失

应用只接受路径, 格式版本和配置内容都有效的存档. `harness-align/` 已有内容但缺少同步标记, 或存档本身无效时, 会拒绝同步和本地还原, 也不能用 Initialize archive 覆盖.

这台设备曾成功同步过同一仓库和分支, 而远端存档后来消失时, 需要先恢复远端存档. 已经发布但尚未完成本地应用的初始化, 也不会自动重建后来被删除的存档.

### 上传结果不确定

上传响应丢失或程序退出后, 应用会保留待确认提交. 再次打开 Sync 或点击 Refresh preview, 会先查询提交是否已发布, 避免重复上传.

提交已发布且本地没有后续修改时, 应用会继续完成本地同步并刷新工作区. 如果检测到后续修改, 会保留它们并重新展示合并预览.

### 本地写入中断

替换本地配置前, 应用保留最近一份 `.harness-align/.sync-backup.json` 备份, 并写入 `.sync-recovery.json` 恢复记录. 写入失败时尝试回滚, 程序中断后会在下次访问工作区时先恢复.

如果中断后又有外部编辑, 应用会停止自动恢复, 报告冲突文件和恢复记录位置. 备份与恢复文件不会上传.

### 下载失败

下载失败后, 应用停止启动新请求, 等已启动的请求结束后返回错误. 可以在 Console 查看详情, 处理网络问题后重新预览. 代理和超时说明见[网络排查](usage.md#查看日志与排查问题).

## 连接管理与限制

Token 到期后, 在 Settings 点击 Manage connection, 再用 Update connection 更新凭据.

Disconnect 只移除本机凭据, 保留本地配置, 同步基线和待恢复提交, 不删除远端数据. 有待恢复提交时, 需要先连接原仓库完成恢复, 才能切换仓库.

| 限制 | 上限 |
| --- | --- |
| 单个同步文件 | 8 MiB |
| 配置源总大小 | 32 MiB |
| 文件与目录总数 | 5000 |

这些限制也适用于本地完整备份和下载后恢复的内容. 超限, GitHub 返回不完整目录树, 路径逃逸, symlink 或 junction 都会阻止同步.

私有仓库中的配置文件以明文保存, 不属于端到端加密. 返回[项目首页](../README.md).
