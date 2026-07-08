# Sci-PDF For Zotero

[![Zotero target version](https://img.shields.io/badge/Zotero-7%2B-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)

English | [简体中文](doc/README-zhCN.md)

## Introduction

Sci-PDF is a Zotero 7/8/9 plugin for fetching and attaching PDF files to Zotero
items. It can try multiple DOI/title based sources, attach a found PDF to the
current Zotero item, and provide a right-click batch fetching workflow for items
that do not yet have PDF attachments.

This fork is maintained at:

```text
https://github.com/LuckerYan/zotero-scipdf
```

The project was originally based on
[syt2/zotero-scipdf](https://github.com/syt2/zotero-scipdf). Thanks to the
original author for the open-source work.

## Main Features

- Automatic PDF download switch in the plugin preferences.
- Right-click **Get PDF** action for one or more selected Zotero items.
- Batch PDF fetching with configurable item-level concurrency.
- Independent worker progress cards in the bottom-right corner.
- Worker-specific final result cards: success, not found, or error.
- Duplicate suppression by Zotero item id, DOI, and title to avoid fetching the
  same paper in multiple workers.
- Multiple resolver sources, including open-access metadata services, scholarly
  search pages, and built-in Sci-Hub-style mirrors.
- GitHub Actions release workflow for online XPI packaging.

## Supported Sources

| Source             | Lookup key          | Notes                                                                                             |
| ------------------ | ------------------- | ------------------------------------------------------------------------------------------------- |
| Semantic Scholar   | Title / DOI context | Uses graph/open-access fields, website PDF visibility fields, search links, and ArXiv evidence.   |
| Google Scholar     | DOI                 | Extracts visible `[PDF]` links or PDF-like URLs; CAPTCHA pages are treated as operational errors. |
| Unpaywall          | DOI                 | Uses explicit `url_for_pdf` fields only; landing pages are not treated as PDFs.                   |
| OpenAlex           | DOI                 | Uses explicit `*.pdf_url` fields from DOI lookup results.                                         |
| Sci-Hub-style URLs | DOI                 | Uses built-in mirror list and mirror-specific parsing/API logic where implemented.                |

Current built-in Sci-Hub-style mirrors:

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

Special handling currently includes:

- `sci-hub.world` API/task flow.
- DDoS-Guard handling for observed compatible mirrors.
- ALTCHA proof-of-work handling for compatible pages.
- Cleanup of stale preset resolver entries during migration.

## Preferences

Open Zotero preferences and find the Sci-PDF panel.

Available options:

- **Automatic PDF Download**: enables or disables automatic resolver entries in
  Zotero.
- **Fetch concurrency**: controls how many Zotero items are fetched in parallel.
  The value is clamped to `1`-`5`, with default `3`.

The preferences page also shows the Sci-PDF version and a GitHub link.

## Batch Fetching Behavior

When multiple Zotero items are selected and **Get PDF** is triggered:

1. Non-regular items are skipped.
2. Items that already have a PDF can be skipped depending on the caller.
3. Duplicate items/papers are filtered by item id, DOI, and title.
4. A fixed number of workers is started according to the configured concurrency.
5. Each worker claims the next unclaimed item, fetches it, shows its result in
   the same worker slot, then continues with another unclaimed item.

This keeps the UI readable while also avoiding duplicate background work.

## Not Found vs Error

Sci-PDF tries to distinguish real PDF absence from platform failures:

- **Not found**: a source returned a matching record/page but no usable PDF URL.
- **Error**: network failures, HTTP 403/429/5xx, CAPTCHA/challenge pages,
  malformed responses, failed imports, or unexpected runtime failures.

Long error messages are truncated in the popup, with full details available for
copy/debugging where supported.

## Installation

Download the XPI from GitHub Releases:

```text
https://github.com/LuckerYan/zotero-scipdf/releases
```

Install it in Zotero:

```text
Tools -> Add-ons -> Install Add-on From File...
```

Select:

```text
sci-pdf.xpi
```

Then restart Zotero if needed.

## Usage

- Single item: right-click a Zotero item and choose **Get PDF**.
- Batch mode: select multiple Zotero items and choose **Get PDF**.
- Automatic mode: enable **Automatic PDF Download** in the Sci-PDF preferences.

If an item already has a PDF attachment, Zotero may hide or skip some built-in
PDF-fetch actions. This is Zotero's own behavior.

## Development

Install dependencies:

```bash
npm install
```

Start development hot reload:

```bash
npm start
```

Build and pack the XPI:

```bash
npm run build
```

Expected local build output:

```text
.scaffold/build/sci-pdf.xpi
```

Run tests and pack XPI:

```bash
npm run test
```

## Notes

PDF discovery is inherently unstable: sources can rate-limit requests, require
challenges, remove files, return landing pages instead of PDFs, or simply not
have an open PDF available. Sci-PDF cannot guarantee 100% success; it is meant to
reduce repetitive manual PDF searching by trying multiple sources automatically.

## Acknowledgements

- Original project: [syt2/zotero-scipdf](https://github.com/syt2/zotero-scipdf)
- Friendly link: [Linux.do](https://linux.do/)
