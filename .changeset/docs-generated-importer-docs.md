---
"@componode/importer-alibaba-cloud": patch
"@componode/importer-api-url": patch
"@componode/importer-aws": patch
"@componode/importer-azure": patch
"@componode/importer-docker": patch
"@componode/importer-github": patch
"@componode/importer-kubernetes": patch
"@componode/importer-mcp-server": patch
"@componode/importer-web-url": patch
"@componode/backend": patch
---

Docs automation: importer config schemas carry `.describe()` annotations
surfaced through `GET /importers/{name}/schema`; importer docs
(`index.md` table + per-page contract blocks) are generated from
manifests via `docs:importers` and drift-checked in CI along with a
sidebar-coverage check.
