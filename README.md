# Resx Editor for VSCode

一个用于编辑 .NET Core 资源文件（.resx）的可视化编辑器扩展。

## 功能特性

- ✅ 可视化网格界面编辑 resx 文件
- ✅ 在一个视图中同时编辑多个语言版本
- ✅ 自动识别并加载同名的语言特定资源文件（如 Messages.zh-CN.resx, Messages.en-US.resx）
- ✅ 支持添加、编辑和删除资源键值对
- ✅ 保存后自动更新所有相关语言文件

## 使用方法

### 安装

1. 打开 VSCode
2. 按 `F5` 运行扩展开发主机
3. 在新窗口中打开包含 resx 文件的项目

### 编辑 resx 文件

1. 双击任意 `.resx` 文件
2. 编辑器会自动以网格形式打开，显示：
   - Key 列：资源键名
   - Default 列：默认语言的值（来自 Messages.resx）
   - zh-CN 列：中文值（来自 Messages.zh-CN.resx）
   - en-US 列：英文值（来自 Messages.en-US.resx）
   - Actions 列：操作按钮

3. 编辑操作：
   - **修改值**：直接在对应单元格中输入新内容
   - **修改键名**：修改 Key 列中的名称
   - **添加新键**：点击 "Add New Key" 按钮
   - **删除键**：点击行末的 "Delete" 按钮
   - **保存**：点击 "Save All" 按钮保存所有更改

## 文件结构示例

```
YourProject/
  ├── Messages.resx              # 默认语言
  ├── Messages.zh-CN.resx        # 中文
  └── Messages.en-US.resx        # 英文
```

当你打开 `Messages.resx` 时，编辑器会自动加载所有相关的语言文件。

## 开发

### 安装依赖

```bash
pnpm install
```

### 编译

```bash
pnpm run compile
```

## 发布到 VS Code 市场（Marketplace）

### 1) 准备 Publisher

1. 登录 https://marketplace.visualstudio.com/
2. 创建 Publisher（Organization / Publisher）
3. 在本项目的 package.json 中把 `publisher` 改成你创建的 publisher 名称

### 2) 手动发布（首次建议手动）

在仓库根目录运行：

```bash
pnpm install
pnpm run compile
pnpm dlx @vscode/vsce publish
```

发布时会要求登录/或使用 PAT。

### 3) GitHub Actions 自动发布（tag release 流程）

本仓库已包含 GitHub Actions 工作流：

- `.github/workflows/ci.yml`：每次提交/PR 编译检查
- `.github/workflows/publish.yml`：当你 push 一个 tag（例如 `v1.2.3`）时自动：
   - 编译
   - 校验 tag 必须等于 `v${package.json version}`
   - 使用 `vsce` 发布到 Marketplace

你需要在 GitHub 仓库 Settings -> Secrets and variables -> Actions 里添加：

- `VSCE_PAT`：VS Code Marketplace 的 Personal Access Token

注意：Marketplace 要求每次发布的版本号必须递增，所以 workflow 会自动提交一次版本号 bump。

#### 如何触发一次发布

1. 先修改 `package.json` 的 `version`（例如改成 `1.0.1`）
2. 提交并 push 到远端
3. 创建并 push tag：

```bash
git tag v1.0.1
git push origin v1.0.1
```

随后 GitHub Actions 会自动发布。

### 监视模式

```bash
pnpm run watch
```

### 调试

1. 在 VSCode 中打开项目
2. 按 `F5` 启动调试
3. 在扩展开发主机窗口中测试扩展

## 技术栈

- TypeScript
- VSCode Extension API
- Custom Editor API
- xml2js（用于解析和生成 XML）

## 许可

ISC

## 贡献

欢迎提交 Issues 和 Pull Requests！
