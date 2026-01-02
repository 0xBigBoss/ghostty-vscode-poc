# SPEC: Ghostty-in-VSCode Feasibility PoC

## Goal
Validate whether **ghostty-web** can replace xterm.js in a VS Code webview terminal with acceptable performance and compatibility.

## Approach: Phased Validation

**Phase 1 (this PoC):** Drop-in replacement using ghostty-web's Canvas2D renderer
- Simplest path - ghostty-web is designed as xterm.js drop-in
- Validates wasm loading, API compatibility, and basic performance
- No custom rendering code required

**Phase 2 (future, if needed):** Custom WebGL2 renderer
- Only pursue if Canvas2D performance is insufficient
- Aligns with Mitchell's long-term libghostty-gpu vision
- Significantly more complex - requires cell-grid extraction

## Prior Art: ghostty-web (coder/ghostty-web)

**Status:** Active, v0.4.0, 1.6k+ stars, npm published. See [GitHub](https://github.com/coder/ghostty-web) and [npm](https://npmjs.com/package/ghostty-web) for current status.

Key facts:
- **xterm.js API-compatible** wrapper around libghostty wasm (~400KB bundle)
- Drop-in replacement: `@xterm/xterm` → `ghostty-web`
- WASM-compiled VT parser from Ghostty (same code as native app)
- Zero runtime dependencies
- **Rendering:** Uses Canvas2D (same approach as xterm.js)

Links:
- https://github.com/coder/ghostty-web
- https://npmjs.com/package/ghostty-web
- Live demo: https://ghostty.ondis.co
- Mitchell's libghostty roadmap: https://mitchellh.com/writing/libghostty-is-coming

**libghostty roadmap** (from Mitchell's blog, Sept 2025):
- `libghostty-vt`: Zero-dependency VT parsing + terminal state (available now as Zig module)
- WASM target explicitly planned ("Windows, embedded devices, and the web via WASM")
- Future: GPU rendering lib ("provide us with an OpenGL or Metal surface"), input handling, GTK/Swift frameworks
- ghostty-web is a community project building on this foundation

---

# Phase 1: Drop-in Integration

## Architecture

```
┌─────────────────────────────────────────┐
│           VS Code Webview               │
├─────────────────────────────────────────┤
│  ghostty-web (drop-in for xterm.js)     │
│  ┌───────────────────────────────────┐  │
│  │  libghostty-vt (wasm, ~400KB)     │  │
│  │  - VT parsing                     │  │
│  │  - Terminal state                 │  │
│  │  - Key encoding                   │  │
│  └───────────────────────────────────┘  │
│                  │                      │
│                  ▼                      │
│  ┌───────────────────────────────────┐  │
│  │  Canvas2D Renderer (built-in)     │  │
│  │  - Text rendering                 │  │
│  │  - Colors, styles                 │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

## Workstreams

1. Wasm Loading
2. Basic Terminal Rendering
3. Input Handling
4. Throughput Benchmark
5. VS Code Integration
6. xterm.js API Compatibility

### Workstream 1 — Wasm Loading
Validate ghostty-web wasm loads in VS Code webview sandbox.

**Setup:**
```bash
npm install ghostty-web@0.4.0
```

**Test:**
```typescript
import { init, Terminal } from 'ghostty-web';

const startInit = performance.now();
await init();  // loads ~400KB wasm
const initTime = performance.now() - startInit;

console.log(`Wasm loaded in ${initTime}ms`);
```

**Metrics:**
- `wasmLoadSuccess`: boolean
- `wasmInitTimeMs`: time to load and instantiate wasm
- `wasmBundleSizeKb`: actual bundle size

**Success Criteria:**
- Wasm loads without CSP or sandbox errors
- Init time < 500ms on typical hardware

---

### Workstream 2 — Basic Terminal Rendering
Validate terminal renders correctly with text and colors.

**Test:**
```typescript
const term = new Terminal({ cols: 80, rows: 24 });
term.open(document.getElementById('terminal'));

// Test basic output
term.write('Hello from Ghostty!\r\n');

// Test colors
term.write('\x1b[31mRed \x1b[32mGreen \x1b[34mBlue\x1b[0m\r\n');

// Test cursor movement
term.write('\x1b[10;10HPositioned text');
```

**Metrics:**
- `renderSuccess`: boolean
- `colorsCorrect`: boolean (visual inspection or screenshot comparison)
- `cursorPositionCorrect`: boolean

**Success Criteria:**
- Text renders legibly
- ANSI colors display correctly
- Cursor positioning works

---

### Workstream 3 — Input Handling
Validate keyboard input flows correctly.

**Test:**
```typescript
term.onData((data) => {
  console.log('Input received:', data.split('').map(c => c.charCodeAt(0)));
  // Echo back or send to pty
});

// Test: type characters, arrow keys, ctrl+c, etc.
```

**Metrics:**
- `basicKeysWork`: boolean (a-z, 0-9, enter, backspace)
- `arrowKeysWork`: boolean
- `modifierKeysWork`: boolean (ctrl, alt, shift combos)
- `specialSequencesWork`: boolean (ctrl+c, ctrl+d, etc.)

**Success Criteria:**
- Standard typing works
- Arrow keys produce correct escape sequences
- Ctrl+C sends interrupt (0x03)

---

### Workstream 4 — Throughput Benchmark
Validate performance with high-volume output.

**Test:**
```typescript
const chunks = generateTestData(10 * 1024 * 1024, 4096); // 10 MiB in 4KB chunks

const start = performance.now();
for (const chunk of chunks) {
  await new Promise<void>(resolve => term.write(chunk, resolve));
}
const elapsed = performance.now() - start;

const throughputMiBs = (10 * 1024 * 1024) / elapsed * 1000 / (1024 * 1024);
```

**Workloads:**
1. Plain text flood (ASCII)
2. SGR-heavy (lots of color changes)
3. Cursor/erase-heavy (line clearing, cursor moves)

**Metrics:**
- `plainTextThroughputMiBs`: MiB/s
- `sgrHeavyThroughputMiBs`: MiB/s
- `cursorHeavyThroughputMiBs`: MiB/s
- `peakMemoryMb`: peak wasm memory usage

**Success Criteria:**
- Plain text > 30 MiB/s
- SGR-heavy within ~2x of plain text
- No memory leaks (stable after repeated runs)

---

### Workstream 5 — VS Code Integration
Validate integration with VS Code webview APIs.

**Test:**
- Message passing between extension and webview
- Terminal resize handling
- Theme/color scheme integration
- Focus management

**Metrics:**
- `messagingWorks`: boolean
- `resizeWorks`: boolean
- `themeIntegrationWorks`: boolean

**Success Criteria:**
- Extension can send data to terminal
- Terminal can send input back to extension
- Resize events propagate correctly

---

### Workstream 6 — xterm.js API Compatibility
Validate ghostty-web implements the xterm.js APIs that VS Code terminal relies on.

**Core APIs to verify:**
```typescript
// Terminal lifecycle
new Terminal(options)
term.open(container)
term.dispose()

// I/O
term.write(data, callback?)
term.writeln(data)
term.onData(callback)
term.onBinary(callback)

// Dimensions
term.cols / term.rows
term.resize(cols, rows)
term.onResize(callback)

// Selection
term.select(column, row, length)
term.selectAll()
term.selectLines(start, end)
term.getSelection()
term.hasSelection()
term.clearSelection()
term.onSelectionChange(callback)

// Scrolling
term.scrollLines(amount)
term.scrollPages(amount)
term.scrollToTop()
term.scrollToBottom()
term.scrollToLine(line)

// Buffer access
term.buffer.active
term.buffer.normal
term.buffer.alternate

// Links
term.registerLinkProvider(provider)

// Decorations
term.registerDecoration(options)
```

**Addons used by VS Code (check availability):**
- `@xterm/addon-fit` - auto-resize to container
- `@xterm/addon-webgl` - WebGL renderer (optional, Canvas2D fallback)
- `@xterm/addon-unicode11` - Unicode width handling
- `@xterm/addon-serialize` - terminal state serialization

**Test:**
```typescript
// Check each API exists and is callable
const term = new Terminal();
const apis = {
  write: typeof term.write === 'function',
  onData: typeof term.onData === 'function',
  resize: typeof term.resize === 'function',
  buffer: term.buffer !== undefined,
  // ... etc
};

// Check addon compatibility
const fitAddonWorks = checkFitAddon(term);
const unicodeAddonWorks = checkUnicodeAddon(term);
```

**Metrics:**
- `coreApiCoverage`: percentage of core APIs implemented
- `addonCompatibility`: which addons work / partially work / missing
- `missingCriticalApis`: list of APIs needed but not implemented

**Success Criteria:**
- Core lifecycle APIs work (Terminal, open, dispose, write, onData)
- Resize and dimension APIs work
- Buffer access works (for scrollback, screen reading)
- fit addon works or equivalent functionality exists
- No critical APIs missing for basic terminal operation

---

## Go / No-Go (Phase 1)

**No-Go** if any of:
- Wasm fails to load in VS Code webview (CSP, sandbox issues)
- Rendering is visibly broken or unusable
- Throughput < 30 MiB/s (below target performance)
- Input handling fundamentally broken
- Critical xterm.js API incompatibilities (Workstream 6 fails)

**Go** if:
- Wasm loads reliably
- Rendering is correct (text, colors, cursor)
- Input works (typing, special keys)
- Throughput >= 30 MiB/s
- xterm.js API compatibility sufficient for VS Code use case
- No critical integration blockers

---

## Deliverables (Phase 1)

1. VS Code extension with ghostty-web terminal in webview
2. JSON benchmark results
3. Go/No-Go recommendation for Phase 2

---

## Immediate Next Steps

1. Set up probe extension with ghostty-web dependency
2. Implement Workstream 1: wasm loading test
3. Implement Workstream 2: basic rendering test
4. Implement Workstream 3: input handling test
5. Implement Workstream 4: throughput benchmark
6. Implement Workstream 5: VS Code integration test
7. Implement Workstream 6: xterm.js API compatibility audit
8. Run all workstreams, capture results, make Go/No-Go call

---

# Phase 2: Custom WebGL Renderer (Future)

**Only pursue if Phase 1 shows Canvas2D performance is insufficient.**

This phase would:
- Extract cell-grid state from ghostty-web
- Build custom WebGL2 renderer using data textures
- Replace Canvas2D with GPU-accelerated rendering

Deferred until Phase 1 results are in. See git history for original WebGL-focused spec.

---

## Out of Scope (Both Phases)

- Images/sixel support
- Background images, custom shaders
- Full VS Code terminal replacement (this is a PoC)
- Modifying VS Code core
