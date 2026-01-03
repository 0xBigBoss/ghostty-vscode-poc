# TODO - Probe Refactoring

## Completed
- [x] Phase 1: Extract types to src/lib/types.ts
- [x] Phase 2: Extract data generators to src/lib/data-generators.ts
- [x] Phase 3: Create terminal adapter interface in src/lib/terminal-adapter.ts
- [x] Phase 4: Extract probes to src/lib/probes/
- [x] Phase 5: Set up esbuild bundling
- [x] Phase 6: Create VS Code adapter in src/adapters/vscode/
- [x] Phase 7: Verify build and tests pass

## In Progress

## Pending

## Blocked

## Notes
- Following plan at ~/.claude/plans/validated-crunching-pelican.md
- Working directory: /Users/allen/0xbigboss/ghostty-vscode/probe
- All 10 tests pass
- Both `npm run compile` and `npm run build` succeed
- probeHtml.ts kept for now (tests depend on it); future work can migrate probes to lib/probes/
