#!/usr/bin/env bash
# TeammateIdle hook: validates that a compiler teammate produced output before going idle
# Exit code 0 = allow idle
# Exit code 2 = send feedback, teammate continues working
set -eu -o pipefail

OUTPUT_DIR="/Users/jacksonogles/work/ThoughtCurrent/output"

# Check if output directory exists
if [ ! -d "$OUTPUT_DIR" ]; then
  echo "WARNING: No output directory found. Teammate may not have produced any compilation output." >&2
  exit 0
fi

# Check if any markdown files were created
md_count=$(find "$OUTPUT_DIR" -name "*.md" -not -path "*/.meta/*" 2>/dev/null | wc -l | tr -d ' ')

if [ "$md_count" -eq 0 ]; then
  echo "No markdown output files found in output/. If you were assigned a compilation task, please check your source configuration and try again." >&2
  exit 2
fi

echo "Compilation validation passed: $md_count output files found."
exit 0
