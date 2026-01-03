#!/bin/bash
# Terminal Benchmark Suite
# Run from any terminal to measure performance

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="$SCRIPT_DIR/results"
NUM_RUNS=3  # Run each test 3x and report median

# Check dependencies upfront with actionable guidance
check_dependencies() {
  local missing=()

  if ! command -v jq &>/dev/null; then
    missing+=("jq (install via: brew install jq / apt install jq)")
  fi
  if ! command -v bc &>/dev/null; then
    missing+=("bc (install via: brew install bc / apt install bc)")
  fi
  if ! command -v base64 &>/dev/null; then
    missing+=("base64 (usually pre-installed, check coreutils)")
  fi
  if ! command -v timeout &>/dev/null && ! command -v gtimeout &>/dev/null; then
    missing+=("timeout (install via: brew install coreutils / apt install coreutils)")
  fi

  # ISSUE-8: Check for timing command on macOS
  if [[ "$(uname)" == "Darwin" ]]; then
    if ! command -v gdate &>/dev/null && ! command -v perl &>/dev/null; then
      missing+=("gdate or perl (install gdate via: brew install coreutils)")
    fi
  fi

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "ERROR: Missing required dependencies:"
    for dep in "${missing[@]}"; do
      echo "  - $dep"
    done
    exit 1
  fi
}

# Detect terminal
detect_terminal() {
  if [[ -n "$TERM_PROGRAM" ]]; then
    echo "$TERM_PROGRAM"
  elif [[ -n "$TERMINAL_EMULATOR" ]]; then
    echo "$TERMINAL_EMULATOR"
  else
    echo "unknown"
  fi
}

# Cross-platform system info with proper JSON escaping
get_system_info() {
  local os=$(uname -s | tr '[:upper:]' '[:lower:]')
  local arch=$(uname -m)
  local cpu="unknown"
  local memory_gb=0

  if [[ "$os" == "darwin" ]]; then
    cpu=$(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo "unknown")
    local memsize=$(sysctl -n hw.memsize 2>/dev/null || echo 0)
    memory_gb=$(( memsize / 1024 / 1024 / 1024 ))
  elif [[ -f /proc/cpuinfo ]]; then
    # Linux with /proc
    cpu=$(grep "model name" /proc/cpuinfo 2>/dev/null | head -1 | cut -d: -f2 | xargs || echo "unknown")
    local memkb=$(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}' || echo 0)
    if [[ -n "$memkb" && "$memkb" -gt 0 ]]; then
      memory_gb=$(( memkb / 1024 / 1024 ))
    fi
  else
    # Fallback for other Unix (FreeBSD, etc.)
    cpu=$(sysctl -n hw.model 2>/dev/null || echo "unknown")
    local memsize=$(sysctl -n hw.physmem 2>/dev/null || echo 0)
    if [[ -n "$memsize" && "$memsize" -gt 0 ]]; then
      memory_gb=$(( memsize / 1024 / 1024 / 1024 ))
    fi
  fi

  # Use jq for proper JSON escaping of CPU string
  jq -n \
    --arg os "$os" \
    --arg arch "$arch" \
    --arg cpu "$cpu" \
    --argjson mem "$memory_gb" \
    '{os: $os, arch: $arch, cpu: $cpu, memory_gb: $mem}'
}

# High-precision timing (milliseconds)
now_ms() {
  if command -v gdate &>/dev/null; then
    gdate +%s%3N
  elif [[ "$(uname)" == "Darwin" ]]; then
    # macOS date doesn't support %N, use perl (checked in dependencies)
    perl -MTime::HiRes=time -e 'printf "%.0f\n", time * 1000'
  else
    date +%s%3N
  fi
}

# Cross-platform timeout command
get_timeout_cmd() {
  if command -v gtimeout &>/dev/null; then
    echo "gtimeout"
  else
    echo "timeout"
  fi
}

# Temporary files for capturing results
RESULT_FILE=$(mktemp)
ALL_RESULTS_FILE=$(mktemp)
trap "rm -f $RESULT_FILE $ALL_RESULTS_FILE" EXIT

# Throughput test: 10 MiB of data
test_throughput() {
  local bytes=10485760  # 10 MiB
  local start=$(now_ms)

  # Generate and display data TO THE TERMINAL (stdout)
  cat /dev/urandom | base64 | head -c $bytes

  local end=$(now_ms)
  local duration=$((end - start))
  # Handle division with bc, avoiding division by zero
  local mib_per_sec
  if [[ $duration -gt 0 ]]; then
    mib_per_sec=$(echo "scale=2; $bytes / 1048576 / ($duration / 1000)" | bc)
  else
    mib_per_sec="0"
  fi

  # Write JSON to temp file (not stdout, so output renders)
  echo "{\"mib_per_sec\":$mib_per_sec,\"duration_ms\":$duration,\"bytes\":$bytes}" > "$RESULT_FILE"
}

# ISSUE-7: Scrollback stress test using timeout+yes per SPEC
test_scrollback() {
  local line=$(printf 'x%.0s' {1..200})
  local timeout_cmd=$(get_timeout_cmd)
  local start=$(now_ms)

  # Use timeout + yes as per SPEC to avoid timing overhead in loop
  # Count lines by piping through wc -l
  local count=$($timeout_cmd 5 yes "$line" 2>/dev/null | tee /dev/tty | wc -l)

  local end=$(now_ms)
  local duration=$((end - start))
  local estimated_fps=0
  if [[ $duration -gt 0 ]]; then
    estimated_fps=$(echo "scale=0; $count / ($duration / 1000)" | bc)
  fi

  echo "{\"lines_rendered\":$count,\"duration_ms\":$duration,\"estimated_fps\":$estimated_fps}" > "$RESULT_FILE"
}

# Color rendering test - 1000 lines as per SPEC
test_colors() {
  local start=$(now_ms)

  for i in {1..1000}; do
    for c in {0..255}; do
      printf "\e[38;5;${c}m█"
    done
    echo -e "\e[0m"
  done

  local end=$(now_ms)
  echo "{\"duration_ms\":$((end - start)),\"lines\":1000,\"colors_per_line\":256}" > "$RESULT_FILE"
}

# Unicode rendering test
test_unicode() {
  local start=$(now_ms)

  for i in {1..500}; do
    echo "日本語テスト 🎉🚀💻 中文测试 한국어 テスト emoji: 👨‍👩‍👧‍👦"
  done

  local end=$(now_ms)
  echo "{\"duration_ms\":$((end - start)),\"lines\":500}" > "$RESULT_FILE"
}

# Cursor movement test
test_cursor() {
  local start=$(now_ms)
  local ops=1000

  # Clear screen and hide cursor
  printf "\e[2J\e[?25l"

  for i in $(seq 1 $ops); do
    local row=$((RANDOM % 24 + 1))
    local col=$((RANDOM % 80 + 1))
    printf "\e[${row};${col}H*"
  done

  # Show cursor and reset
  printf "\e[?25h\e[H\e[2J"

  local end=$(now_ms)
  echo "{\"operations\":$ops,\"duration_ms\":$((end - start))}" > "$RESULT_FILE"
}

# ISSUE-6: Run test multiple times and select the result from the median run
run_test_with_median() {
  local test_func=$1
  local test_name=$2

  # Clear results array file
  echo "[]" > "$ALL_RESULTS_FILE"

  echo "  Running $NUM_RUNS iterations..."
  for run in $(seq 1 $NUM_RUNS); do
    echo "    Run $run/$NUM_RUNS"
    $test_func
    local result=$(cat "$RESULT_FILE")

    # Append result to array
    local current=$(cat "$ALL_RESULTS_FILE")
    echo "$current" | jq --argjson r "$result" '. + [$r]' > "$ALL_RESULTS_FILE"
  done

  # Sort by duration_ms and pick the median (middle) result
  # This ensures all metrics (mib_per_sec, lines_rendered, etc.) come from the same run
  local sorted=$(cat "$ALL_RESULTS_FILE" | jq 'sort_by(.duration_ms)')
  local mid_idx=$((NUM_RUNS / 2))

  # Extract the median run's duration for the metadata field
  local median_duration=$(echo "$sorted" | jq ".[$mid_idx].duration_ms")

  # Extract the median run's complete result and add metadata (including median_duration_ms per SPEC)
  echo "$sorted" | jq --argjson runs "$NUM_RUNS" --argjson med "$median_duration" \
    ".[$mid_idx] + {median_duration_ms: \$med, runs: \$runs}" > "$RESULT_FILE"
}

# Run all tests or specific test
run_benchmarks() {
  local test_name="${1:-all}"
  local terminal=$(detect_terminal)
  local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  local system_info=$(get_system_info)

  echo "Terminal Benchmark Suite"
  echo "========================"
  echo "Terminal: $terminal"
  echo "Started: $timestamp"
  echo "Runs per test: $NUM_RUNS (reporting median)"
  echo ""

  # Warm up
  echo "Warming up..."
  for i in {1..100}; do echo -n "."; done
  echo ""
  echo ""

  local results="{}"

  if [[ "$test_name" == "all" || "$test_name" == "throughput" ]]; then
    echo "Running throughput test (10 MiB)..."
    run_test_with_median test_throughput "throughput"
    local throughput=$(cat "$RESULT_FILE")
    results=$(echo "$results" | jq --argjson t "$throughput" '. + {throughput: $t}')
    echo "  Result: $throughput"
    echo ""
  fi

  if [[ "$test_name" == "all" || "$test_name" == "scrollback" ]]; then
    echo "Running scrollback test (5 seconds)..."
    run_test_with_median test_scrollback "scrollback"
    local scrollback=$(cat "$RESULT_FILE")
    results=$(echo "$results" | jq --argjson s "$scrollback" '. + {scrollback: $s}')
    echo "  Result: $scrollback"
    echo ""
  fi

  if [[ "$test_name" == "all" || "$test_name" == "colors" ]]; then
    echo "Running colors test (1000 lines)..."
    run_test_with_median test_colors "colors"
    local colors=$(cat "$RESULT_FILE")
    results=$(echo "$results" | jq --argjson c "$colors" '. + {colors: $c}')
    echo "  Result: $colors"
    echo ""
  fi

  if [[ "$test_name" == "all" || "$test_name" == "unicode" ]]; then
    echo "Running unicode test..."
    run_test_with_median test_unicode "unicode"
    local unicode=$(cat "$RESULT_FILE")
    results=$(echo "$results" | jq --argjson u "$unicode" '. + {unicode: $u}')
    echo "  Result: $unicode"
    echo ""
  fi

  if [[ "$test_name" == "all" || "$test_name" == "cursor" ]]; then
    echo "Running cursor test..."
    run_test_with_median test_cursor "cursor"
    local cursor=$(cat "$RESULT_FILE")
    results=$(echo "$results" | jq --argjson c "$cursor" '. + {cursor: $c}')
    echo "  Result: $cursor"
    echo ""
  fi

  # Build final JSON
  local output_file="$RESULTS_DIR/${terminal}-$(date +%Y%m%d-%H%M%S).json"

  jq -n \
    --arg terminal "$terminal" \
    --arg timestamp "$timestamp" \
    --argjson system "$system_info" \
    --argjson results "$results" \
    '{terminal: $terminal, timestamp: $timestamp, system: $system, results: $results}' \
    > "$output_file"

  echo "========================"
  echo "Results saved to: $output_file"
  echo ""
  cat "$output_file"
}

# Main
check_dependencies
mkdir -p "$RESULTS_DIR"
run_benchmarks "$1"
