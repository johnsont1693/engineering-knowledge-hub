# GitHub-Native Engineering Knowledge Hub

Turn approved Git repositories into inspectable, source-cited engineering
knowledge. This self-contained prototype includes a commit-pinned collector
and command-line interface designed to run alongside GitHub repositories.

Use it to locate implementation evidence, compare extracted facts across
repositories, and inspect repository profiles without treating generated
summaries as approved standards.

## What it does

- Reads only Git objects at an exact commit and only paths explicitly allowed by
  a human-reviewed configuration.
- Extracts supported source facts with repository, commit, path, line, and blob
  citations.
- Provides literal search, fact comparison, repository profiles, and explicit
  partial/unknown coverage states.
- Includes GitHub Actions and Copilot configuration examples under
  `design-1/.github/`. They are templates and are not active at this repository
  root.

## Run locally

Requirements: Node.js 24+ and Git. No package installation is needed.

```powershell
Push-Location .\core
node --test .\test\index.test.mjs
Pop-Location

Push-Location .\design-1
npm test
Pop-Location
```

See `design-1\COMMANDS.txt` for configuration, ingestion, query, and comparison
commands. The collector fails closed unless every repository has an explicit
path allowlist. Review the source owner's authorization and data-retention rules
before indexing or storing any source content.

## Scope and status

This is a local prototype, not a deployed enterprise system. Bring your own
approved source checkouts, exact commit SHAs, path allowlists, access groups,
and human-reviewed application mappings. No organization-specific source,
inventory, standards, source-derived index, or credentials are bundled.

Search is lexical, not semantic. Missing evidence remains unknown. CLI access
groups filter results but do not authenticate users; restrict local filesystem
and shell access to authorized operators. Unit tests use generated fixtures,
not evidence about any organization's repositories.

The GitHub templates have not been installed in another repository. This
prototype does not establish GitHub identity or production authorization, call
Foundry, provision Azure resources, publish generated indexes, or open pull
requests. An owner must review and install any template before use.

## Companion architecture

The [Engineering Knowledge Service](https://github.com/johnsont1693/engineering-knowledge-service)
exposes the same collector through a local API and MCP server with SQLite
storage. Each repository includes its own copy of the collector and contract,
so neither requires the other to run. Shared changes must be kept in sync.
