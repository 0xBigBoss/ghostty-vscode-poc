# SPEC: Ghostty-in-VSCode WebGL Feasibility PoC

## Goal
Validate whether a **WebGL2 renderer** + ghostty-web (wasm) path can replace xterm.js in VS Code with acceptable performance and feasibility. The PoC targets **bg + text only** to reduce scope and isolate rendering risks.

## Prior Art: ghostty-web (coder/ghostty-web)

**Status as of Jan 2026:** Active, v0.4.0, 1.6k+ stars, npm published (verified via [GitHub](https://github.com/coder/ghostty-web) and [npm](https://npmjs.com/package/ghostty-web)).

Key facts:
- **xterm.js API-compatible** wrapper around libghostty wasm (~400KB bundle)
- Drop-in replacement: `@xterm/xterm` → `ghostty-web`
- WASM-compiled VT parser from Ghostty (same code as native app)
- Zero runtime dependencies
- **Rendering:** Uses Canvas2D (xterm.js style), **not WebGL**
- Mitchell Hashimoto notes wasm performance not yet optimized

Links:
- https://github.com/coder/ghostty-web
- https://npmjs.com/package/ghostty-web
- Live demo: https://ghostty.ondis.co

**Implication:** VT parsing via wasm is solved. Our PoC focuses on **WebGL2 rendering feasibility**—the novel, untested component.

## Background (verified from ghostty repo)
- OpenGL path requires **GL 4.3** and uses **SSBOs (std430)**, **sampler2DRect**, and **layout(origin_upper_left)**. These have no direct WebGL2 equivalents.
- `src/renderer/WebGL.zig` and `src/apprt/browser.zig` are stubs; a WebGL path is effectively a **new renderer**.
- Embedded OpenGL rendering is marked broken; Metal embedded path is real and uses an IOSurface-backed layer.

Relevant ghostty files:
- `src/renderer/OpenGL.zig`
- `src/renderer/opengl/RenderPass.zig`
- `src/renderer/shaders/glsl/*.glsl`
- `src/renderer/WebGL.zig`
- `src/apprt/browser.zig`
- `src/renderer/Metal.zig`

## Confirmed WebGL2 Mismatches
- **SSBO (std430)** → must be replaced (likely data textures).
- **sampler2DRect** → must be replaced (sampler2D + texelFetch or normalized sampling).
- **layout(origin_upper_left)** → must be replaced (explicit Y flip).

## PoC Scope
- **Render:** background color + background cells + text glyphs.
- **Exclude:** images/sixel, custom shaders, background image, inspector, advanced effects.
- **Runtime:** VS Code webview only (WebGL2).

## Architecture: ghostty-web + Custom WebGL Renderer

```
┌─────────────────────────────────────────────────────────┐
│                   VS Code Webview                       │
├─────────────────────────────────────────────────────────┤
│  ghostty-web (npm)          │  Custom WebGL2 Renderer   │
│  ┌───────────────────────┐  │  ┌─────────────────────┐  │
│  │ libghostty-vt (wasm)  │  │  │ Data Textures       │  │
│  │ - VT parsing          │──┼──│ - bgTex (cells)     │  │
│  │ - Key encoding        │  │  │ - fgTex (colors)    │  │
│  │ - Cell grid state     │  │  │ - glyphTex (ids)    │  │
│  └───────────────────────┘  │  └─────────────────────┘  │
│                             │           │               │
│                             │           ▼               │
│                             │  ┌─────────────────────┐  │
│                             │  │ Instanced Draw      │  │
│                             │  │ - texelFetch        │  │
│                             │  │ - Glyph Atlas       │  │
│                             │  └─────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

**Integration approach:**
1. ghostty-web handles VT parsing and provides cell grid state
2. Custom renderer reads cell data and uploads to data textures
3. WebGL2 instanced draw renders cells using glyph atlas

**Key integration question** (addressed by Workstream 5): How does ghostty-web expose cell grid state? Options explored:
- Canvas2D render callback interception
- Direct wasm memory access via ghostty-web internals
- Fork ghostty-web to expose `RenderState` directly

## Single Harness Structure
One VS Code extension + webview that runs five switchable tests in order and emits JSON results.

1. **Webview Capability Probe**
2. **SSBO Replacement Microbench (bg-only)**
3. **Atlas Sampling Parity Test (text-only sampling mechanics)**
4. **Wasm VT Baseline (feed/parse throughput)**
5. **Cell-Grid Extraction Test (ghostty-web integration)**

## Workstream 1 — SSBO Replacement
### Strategy
Replace std430 storage buffers with **data textures** sampled via `texelFetch`.

### Data Texture Layouts (PoC)
- `bgTex`: `RGBA8`, size = `cols x rows`
  - R,G,B = bg color, A = flags/alpha (unused in PoC)
- Optional for text pass:
  - `fgTex`: `RGBA8` (fg color)
  - `glyphTex`: `RGBA8UI` (packed glyph id + style bits)

### Shader Access Pattern
- One instanced draw call.
- Vertex shader uses `gl_InstanceID` → `(cellX, cellY)`.
- `texelFetch(bgTex, ivec2(cellX, cellY), 0)` for bg cell data.
- Avoid per-vertex attributes beyond a bound VAO.

### Metrics
- `encodeMs`: CPU time to fill typed arrays.
- `submitMs`: `texSubImage2D + drawArraysInstanced` time.
- `waitMs`: `clientWaitSync` time (microbench only).
- Optional: GPU timing via `EXT_disjoint_timer_query_webgl2`.

### Success Criteria (200x50)
- `encodeMs + submitMs` median < 2ms.
- `waitMs` median < 4ms (p95 < 8ms).
- If high waits: add dirty-row upload mode and remeasure.

## Workstream 2 — Atlas Sampling Parity
### Strategy A (Pixel-exact)
- `sampler2D` + `texelFetch` in fragment shader.
- `NEAREST` filtering.

### Strategy B (Normalized)
- `sampler2D` + `texture()` with `uv = (px + 0.5) / atlasSize`.
- `NEAREST` or `LINEAR` as needed.

### Tests
- Render grid with 1px borders to detect bleeding.
- Test multiple devicePixelRatio / zoom levels.
- Optional padded atlas (1px border) to mitigate bleed.

### Success Criteria
- No persistent seams/bleeding at common zoom levels.
- No baseline shifts relative to cell grid.

## Workstream 3 — Wasm VT Baseline (via ghostty-web)
### Strategy
Use **ghostty-web** (`npm install ghostty-web`) instead of building a custom wasm shim. This validates:
1. ghostty-web wasm loads and runs in VS Code webview
2. VT parsing throughput meets requirements
3. Integration path for WebGL renderer is viable

### Setup
```bash
npm install ghostty-web@0.4.0
```

```typescript
import { init, Terminal } from 'ghostty-web';
await init();  // loads ~400KB wasm
```

### Inputs
- 10 MiB per workload, fed in 4 KiB chunks:
  1) Plain text flood
  2) SGR-heavy
  3) Cursor/erase-heavy

### Metrics
- Throughput MiB/s (via `term.write()` timing).
- Wasm instantiation time.
- Memory usage (peak byte length).

### Success Criteria
- Plain text > 30 MiB/s.
- SGR-heavy within ~2x of plain text.
- Wasm loads reliably in VS Code webview.
- No per-cell JS callbacks in hot path.

## Workstream 4 — VS Code Webview Probe
### Probe Items
- WebGL2 availability.
- Limits: `MAX_TEXTURE_SIZE`, `MAX_UNIFORM_BLOCK_SIZE`, etc.
- Extensions: `EXT_disjoint_timer_query_webgl2`, `EXT_color_buffer_float`.
- Shader compile sanity: `gl_InstanceID` + `texelFetch`.

### Output
JSON payload logged to VS Code Output channel with device + capability metadata.

## Workstream 5 — Cell-Grid Extraction from ghostty-web
### Goal
Validate that cell-grid state (bg color, fg color, glyph IDs per cell) can be extracted from ghostty-web for use by a custom WebGL renderer.

### Investigation Approaches (in priority order)
1. **RenderState API**: Check if ghostty-web exposes `RenderState` or equivalent via public API
2. **Wasm memory access**: Directly read cell grid from wasm linear memory
3. **Canvas interception**: Hook Canvas2D calls to extract rendered cell data
4. **Fork ghostty-web**: Patch to expose internal `RenderState` struct

### Test Implementation
```typescript
// Attempt to extract cell data after write()
const term = new Terminal({ cols: 80, rows: 24 });
term.write('\x1b[31mRed\x1b[0m Normal');

// Try each extraction method and measure:
// 1. Can we get per-cell bg/fg colors?
// 2. Can we get glyph IDs or codepoints?
// 3. What is the extraction latency?
```

### Metrics
- `extractionViable`: boolean (any method works)
- `extractionMethod`: which approach succeeded
- `extractionLatencyMs`: time to extract full grid
- `dataCompleteness`: what cell attributes are accessible (bg, fg, glyph, style)

### Success Criteria
- At least one extraction method yields per-cell bg/fg colors and glyph data.
- Extraction latency < 1ms for 200x50 grid.
- No per-cell JS callbacks required (batch access only).

## Go / No-Go
**No-Go** if any of:
- WebGL2 context cannot be created reliably in VS Code webview.
- Instanced draw + `texelFetch` pipeline fails to compile/run.
- Full-grid upload+draw exceeds Workstream 1 thresholds (p95 wait > 8ms).
- ghostty-web wasm fails to load or run in VS Code webview.
- Cell-grid extraction from ghostty-web is not viable (Workstream 5 fails).

**Go** if:
- WebGL2 is stable and microbench shows headroom.
- Atlas parity is achieved without persistent seams.
- ghostty-web VT throughput is stable in VS Code webview.
- Cell-grid extraction from ghostty-web is viable (Workstream 5 succeeds).

## Deliverables
- VS Code extension with a single command to run all probes.
- JSON results captured per machine.
- Short report interpreting results and recommending next steps.

## Out of Scope (PoC)
- Images/sixel, background images, custom shaders.
- Input handling and key mapping.
- Full libghostty embedding.

## Immediate Next Steps
1. Implement VS Code probe extension with microbench + JSON output.
2. Validate data texture uploads (full + dirty-row modes).
3. Build atlas sampling tests (texelFetch vs normalized).
4. Integrate ghostty-web npm package; benchmark VT throughput in VS Code webview.
5. Prototype WebGL2 renderer consuming ghostty-web's cell/glyph data.
