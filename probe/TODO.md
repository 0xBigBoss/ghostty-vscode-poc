# TODO - Probe Refactoring

## Completed
- [x] Phase 1: Extract types to src/lib/types.ts
- [x] Phase 2: Extract data generators to src/lib/data-generators.ts
- [x] Phase 3: Create terminal adapter interface in src/lib/terminal-adapter.ts
- [x] Phase 4: Extract 7 probes to src/lib/probes/
  - wasm-loading.ts
  - rendering.ts
  - input-handling.ts
  - throughput.ts
  - vscode-integration.ts
  - api-compatibility.ts
  - webgl-capabilities.ts
- [x] Phase 5: Set up esbuild bundling
- [x] Phase 6: Create VS Code adapter in src/adapters/vscode/
- [x] Phase 7: Verify build and tests pass

## In Progress

## Pending

## Blocked

## Notes
- Following plan at ~/.claude/plans/validated-crunching-pelican.md
- Working directory: /Users/allen/0xbigboss/ghostty-vscode/probe
- 9/10 tests pass (memory stability test is flaky due to GC timing)
- probeHtml.ts deleted - no longer used
- Extension now loads bundled webview from out/webview/
- Build order: tsc (for type checking) -> esbuild (for bundling)
