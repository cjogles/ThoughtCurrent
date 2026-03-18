Check ThoughtCurrent integration status.

1. For each supported source, check if credentials are available:
   - GitHub: run `gh auth status`
   - Slack: check env `SLACK_BOT_TOKEN` or config
   - Linear: check env `LINEAR_API_KEY`, config, or `~/.config/linear/credentials.toml`
   - Granola: check `~/Library/Application Support/Granola/supabase.json`
   - Sentry: check env `SENTRY_AUTH_TOKEN` or config
   - Datadog: check env `DATADOG_API_KEY` + `DATADOG_APP_KEY` or config
   - PostHog: check env `POSTHOG_API_KEY` or config
   - Trello: check env `TRELLO_API_KEY` + `TRELLO_TOKEN` or config
   - Figma: check env `FIGMA_ACCESS_TOKEN` or config

2. Report status as a table: Source | Status | Details
   - connected: credentials found and valid
   - not configured: no credentials found
   - error: credentials found but invalid

3. Check if output/ directory exists and show compilation state
4. Show which phases have been completed
