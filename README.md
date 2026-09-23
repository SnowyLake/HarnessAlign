# Harness Align

## 目录

- [这是什么](#这是什么)
- [主要功能](#主要功能)
- [使用文档](#使用文档)

## 这是什么

<img src="build/icon.png" alt="Harness Align logo" width="96" height="96" />

Harness Align 是一款管理编码助手配置的 Windows 桌面应用. 你可以在一个窗口里维护规则, Subagent 和 Skills, 为 Cursor, Codex, OpenCode 等助手生成配置, 再部署到各自的目录.

如果你同时使用多个编码助手, 可以把共用规则放在一起维护, 按助手选择适用内容, 并保留各自的 Subagent 配置格式. 多台设备之间也可以通过 GitHub 私有仓库同步这些配置.

## 主要功能

- 编辑公共规则, 按助手指定适用范围. 用 Layer 保存可切换的规则选项, 调整组合和顺序.
- 为 Subagent 维护一份共享正文, 分别编辑各助手的参数, 生成 TOML 或带 YAML metadata 的 Markdown 文件.
- 从 GitHub 发现和安装 Skills, 检查更新, 或导入本机已有 Skills.
- 生成后查看 `AGENTS.md` 和 Subagent 文件, 再部署到已存在的助手目录. 共享规则和 Skills 一并部署.
- 在多台设备间同步配置, 预览差异, 选择冲突版本, 或将某项本地修改还原为远端版本.
- 在安装版的 Settings 中检查最新正式版, 下载并安装升级. 配置, 主题和同步凭据会保留.

## 使用文档

首次使用可以从[上手与日常操作](docs/usage.md)开始. Windows 安装版不需要 Node.js 或 npm.

| 文档 | 内容 |
| --- | --- |
| [上手与日常操作](docs/usage.md) | 安装, 编辑与保存, 生成与部署, 日志和网络问题 |
| [配置参考](docs/configuration.md) | 配置目录, Harness 字段, Rules, Layer 和 Subagent 格式 |
| [Skills 管理](docs/skills.md) | 添加来源, 安装与更新, 本地导入, 部署范围 |
| [GitHub 多设备同步](docs/github-sync.md) | 连接仓库, 首次同步, 冲突处理, 逐项还原和中断恢复 |
| [从源码运行与构建](docs/build.md) | 环境要求, 启动命令, 验证和 Windows 打包 |
