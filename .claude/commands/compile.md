Run a ThoughtCurrent compilation. This is the core Phase 1 workflow.

1. Use the `list_presets` MCP tool to show available presets
2. Ask the user which preset to compile (or help create one with `save_preset`)
3. Use the `compile` MCP tool with the chosen preset name — this returns a job ID
4. Poll with `check_compilation` using the job ID until status is "completed" or "failed"
5. Report results: items compiled per source, any failures with error details
6. Tell the user where to find output: `~/work/ThoughtCurrent/output/<preset>/`
7. If there are errors, read the error reports at `output/<preset>/.errors/` and suggest fixes

SAFETY: ThoughtCurrent is read-only. All source fetchers only read from external APIs.
