# SPEC: Terminal Benchmark Suite

## Goal
Provide apples-to-apples performance comparison across terminal emulators to validate ghostty-vscode performance claims.

## Target Terminals
- ghostty-vscode (ghostty-web in VS Code webview)
- VS Code built-in terminal (xterm.js)
- Native Ghostty
- iTerm2
- Terminal.app (baseline)

## Metrics

### 1. Throughput (MiB/s)
Measure raw data rendering speed by timing how long it takes to display large volumes of output.

**Test**: Pipe 10 MiB of base64-encoded random data
```bash
time (cat /dev/urandom | base64 | head -c 10485760)
```

### 2. Scrollback Stress (FPS)
Measure rendering performance under sustained high-frequency output.

**Test**: Rapid line output for 5 seconds
```bash
timeout 5 yes "$(printf 'x%.0s' {1..200})"
```

### 3. Color/SGR Performance
Measure overhead of ANSI escape sequence parsing and rendering.

**Test**: Render 1000 lines with full 256-color cycling
```bash
for i in {1..1000}; do
  for c in {0..255}; do printf "\e[38;5;${c}m█"; done
  echo
done
```

### 4. Unicode Rendering
Measure complex text shaping with mixed-width characters.

**Test**: Render CJK + emoji mixed content
```bash
for i in {1..500}; do
  echo "日本語テスト 🎉🚀💻 中文测试 한국어 テスト emoji: 👨‍👩‍👧‍👦"
done
```

### 5. Cursor Movement
Measure terminal control sequence performance.

**Test**: Random cursor positioning and drawing
```bash
for i in {1..1000}; do
  row=$((RANDOM % 24 + 1))
  col=$((RANDOM % 80 + 1))
  printf "\e[${row};${col}H*"
done
```

## Benchmark Runner

### Design
Shell script that runs in any terminal, outputs structured JSON results. All tests are embedded in run.sh for simplicity.

```
benchmarks/
├── SPEC.md           # This file
├── run.sh            # Main runner (contains all tests)
├── compare.sh        # Results comparison tool
└── results/          # JSON output per terminal
    └── {terminal}-{timestamp}.json
```

### Dependencies
- `jq` - JSON processing (brew install jq / apt install jq)
- `bc` - Floating point math (brew install bc / apt install bc)
- `base64` - Data encoding (usually pre-installed)
- `timeout` / `gtimeout` - Process timeout (brew install coreutils / apt install coreutils)
- `gdate` or `perl` - High-precision timing on macOS (brew install coreutils)

### Output Format
```json
{
  "terminal": "ghostty-vscode",
  "timestamp": "2024-01-15T10:30:00Z",
  "system": {
    "os": "darwin",
    "arch": "arm64",
    "cpu": "Apple M2",
    "memory_gb": 16
  },
  "results": {
    "throughput": {
      "mib_per_sec": 45.2,
      "duration_ms": 228,
      "bytes": 10485760,
      "median_duration_ms": 225,
      "runs": 3
    },
    "scrollback": {
      "lines_rendered": 50000,
      "duration_ms": 5000,
      "estimated_fps": 60,
      "median_duration_ms": 5000,
      "runs": 3
    },
    "colors": {
      "duration_ms": 1200,
      "lines": 1000,
      "colors_per_line": 256,
      "median_duration_ms": 1180,
      "runs": 3
    },
    "unicode": {
      "duration_ms": 800,
      "lines": 500,
      "median_duration_ms": 795,
      "runs": 3
    },
    "cursor": {
      "operations": 1000,
      "duration_ms": 150,
      "median_duration_ms": 148,
      "runs": 3
    }
  }
}
```

### Usage
```bash
# Run all benchmarks in current terminal
./benchmarks/run.sh

# Run specific test
./benchmarks/run.sh throughput

# Compare results
./benchmarks/compare.sh results/*.json
```

## Prior Art Integration

### xterm.js Benchmark
The xterm.js project has its own benchmark at `xterm.js/demo/benchmark/`. Consider:
- Running their benchmark in VS Code's xterm.js terminal
- Extracting comparable metrics
- Noting methodology differences

### vtebench
Reference vtebench patterns for additional test cases if needed.

## Success Criteria
- All benchmarks runnable from any terminal via shell
- Results are reproducible (< 10% variance between runs)
- JSON output enables automated comparison
- Clear winner/loser identification per metric

## Implementation Notes
- Use `gdate` (GNU date) for nanosecond precision on macOS
- Warm up terminal before benchmarks (run simple command first)
- Run each test 3x and report median
- Detect terminal via $TERM_PROGRAM for automatic labeling
