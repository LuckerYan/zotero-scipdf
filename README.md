# SciPDF For Zotero

[![zotero target version](https://img.shields.io/badge/Zotero-7+-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)

English | [简体中文](doc/README-zhCN.md)

## Introduction

SciPDF is a Zotero 7/8/9 plugin for fetching and attaching PDF files to Zotero
items. The project started as a Sci-Hub resolver plugin, and now also includes
several DOI/title based open-access and scholarly-search resolvers.

The plugin integrates with Zotero's built-in
[custom PDF resolvers](https://www.zotero.org/support/kb/custom_pdf_resolvers)
and also provides its own right-click PDF fetching flow. It can try multiple
platforms in sequence, classify `not found` separately from operational errors,
and keep dynamic platform weights so successful platforms are tried earlier next
time.

> Related references:
>
> - [Zotero custom PDF resolvers](https://www.zotero.org/support/kb/custom_pdf_resolvers)
> - [Zotero attachment resolver code](https://github.com/zotero/zotero/blob/5536f8d2bd08ddac9074b9df05b7d205273835e7/chrome/content/zotero/xpcom/attachments.js#L1350)
> - [Zotero Chinese user guide](https://zotero-chinese.com/user-guide/plugins/Zotero-scihub.html#操作步骤)

## Supported Platforms

| Platform         | Lookup key                             | PDF decision rule                                                                             | Notes                                                                                          |
| ---------------- | -------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Semantic Scholar | Title first, DOI as auxiliary evidence | Graph/open-access PDF fields, website PDF visibility fields, search PDF links, ArXiv ID       | Used when the Zotero item has a title.                                                         |
| Google Scholar   | DOI only                               | Extracts visible `[PDF]` links or clearly PDF-like URLs from Scholar results                  | Detects CAPTCHA / unusual-traffic pages as operational errors, not as `not found`.             |
| Unpaywall        | DOI only                               | `best_oa_location.url_for_pdf`, `first_oa_location.url_for_pdf`, `oa_locations[].url_for_pdf` | Landing pages such as `url` or `url_for_landing_page` are not treated as PDFs.                 |
| OpenAlex         | DOI only                               | `primary_location.pdf_url`, `best_oa_location.pdf_url`, `locations[].pdf_url`                 | Uses the DOI direct endpoint `/works/doi:{doi}`. `open_access.oa_url` is not treated as a PDF. |
| Sci-Hub mirrors  | DOI only                               | HTML PDF embeds/iframes/links, mirror-specific APIs/tasks                                     | Includes ALTCHA PoW solving and DDoS-Guard pure HTTP/WebSocket solving where implemented.      |

Current built-in Sci-Hub-style platforms:

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

Special cases:

- `sci-hub.world` is handled through its API endpoint at `fast.wbleb.com`
  instead of parsing the Next.js page directly.
- `sci-hub.ee` is intentionally removed from the default platforms because it
  redirects/submits to `www.tesble.com`; old preset entries are cleaned during
  migration.
- `sci-hub.ru` / `sci-hub.st` can pass the observed DDoS-Guard challenge using
  the built-in pure HTTP/WebSocket solver.
- `sci-hub.su` and similar ALTCHA pages can be solved by the built-in ALTCHA
  proof-of-work solver.

## Lookup Order and Dynamic Weights

The plugin builds a candidate platform list per Zotero item:

- Items with a title can use Semantic Scholar.
- Items with DOI can use Google Scholar, Unpaywall, OpenAlex, and Sci-Hub
  mirrors.
- Items without DOI cannot use DOI-only platforms.

The final order is sorted by `PlatformWeightManager`:

- successful platforms gain weight;
- failed/not-found/error platforms lose weight according to outcome;
- even low-weight platforms remain eligible, so a platform with a bad recent
  history can still be tried for a different paper.

## Not Found vs Error

SciPDF separates true PDF absence from operational failures:

- **Not found**: the platform returned a matching record/page but no usable PDF
  candidate was present.
- **Error**: network failures, HTTP 403/429/5xx, CAPTCHA/challenge pages,
  malformed JSON, failed imports, or other unexpected problems.

The notification UI shows success/warning/error states, truncates long error
messages in the popup, and keeps the full error text copyable for debugging.

## Installation

Download and install the latest release XPI:

```text
https://github.com/syt2/zotero-scipdf/releases/latest/download/sci-pdf.xpi
```

For local builds, use:

```text
.scaffold/build/sci-pdf.xpi
```

On this repository checkout, the latest local build is expected at:

```text
E:\13302\GitHub_Project\zotero-scipdf\.scaffold\build\sci-pdf.xpi
```

Install it in Zotero via:

```text
Tools -> Add-ons -> Install Add-on From File...
```

## Usage

- For items that already existed before installing the plugin, right-click the
  item and run Zotero's full-text/PDF fetch action.
- For newly added DOI items, Zotero can try to download PDFs automatically when
  automatic PDF download is enabled.
- If an item already has a PDF attachment, Zotero may hide or skip the full-text
  fetch action depending on Zotero's own behavior.

## Add or Remove Sci-Hub Sites

The plugin still writes custom Sci-Hub resolvers into Zotero's
`extensions.zotero.findPDFs.resolvers` preference. On first install or preset
migration, it seeds the built-in Sci-Hub mirror list.

To customize Sci-Hub mirrors, open the plugin settings and edit the Sci-Hub URL
field. Multiple sites can be separated by comma characters:

```text
,
，
```

Non-Sci-Hub platforms such as Google Scholar, Unpaywall, OpenAlex, and Semantic
Scholar are built into the fetch flow and are not configured through the Sci-Hub
URL field.

## Development

Install dependencies:

```bash
npm install
```

Check formatting and lint rules:

```bash
npm run lint:check
```

Build and pack the XPI:

```bash
npm run build
```

The build command runs:

```text
zotero-plugin build
TypeScript no-emit check
scripts/pack-xpi.mjs
```

Expected output:

```text
.scaffold/build/sci-pdf.xpi
```

## Recently Verified Examples

The following DOI examples were recently verified against the implemented
resolver logic:

| DOI                            | Platform evidence                     | PDF result                                                         |
| ------------------------------ | ------------------------------------- | ------------------------------------------------------------------ |
| `10.1609/aaai.v39i2.32181`     | Google Scholar / Unpaywall / OpenAlex | `https://ojs.aaai.org/index.php/AAAI/article/download/32181/34336` |
| `10.1007/978-3-031-73404-5_27` | Google Scholar                        | `https://arxiv.org/pdf/2408.05191?`                                |
| `10.1016/j.sbi.2015.06.004`    | Sci-Hub mirrors / `sci-hub.world` API | mirror PDF candidate                                               |

## FAQ

### Why is a paper shown as "Not found" instead of an error?

This means at least one platform found a matching record/page but returned no
usable PDF URL. For example, OpenAlex may have `open_access.oa_url` pointing to a
web page while all `*.pdf_url` fields are empty; this is treated as `not found`.

### Why is a Google Scholar failure shown as an error?

Google Scholar can return CAPTCHA or unusual-traffic pages. These are operational
failures and are reported as errors/challenges, not as true PDF absence.

### Why does a DOI-only platform not run for title-only items?

Google Scholar, Unpaywall, OpenAlex, and Sci-Hub mirror fetchers are intentionally
DOI-only in this plugin. Title-only fallback is handled by Semantic Scholar.

### Can I add more Sci-Hub mirrors?

Yes. Use the plugin settings and separate URLs with `,` or `，`.

## Acknowledgements and Friendly Links

- This project builds on [syt2/zotero-scipdf](https://github.com/syt2/zotero-scipdf).
  Thanks to the original author for the open-source work.
- Friendly link: [Linux.do](https://linux.do/)
