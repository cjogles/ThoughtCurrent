# ThoughtCurrent

ThoughtCurrent compiles text from multiple sources (GitHub, Slack, Linear, Granola, Sentry, Datadog, PostHog, Trello, Figma, local docs) into a single source of truth as local markdown files.

## Stack

- Runtime: Bun (TypeScript)
- Frontend: Vite + React + shadcn/ui
- Backend: Hono on Bun
- Agent execution: Claude Code Agent Teams
- Output: Local markdown files (no database for v1)

## Project Structure

```
packages/
  server/     # Hono API server
  web/        # Vite React SPA
  shared/     # Shared TypeScript types
prd/          # Product requirements
output/       # Compilation output (gitignored)
```

## Safety Rules — ABSOLUTE, NON-NEGOTIABLE

ThoughtCurrent is a **read-only** tool. All agents MUST follow these rules:

1. **NEVER modify source systems** — no writing to Slack, GitHub, Linear, Sentry, Datadog, PostHog, Trello, Figma, or any external service
2. **NEVER push code** — no `git push`, no `gh pr create`, no `gh issue create` unless explicitly triggered by user button click in the GUI
3. **NEVER merge PRs** — `gh pr merge` is always blocked
4. **NEVER delete files** outside the `output/` directory
5. **ONLY read and write to `output/`** and project source files during development
6. **All API calls are read-only** — GET requests only, no POST/PUT/PATCH/DELETE to external APIs (except MCP tool calls which are read-scoped)

## Code Quality

Use `pnpm run fix-and-check` for all code quality tasks. Do NOT run individual lint, format, or typecheck commands separately.

## Compilation Output

All compiled text goes to `output/` as markdown files. Each source gets its own directory. `_compiled.md` merges everything chronologically. `.meta/` stores compilation metadata, cache, and AI summaries.

## Agent Team Conventions

- Compiler agents are teammates, not subagents
- Each compiler agent handles one source
- Agents communicate via SendMessage to team lead and each other
- Monitor context window usage — respawn at ~80% with compacted output
- Research agents (Phase 2) have WebSearch and WebFetch access
- All agents read the output directory to orient themselves on fresh context

## Git

- Never add Co-Authored-By lines to commits
- Never force push
- Never merge PRs — only the user merges
