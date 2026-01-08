# TODO - Backlog Implementation

## Completed
- [x] Add CHANGELOG.md for releases (iteration 1)
- [x] Add CONTRIBUTING.md guide (iteration 1)
- [x] Document architecture in docs/ARCHITECTURE.md (iteration 1)
- [x] Bracketed paste mode (already handled by xterm.js DECSET 2004)
- [x] Shift+click to extend selection (native xterm.js feature)
- [x] Scrollback persistence (already implemented with vscode.setState)
- [x] LRU cache for file existence (already implemented in file-cache.ts)
- [x] Batch checkFileExists requests (50ms debounce, parallel fs.stat)
- [x] Profile and optimize link detection regex (pre-compiled, early-out)

## Completed (Iteration 2)
- [x] Split webview/main.ts into modules (503 lines -> 4 focused modules)
  - file-link-provider.ts (207 lines)
  - search-controller.ts (254 lines)
  - theme-utils.ts (100 lines)

## Pending
- [ ] Export proper TypeScript types from ghostty-web (requires ghostty-web changes)
- [ ] Implement split panes (large feature)

## Notes
- Many features were already implemented but not marked in backlog
- Split panes is the largest remaining feature
- Code quality items (module splitting, types) can be done incrementally

## Blocked
(none)

## Notes
- Many features were already implemented but not marked in backlog
- Split panes is the largest remaining feature
- Code quality items (module splitting, types) can be done incrementally
