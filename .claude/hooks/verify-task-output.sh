#!/usr/bin/env bash
# TaskCompleted hook: verifies that a completed task has actual output
# Exit code 0 = allow task completion
# Exit code 2 = reject completion, send feedback
set -eu -o pipefail

OUTPUT_DIR="/Users/jacksonogles/work/ThoughtCurrent/output"

# Check output directory exists
if [ ! -d "$OUTPUT_DIR" ]; then
  echo "Cannot verify task: output directory does not exist yet." >&2
  exit 0
fi

# Check for empty output files (common failure mode)
empty_files=$(find "$OUTPUT_DIR" -name "*.md" -empty 2>/dev/null | head -5)

if [ -n "$empty_files" ]; then
  echo "Found empty output files. Please populate these before marking task complete:" >&2
  echo "$empty_files" >&2
  exit 2
fi

exit 0
