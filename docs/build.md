# 从源码运行与构建

## 目录

- [环境要求](#环境要求)
- [运行源码](#运行源码)
- [验证与构建](#验证与构建)
- [生成 Windows 安装包](#生成-windows-安装包)

## 环境要求

从源码运行需要 Node.js 24 和 npm 11. 项目只使用 npm. Windows 安装版自带运行环境, 使用安装版不需要安装这两项.

## 运行源码

在仓库根目录执行:

```powershell
npm ci
npm run dev
```

开发窗口也使用当前用户的 `%USERPROFILE%\.harness-align` 配置. 在窗口中保存或执行 Setup 会修改本机配置, 操作范围见[生成和部署](usage.md#生成和部署).

## 验证与构建

```powershell
npm run verify
npm run build
```

`npm run verify` 编译引擎, 检查桌面应用类型, 再运行测试. `npm run build` 构建桌面应用.

如果要修改代码, 实现约束和改动流程见 [AGENTS.md](../AGENTS.md).

## 生成 Windows 安装包

```powershell
npm run build:win
```

产物保存在 `release/`:

| 文件 | 用途 |
| --- | --- |
| `release/win-unpacked/HarnessAlign.exe` | 直接运行构建后的应用 |
| `release/HarnessAlign-1.0.0-setup.exe` | Windows NSIS 安装包, 文件名中的版本随应用版本变化 |

返回[项目首页](../README.md).
