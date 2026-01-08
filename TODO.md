# TODO - Backlog Implementation

## Completed
- [x] Add CHANGELOG.md for releases (iteration 1)
- [x] Add CONTRIBUTING.md guide (iteration 1)
- [x] Document architecture in docs/ARCHITECTURE.md (iteration 1)
- [x] Bracketed paste mode (already handled by xterm.js DECSET 2004)
- [x] Shift+click to extend selection (native xterm.js feature)
- [x] Scrollback persistence (already implemented with vscode.setState)
- [x] LRU cache for file existence (already implemented in file-cache.ts)

## In Progress
- [ ] Batch checkFileExists requests

## Pending
- [ ] Split webview/main.ts into modules
- [ ] Export proper TypeScript types from ghostty-web
- [ ] Profile and optimize link detection regex
- [ ] Implement split panes

## Blocked
(none)

## Notes
- Many features were already implemented but not marked in backlog
- Split panes is the largest remaining feature
- Code quality items (module splitting, types) can be done incrementally
