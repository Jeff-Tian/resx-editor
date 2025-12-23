# Resx Editor 快速启动指南

## 🚀 如何测试扩展

### 方法 1：使用 VSCode 调试（推荐）

1. **在 VSCode 中打开项目**
   ```bash
   cd resx-editor
   code .
   ```

2. **按 F5 启动调试**
   - VSCode 会自动编译项目
   - 打开一个新的扩展开发主机窗口

3. **在新窗口中打开示例文件**
   - File -> Open Folder -> 选择 `resx-editor/examples` 文件夹
   - 双击 `Messages.resx` 文件

4. **开始编辑**
   - 你会看到一个网格界面，包含三个语言列：
     - Default（默认）
     - zh-CN（中文）
     - en-US（英文）
   - 直接修改任何单元格中的值
   - 点击 "Save All" 保存所有更改

### 方法 2：手动运行

1. **编译项目**
   ```bash
   cd resx-editor
   pnpm install
   pnpm run compile
   ```

2. **在 VSCode 中调试**
   - 打开 `resx-editor` 文件夹
   - 按 F5 或点击 Run -> Start Debugging

## 📝 编辑器功能

### 查看多语言资源

网格显示格式：

| Key     | Default | zh-CN | en-US   |
|---------|---------|-------|---------|
| Hello   | 你好    | 你好  | Hello   |
| Welcome | 欢迎    | 欢迎  | Welcome |
| Goodbye | 再见    | 再见  | Goodbye |

### 操作按钮

- **Add New Key**: 添加新的资源键
- **Save All**: 保存所有语言文件的更改
- **Delete**: 删除某个资源键（在每行末尾）

### 支持的操作

✅ 编辑现有值
✅ 修改键名
✅ 添加新键
✅ 删除键
✅ 同时保存多个语言文件

## 🔧 开发模式

### 监视模式（自动重新编译）

```bash
pnpm run watch
```

在另一个终端中按 F5 启动调试。

### 打包扩展（可选）

如果想要打包成 .vsix 文件：

```bash
# 安装 vsce
pnpm install -g @vscode/vsce

# 打包
pnpm run package
```

## 📂 项目结构

```
resx-editor/
├── src/                          # TypeScript 源代码
│   ├── extension.ts             # 扩展入口
│   └── resxEditorProvider.ts    # 自定义编辑器实现
├── out/                          # 编译后的 JavaScript
├── examples/                     # 示例 resx 文件
│   ├── Messages.resx            # 默认语言
│   ├── Messages.zh-CN.resx      # 中文
│   └── Messages.en-US.resx      # 英文
├── package.json                  # 扩展配置
└── tsconfig.json                # TypeScript 配置
```

## ❓ 常见问题

### Q: 如何添加新的语言？

A: 只需创建一个新的 resx 文件，命名格式为 `Messages.[language-code].resx`，例如 `Messages.fr-FR.resx`。编辑器会自动识别并显示。

### Q: 编辑器没有打开？

A: 确保：
1. 文件扩展名是 `.resx`
2. 右键点击文件 -> "Open With" -> "Resx Editor"
3. 或者在 VSCode 设置中将 resx 文件的默认编辑器设置为 "Resx Editor"

### Q: 保存后文件没有更新？

A: 检查文件是否有写入权限，并查看 VSCode 的输出面板是否有错误信息。

## 🎯 下一步

- 自定义扩展以满足你的需求
- 添加更多功能（如搜索、过滤、导入/导出等）
- 发布到 VSCode 市场

祝使用愉快！ 🎉
