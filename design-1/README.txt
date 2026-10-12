DESIGN 1 — COMMIT-PINNED ENGINEERING KNOWLEDGE CLI
==================================================

This folder implements a local Node.js 24 ESM command-line client for the shared
core API in ..\core\index.mjs. It does not contain an organization-specific catalog,
sample portfolio, synthetic repository index, parser, or copied source code.
GitHub remains the source of truth. This CLI does not call GitHub, fetch, publish,
create pull requests, or execute project source code.

Commands and configuration are documented in COMMANDS.txt. Each configured
repository must restrict reads with includePaths. The unit tests use in-memory
core API doubles to check authorization filtering, completeness, and command
behavior without creating a source-derived index.

Before use, a repository administrator must manually install the Design 1 package
as \design-1\, the shared core as \core\, and the contents of .github\ at the
actual target repository root, then review all changes. Merely storing these
templates here does not activate them.
