#!/bin/bash
# Compare benchmark results across terminals

set -e

# Check for jq dependency
if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required but not installed."
  echo "  Install via: brew install jq / apt install jq"
  exit 1
fi

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <result1.json> <result2.json> [result3.json ...]"
  echo ""
  echo "Example: $0 results/ghostty-*.json results/Apple_Terminal-*.json"
  exit 1
fi

echo "Terminal Benchmark Comparison"
echo "=============================="
echo ""

# Header
printf "%-20s %12s %12s %12s %12s %12s\n" \
  "Terminal" "Throughput" "Scrollback" "Colors" "Unicode" "Cursor"
printf "%-20s %12s %12s %12s %12s %12s\n" \
  "" "(MiB/s)" "(lines/5s)" "(ms)" "(ms)" "(ms)"
echo "--------------------------------------------------------------------------------"

# Process each result file
for file in "$@"; do
  if [[ ! -f "$file" ]]; then
    echo "Warning: $file not found, skipping"
    continue
  fi

  terminal=$(jq -r '.terminal // "unknown"' "$file" | cut -c1-18)
  throughput=$(jq -r '.results.throughput.mib_per_sec // "-"' "$file")
  scrollback=$(jq -r '.results.scrollback.lines_rendered // "-"' "$file")
  colors=$(jq -r '.results.colors.duration_ms // "-"' "$file")
  unicode=$(jq -r '.results.unicode.duration_ms // "-"' "$file")
  cursor=$(jq -r '.results.cursor.duration_ms // "-"' "$file")

  printf "%-20s %12s %12s %12s %12s %12s\n" \
    "$terminal" "$throughput" "$scrollback" "$colors" "$unicode" "$cursor"
done

echo ""
echo "Note: Higher is better for Throughput and Scrollback. Lower is better for timed tests."
