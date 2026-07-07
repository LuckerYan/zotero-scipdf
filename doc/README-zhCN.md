# SciPDF For Zotero

[![zotero target version](https://img.shields.io/badge/Zotero-7+-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)

[English](../README.md) | 简体中文

## 介绍

SciPDF 是一个用于 Zotero 7 / Zotero 8 / Zotero 9 的 PDF 获取插件。项目最初是
Sci-Hub resolver 插件，现在已经扩展为多平台 PDF 获取器，支持 DOI 检索、标题检索、开放获取
PDF 发现、Scholar 结果页 PDF 提取，以及多个 Sci-Hub 镜像。

插件会结合 Zotero 内置的
[自定义 PDF resolvers](https://www.zotero.org/support/kb/custom_pdf_resolvers)
能力，同时也在右键获取 PDF 流程中实现自己的多平台轮询逻辑。它会区分“确实没有 PDF”和“平台错误 / 验证码 / 网络问题”，并维护动态平台权重：成功率高的平台会被优先尝试，失败多的平台会降权，但不会被完全禁用。

> 相关资料：
>
> - [Zotero 自定义 PDF resolvers](https://www.zotero.org/support/kb/custom_pdf_resolvers)
> - [Zotero 附件解析代码](https://github.com/zotero/zotero/blob/5536f8d2bd08ddac9074b9df05b7d205273835e7/chrome/content/zotero/xpcom/attachments.js#L1350)
> - [Zotero 中文社区相关信息](https://zotero-chinese.com/user-guide/plugins/Zotero-scihub.html#操作步骤)

## 已支持的平台

| 平台             | 检索依据                   | PDF 判定规则                                                                                  | 说明                                                                        |
| ---------------- | -------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Semantic Scholar | 优先标题，DOI 作为辅助证据 | Graph/open-access PDF 字段、网页端 PDF visibility 字段、搜索结果 PDF 链接、ArXiv ID           | 条目有标题时参与。                                                          |
| Google Scholar   | 仅 DOI                     | 从 Scholar 搜索结果提取可见 `[PDF]` 链接或明显 PDF URL                                        | CAPTCHA / unusual traffic 会被识别为平台错误，不会误判为未找到。            |
| Unpaywall        | 仅 DOI                     | `best_oa_location.url_for_pdf`、`first_oa_location.url_for_pdf`、`oa_locations[].url_for_pdf` | `url` / `url_for_landing_page` 这类网页地址不会被当作 PDF。                 |
| OpenAlex         | 仅 DOI                     | `primary_location.pdf_url`、`best_oa_location.pdf_url`、`locations[].pdf_url`                 | 使用 DOI 直查接口 `/works/doi:{doi}`。`open_access.oa_url` 不会被当作 PDF。 |
| Sci-Hub 镜像     | 仅 DOI                     | HTML 中的 PDF embed / iframe / link，或镜像专用 API / 任务接口                                | 已加入 ALTCHA PoW 和部分 DDoS-Guard 纯 HTTP/WebSocket 解算。                |

当前内置的 Sci-Hub 风格平台：

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

特殊处理：

- `sci-hub.world` 不再直接解析 Next.js 页面，而是走 `fast.wbleb.com` 的 API。
- `sci-hub.ee` 已从默认平台移除，因为它实际转交给 `www.tesble.com`；旧 preset 会在迁移时清理。
- `sci-hub.ru` / `sci-hub.st` 可使用内置纯 HTTP/WebSocket 逻辑通过已观察到的 DDoS-Guard 流程。
- `sci-hub.su` 等 ALTCHA 页面可使用内置 ALTCHA proof-of-work 解算。

## 平台顺序和动态权重

插件会按条目内容构造候选平台：

- 条目有标题：可使用 Semantic Scholar。
- 条目有 DOI：可使用 Google Scholar、Unpaywall、OpenAlex、Sci-Hub 镜像。
- 条目没有 DOI：不会使用 DOI-only 平台。

最终顺序由 `PlatformWeightManager` 动态排序：

- 成功的平台会加权；
- 失败、未找到、错误的平台会按结果降权；
- 即使某个平台最近失败很多，也仍然有机会在其它文献中被尝试，不会被永久排除。

## “未找到”和“错误”的区别

SciPDF 会尽量区分两种情况：

- **未找到**：平台找到了记录或正常返回页面，但没有可用 PDF 链接。
- **错误**：网络错误、HTTP 403/429/5xx、验证码/挑战页、JSON 解析失败、Zotero 导入失败等。

通知弹窗会显示成功、警告、错误状态；长错误信息会在弹窗里截断，并保留完整错误文本用于复制排查。

## 安装

下载最新版 XPI：

```text
https://github.com/syt2/zotero-scipdf/releases/latest/download/sci-pdf.xpi
```

本地构建后的 XPI 路径：

```text
.scaffold/build/sci-pdf.xpi
```

在当前仓库中，最新本地构建文件通常位于：

```text
E:\13302\GitHub_Project\zotero-scipdf\.scaffold\build\sci-pdf.xpi
```

在 Zotero 中安装：

```text
工具 -> 附加组件 -> 从文件安装附加组件...
```

## 使用

- 对于安装插件前已经缺失附件的条目，右键条目并执行 Zotero 的查找全文 / 获取 PDF 操作。
- 对于新增的 DOI 条目，如果 Zotero 首选项中开启了自动下载 PDF，Zotero 会自动尝试下载附件。
- 如果条目已经有 PDF 附件，Zotero 可能会隐藏或跳过查找全文操作，这是 Zotero 自身行为。

## 增加 / 删除 Sci-Hub 站点

插件仍然会向 Zotero 的 `extensions.zotero.findPDFs.resolvers` 写入 Sci-Hub 自定义 resolver。首次安装或 preset 迁移时，会写入内置 Sci-Hub 镜像列表。

如需自定义 Sci-Hub 镜像，可以在插件设置里编辑 Sci-Hub URL 字段。多个站点可用以下符号分隔：

```text
,
，
```

注意：Google Scholar、Unpaywall、OpenAlex、Semantic Scholar 是内置在获取流程里的平台，不通过 Sci-Hub URL 输入框配置。

## 开发

安装依赖：

```bash
npm install
```

检查格式和 lint：

```bash
npm run lint:check
```

构建并打包 XPI：

```bash
npm run build
```

`npm run build` 会执行：

```text
zotero-plugin build
TypeScript no-emit 检查
scripts/pack-xpi.mjs
```

构建产物：

```text
.scaffold/build/sci-pdf.xpi
```

## 最近验证过的示例

| DOI                            | 平台证据                              | PDF 结果                                                           |
| ------------------------------ | ------------------------------------- | ------------------------------------------------------------------ |
| `10.1609/aaai.v39i2.32181`     | Google Scholar / Unpaywall / OpenAlex | `https://ojs.aaai.org/index.php/AAAI/article/download/32181/34336` |
| `10.1007/978-3-031-73404-5_27` | Google Scholar                        | `https://arxiv.org/pdf/2408.05191?`                                |
| `10.1016/j.sbi.2015.06.004`    | Sci-Hub 镜像 / `sci-hub.world` API    | 镜像 PDF 候选                                                      |

## 常见问题

### 为什么显示“未找到”而不是“错误”？

这表示至少有一个平台找到了匹配记录或正常页面，但没有可用 PDF URL。例如 OpenAlex 可能存在 `open_access.oa_url` 网页地址，但所有 `*.pdf_url` 字段为空，这种情况会被判定为“未找到”。

### 为什么 Google Scholar 失败时显示错误？

Google Scholar 可能返回 CAPTCHA 或 unusual traffic 页面。这属于平台运行错误 / 挑战页，不是真正的 PDF 不存在，所以会作为错误透传，而不是“未找到”。

### 为什么只有标题、没有 DOI 的条目不会走 Google Scholar / Unpaywall / OpenAlex / Sci-Hub？

这些平台在本插件中被设计为 DOI-only。只有标题的条目会主要由 Semantic Scholar 处理。

### 可以继续添加更多 Sci-Hub 镜像吗？

可以。在插件设置里编辑 Sci-Hub URL 字段，多个 URL 用 `,` 或 `，` 分隔。

## 致谢与友情链接

- 本项目基于原项目 [syt2/zotero-scipdf](https://github.com/syt2/zotero-scipdf) 扩展开发，感谢原作者的开源贡献。
- 友情链接：[Linux.do](https://linux.do/)
