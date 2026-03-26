# ThoughtCurrent

ThoughtCurrent is an MCP server that compiles text from multiple sources (GitHub, Slack, Linear, Granola, Trello, Figma, Gmail) into local markdown files. It runs as a global Claude Code MCP tool, available in every project.

## Stack

- Runtime: Bun (TypeScript)
- Interface: MCP server (stdio transport)
- Output: Local markdown files in `~/work/ThoughtCurrent/output/<preset>/`

## Project Structure

```
src/
  index.ts          # MCP server entry point
  compile.ts        # Compilation pipeline + async job system
  cache.ts          # Per-preset cache management
  presets.ts         # Preset CRUD
  status.ts          # Source health checks
  slack-meta.ts      # Slack channel/user listing
  logger.ts          # Logging infrastructure
  types.ts           # All TypeScript types
  schemas.ts         # Zod validation schemas
  lib/
    extract.ts       # Text extraction (PDF, DOCX, XLSX, PPTX)
    writer.ts        # Markdown output writers (per-source granular output)
  sources/           # Source fetchers (read-only API clients)
    slack.ts, github.ts, gmail.ts, linear.ts, granola.ts, trello.ts, figma.ts
scripts/
  auth-gmail.ts      # Standalone Gmail OAuth script
  auth-trello.ts     # Standalone Trello OAuth script
output/              # Compilation output (gitignored), namespaced by preset
.meta/               # Global metadata (presets.json)
.logs/               # MCP server logs
.env                 # API tokens (centralized)
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `compile` | Start async compilation for a preset (returns job ID) |
| `check_compilation` | Poll compilation job status |
| `check_status` | Health check all configured sources |
| `list_presets` | List all saved presets |
| `save_preset` | Create or update a preset |
| `update_preset` | Update an existing preset |
| `delete_preset` | Delete a preset |
| `clear_output` | Clear output for a preset (optionally per-source) |
| `list_slack_channels` | List Slack channels for preset config |
| `list_slack_users` | List Slack users for preset config |

## Safety Rules

ThoughtCurrent is a **read-only** data pipe:

1. **NEVER modify source systems** — all API calls are GET/read-only
2. **NEVER overwrite .env** — always read first, append or edit individual lines
3. **All source fetchers are read-scoped** — no POST/PUT/PATCH/DELETE to external APIs

## Compilation Output

Output is namespaced by preset name:
```
output/
  messenger-recent/
    _compiled.md        # Chronological merge of all sources
    slack/              # Granular Slack output (by-channel, by-user, by-date)
    github/             # Issues and PRs
    .meta/cache.json    # Per-preset dedup cache
    .logs/              # Per-compilation debug logs (keeps last 10)
    .errors/            # Persistent error reports (auto-clear on success)
```

## Code Quality

Use `bun run fix-and-check` for all code quality tasks.

## Authentication

Tokens live in `~/work/ThoughtCurrent/.env`. For OAuth sources:
- Gmail: `! bun run ~/work/ThoughtCurrent/scripts/auth-gmail.ts`
- Trello: `! bun run ~/work/ThoughtCurrent/scripts/auth-trello.ts`

## Git

- Never force push
- Never merge PRs — only the user merges
