# PDF Translator Bridge for Zotero

面向 Zotero 7 / 8 / 10 的超轻量级桥接插件（打包后仅 **5 KB**）。

所有界面、翻译引擎、服务配置（SiliconFlow Free / DeepSeek / OpenAI / 自定义）、中英对照阅读、双向光标联动、中英双向搜索以及独立存储均统一集成在 **PDF Translator for macOS** 桌面软件中；Zotero 端仅保留极简的一键唤起入口，绝不给 Zotero 增加负担或污染文献库。

## 快捷入口

- **文献列表右键**：在任意含 PDF 的条目上右键 → **在 PDF Translator 中对照阅读**
- **PDF 阅读器工具栏**：点击 Zotero 内置 PDF 阅读器顶部的翻译图标
- **全局快捷键**：按下 **`⌥⌘T`** 一键将当前选中或正在阅读的论文交给 PDF Translator 打开
- **工具菜单**：**工具 → 打开 PDF Translator**

## 安装 / 重新打包

```sh
./zotero-plugin/build.sh
```

安装包输出为 `dist/pdf-translator-zotero.xpi`（在 Zotero 中通过 **工具 → 插件 → Install Add-on From File…** 安装）。
