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
