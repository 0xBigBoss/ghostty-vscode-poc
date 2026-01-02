# Ghostty WebGL Probe

VS Code extension to validate WebGL2 feasibility for Ghostty-in-VSCode PoC.

## Probes

1. **Capability Probe** - WebGL2 availability, limits, extensions, shader compile
2. **SSBO Microbench** - Data texture upload + instanced draw timing (200x50 grid)
3. **Atlas Sampling** - texelFetch vs normalized sampling parity

## Setup

```bash
cd probe
npm install
npm run compile
```

## Run

### Option A: VS Code Extension Development Host

1. Open this folder in VS Code
2. Press `F5` to launch Extension Development Host
3. Run command: `Ghostty: Run All WebGL Probes`

### Option B: Command Palette

After installing/running in dev host:
- `Ctrl+Shift+P` → "Ghostty: Show Probe Panel" → click "Run All Probes"
- `Ctrl+Shift+P` → "Ghostty: Run All WebGL Probes" (auto-runs)

## Output

- Results appear in the Output channel "Ghostty Probe"
- JSON saved to `artifacts/probe-results-<timestamp>.json`

## Success Criteria (from SPEC.md)

| Metric | Target |
|--------|--------|
| encodeMs + submitMs median | < 2ms |
| waitMs median | < 4ms |
| waitMs p95 | < 8ms |
| Shader compile | OK |
| Atlas bleeding | None |

## Files

```
probe/
├── src/
│   ├── extension.ts       # Extension entry point
│   └── webview/
│       └── probeHtml.ts   # WebGL2 probe harness
├── package.json
├── tsconfig.json
└── eslint.config.mjs
```
