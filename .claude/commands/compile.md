Run a ThoughtCurrent compilation. This is the core Phase 1 workflow.

1. Read the configuration from `~/.config/thoughtcurrent/config.json` (or use defaults)
2. Check integration status — which sources are authenticated and ready
3. Ask the user for: date range and optional keyword/topic filter
4. Create an agent team with compiler teammates for each enabled source
5. Each teammate:
   - Reads from its assigned source using MCP tools or direct API
   - Saves verbatim text as markdown in `output/<source>/`
   - Reports progress via SendMessage to team lead
   - Checks `output/.meta/cache.json` for incremental compilation (skip cached items)
6. Team lead monitors progress, respawns teammates at ~80% context usage
7. When all sources complete, generate `output/_compiled.md` (chronological merge)
8. Generate AI summaries for dashboard cards → `output/.meta/summaries.json`

SAFETY: All teammates are read-only. They must NEVER write to external systems.
