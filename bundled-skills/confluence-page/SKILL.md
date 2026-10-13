---
name: confluence-page
description: Read, find, create or update Confluence pages. Load for a Confluence link (/pages/<id>/, pageId=, /display/), to check a standard / spec in Confluence, or to write docs there.
---

# Confluence pages

Requires the Confluence preset (Settings → MCP Servers → Confluence, URL + personal token). If `confluence_*` tools are missing, say so and point there — do not open Confluence links with `@url` / web fetch (they need auth and return the login page).

Tools are server-prefixed in the tool list (`<server>__confluence_get_page`, …).

## Read

- **Link → page:**
  - `…/pages/248393990/Title` or `…/pages/viewpage.action?pageId=248393990` → `confluence_get_page` with `page_id: "248393990"`;
  - `…/display/SPACE/Page+Title` → `space_key: "SPACE"` + `title: "Page Title"` (decode `+` and `%xx`).
- Body comes back as Markdown. Ask for `format: "storage"` only when you need exact macros / layout.
- Context lives around the page too: `confluence_get_page_children` for sub-pages, `confluence_get_comments` for decisions made in comments, `confluence_get_attachments` for files.
- **Find:** `confluence_search` with `query` (+ `space_key`), or `cql` for precise filters, e.g. `space = HD AND type = page AND title ~ "стандарт" ORDER BY lastmodified DESC`.
- When the page is a standard / requirement for the current code task, quote the rule you follow (short) with the page title and link, and apply it — do not paraphrase it into something stricter or looser.

## Write — only with explicit permission

Pages are visible to the whole team. Before any write, show the user: space, parent page (for new pages), title, and the content (or the diff for updates). Then:

- **New page:** `confluence_create_page` with `space_key`, `title`, `body` (Markdown), `parent_id` if it belongs under a section. Check first with `confluence_search` that a page with this title does not already exist.
- **Update:** read the page first (`confluence_get_page`) — never write from memory. Prefer `mode: "append"` / `"prepend"` for adding a section; use `replace` only when the user wants the whole page rewritten, and keep everything you were not asked to change. Add a short `version_comment`.
- **Comment / labels:** `confluence_add_comment`, `confluence_add_labels`, `confluence_remove_label`.

Markdown support: headings, lists, tables, code blocks, task lists, links; `[[SPACE:Page title]]` links to another page. Complex macros (Jira issue lists, include, status lozenges) → write raw storage with `format: "storage"`, or ask the user to add them in the editor.

## Never

- Paste tokens, passwords, internal hosts / IPs or personal data into pages or comments.
- Copy large parts of other pages — link to them.
- Delete or overwrite content you were not asked to change.

## Report

Page title + link, what was read / changed, version number after the update.
