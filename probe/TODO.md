# TODO - Matrix Rain Demo

## Completed
- [x] Create Matrix rain engine (src/lib/demos/matrix-rain.ts)
- [x] Create demos index export (src/lib/demos/index.ts)
- [x] Add UI controls to template.html (start/stop toggle, speed slider)
- [x] Add metrics panel to template.html (MiB/s, FPS, chars/sec)
- [x] Add Matrix-themed styles to styles.css
- [x] Wire up controls in main.ts with message handlers
- [x] Register commands in extension.ts (start, stop, getMetrics)
- [x] Add command contributions to package.json
- [x] Add Matrix demo integration test
- [x] Fix startMatrixDemo to stop existing instance before starting new one (ISSUE-1)
- [x] Add getMatrixMetrics command to package.json contributes.commands (ISSUE-2)

## In Progress

## Pending

## Blocked

## Notes
- Following plan at ~/.claude/plans/validated-crunching-pelican.md
- Working directory: /Users/allen/0xbigboss/ghostty-vscode/probe
- 11/11 tests pass (including new Matrix demo test)
- Matrix demo achieves 121 FPS with 241 frames rendered in 2 second test
- Fixed race condition in waitForResults by clearing stale results on runAll
- Fixed orphaned animation loop issue when startMatrixDemo called multiple times
