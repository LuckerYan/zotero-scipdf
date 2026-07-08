# Sci-PDF For Zotero

[![Zotero target version](https://img.shields.io/badge/Zotero-7%2B-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)

[English](../README.md) | 简体中文

## 介绍

Sci-PDF 是一个用于 Zotero 7 / 8 / 9 的 PDF 获取插件。它可以根据 Zotero
条目中的 DOI 或标题，自动尝试从多个来源检索 PDF，并将找到的 PDF 附加到对应的
Zotero 条目下面。

当前维护仓库：

```text
https://github.com/LuckerYan/zotero-scipdf
```

本项目基于原开源项目
[syt2/zotero-scipdf](https://github.com/syt2/zotero-scipdf) 修改和完善，感谢原作者的开源贡献。

## 主要功能

- 插件设置页提供自动下载 PDF 开关。
- 支持右键对单篇或多篇 Zotero 条目执行 **获取 PDF**。
- 支持批量获取 PDF，并可配置条目级检索并发数。
- 右下角使用多个 worker 进度弹窗显示当前检索状态。
- 每个 worker 的最终结果会显示在自己的弹窗位置：下载成功、未找到或错误。
- 根据 Zotero item id、DOI、标题去重，避免多个 worker 重复检索同一篇文献。
- 支持多个 PDF 来源，包括开放获取元数据服务、学术搜索结果页和内置 Sci-Hub 风格镜像。
- 支持 GitHub Actions 在线打包 Release XPI。

## 已支持来源

| 来源             | 检索依据        | 说明                                                                      |
| ---------------- | --------------- | ------------------------------------------------------------------------- |
| Semantic Scholar | 标题 / DOI 辅助 | 使用 Graph/open-access 字段、网页 PDF visibility、搜索链接和 ArXiv 信息。 |
| Google Scholar   | DOI             | 提取可见 `[PDF]` 链接或明显 PDF URL；验证码页面会作为平台错误处理。       |
| Unpaywall        | DOI             | 只使用明确的 `url_for_pdf` 字段，不把 landing page 当成 PDF。             |
| OpenAlex         | DOI             | 使用 DOI 查询结果中的明确 `*.pdf_url` 字段。                              |
| Sci-Hub 风格镜像 | DOI             | 使用内置镜像列表，以及部分镜像的专用解析/API 逻辑。                       |

当前内置 Sci-Hub 风格镜像：

```text
https://sci-hub.kvnp.top/
https://www.tesble.com/
https://sci-hub.ru/
https://sci-hub.su/
https://sci-hub.red/
https://sci-hub.box/
https://sci-hub.st/
https://sci-hub.ren/
https://sci-hub.world/
```

当前包含一些特殊处理：

- `sci-hub.world` API / 任务流程。
- 兼容页面的 DDoS-Guard 处理。
- 兼容页面的 ALTCHA proof-of-work 处理。
- 安装或迁移时清理旧 preset resolver。

## 插件设置

在 Zotero 设置中打开 Sci-PDF 面板。

当前设置项：

- **自动下载 PDF**：启用或关闭 Zotero 中的自动 PDF resolver。
- **检索并发数**：控制同时检索多少个 Zotero 条目。范围为 `1`-`5`，默认值为 `3`。

设置页底部还会显示 Sci-PDF 版本号和 GitHub 链接。

## 批量检索逻辑

当多选 Zotero 条目并执行 **获取 PDF** 时：

1. 跳过非普通条目。
2. 根据调用方式跳过已经有 PDF 的条目。
3. 根据 item id、DOI、标题过滤重复文献。
4. 根据设置的并发数启动固定数量的 worker。
5. 每个 worker 领取下一篇尚未被领取的文献，检索完成后在同一位置显示结果，然后继续领取下一篇。

这样既能保持界面清晰，也能避免后台重复检索同一篇文献。

## “未找到”和“错误”的区别

Sci-PDF 会尽量区分两种情况：

- **未找到**：平台正常返回了记录或页面，但没有可用 PDF URL。
- **错误**：网络失败、HTTP 403/429/5xx、验证码/挑战页、响应格式异常、导入失败或其它运行时异常。

长错误信息会在弹窗中截断，并在支持的情况下保留完整信息用于复制和排查。

## 安装

从 GitHub Releases 下载 XPI：

```text
https://github.com/LuckerYan/zotero-scipdf/releases
```

在 Zotero 中安装：

```text
工具 -> 附加组件 -> 从文件安装附加组件...
```

选择：

```text
sci-pdf.xpi
```

必要时重启 Zotero。

## 使用

- 单篇文献：右键 Zotero 条目，选择 **获取 PDF**。
- 批量文献：多选 Zotero 条目，右键选择 **获取 PDF**。
- 自动模式：在 Sci-PDF 设置页打开 **自动下载 PDF**。

如果条目已经有 PDF 附件，Zotero 可能会隐藏或跳过部分内置 PDF 获取操作，这是 Zotero 自身行为。

## 开发

安装依赖：

```bash
npm install
```

启动开发热加载：

```bash
npm start
```

构建并打包 XPI：

```bash
npm run build
```

本地构建产物：

```text
.scaffold/build/sci-pdf.xpi
```

运行测试并打包：

```bash
npm run test
```

## 说明

PDF 来源本身不稳定：平台可能限流、要求挑战验证、删除文件、返回网页而不是 PDF，或者确实没有开放 PDF。因此 Sci-PDF 不能保证 100% 成功，它的目标是自动尝试多个来源，减少手动查找 PDF 的重复劳动。

## 致谢

- 原项目：[syt2/zotero-scipdf](https://github.com/syt2/zotero-scipdf)
- 友情链接：[Linux.do](https://linux.do/)
