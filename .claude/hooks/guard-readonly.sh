#!/usr/bin/env bash
# PreToolUse hook: blocks destructive and write operations for ThoughtCurrent agents
# Exit code 2 = block the tool call and send stderr as feedback
set -eu -o pipefail

input=$(cat)
COMMAND=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')

# Block PR merging
if echo "$COMMAND" | grep -qiE "gh\s+pr\s+merge"; then
  echo "BLOCKED: ThoughtCurrent agents must NEVER merge PRs. Only the user merges." >&2
  exit 2
fi

# Block git push
if echo "$COMMAND" | grep -qiE "git\s+push"; then
  echo "BLOCKED: ThoughtCurrent agents must NEVER push code. This is a read-only tool." >&2
  exit 2
fi

# Block destructive git commands
if echo "$COMMAND" | grep -qiE "git\s+(reset\s+--hard|checkout\s+--|clean\s+-f|merge)"; then
  echo "BLOCKED: Destructive git commands are not allowed in ThoughtCurrent." >&2
  exit 2
fi

# Block write API calls via curl
if echo "$COMMAND" | grep -qiE "curl\s+.*-X\s+(POST|PUT|PATCH|DELETE)"; then
  echo "BLOCKED: ThoughtCurrent is read-only. No write API calls allowed." >&2
  exit 2
fi

# Block rm -rf outside output/
if echo "$COMMAND" | grep -qiE "rm\s+-rf\s+" && ! echo "$COMMAND" | grep -q "output/"; then
  echo "BLOCKED: rm -rf only allowed within the output/ directory." >&2
  exit 2
fi

# Block gh issue/pr creation (only manual via GUI)
if echo "$COMMAND" | grep -qiE "gh\s+(issue\s+create|pr\s+create)"; then
  echo "BLOCKED: Issue/PR creation is manual only via the ThoughtCurrent GUI." >&2
  exit 2
fi

exit 0
