Check ThoughtCurrent integration status.

1. Use the `check_status` MCP tool to get health checks for all sources
2. Display results as a table: Source | Status | Details
   - connected: credentials found and valid
   - not_configured: no credentials found
   - error: credentials found but invalid
3. Use `list_presets` to show configured presets
4. For any not_configured or errored sources, suggest the fix:
   - OAuth sources: run the auth script (e.g., `! bun run ~/work/ThoughtCurrent/scripts/auth-gmail.ts`)
   - Token sources: add the token to `~/work/ThoughtCurrent/.env`
