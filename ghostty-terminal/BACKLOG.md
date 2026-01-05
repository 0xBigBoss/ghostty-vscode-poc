# Backlog - Ghostty Terminal Extension

## Quick Wins

- [x] Add keyboard shortcut for "New Terminal" (`Cmd+Shift+T`)
- [x] Cache file existence checks with TTL (avoid repeated round-trips)
- [x] Debounce resize handler (150ms)
- [x] Add `.vscodeignore` for lean extension packaging

## Code Quality

- [ ] Split `webview/main.ts` into modules (FilePathLinkProvider, theme handling, keybindings)
- [ ] Export proper TypeScript types from ghostty-web (eliminate `any` casts)
- [x] Add unit tests for path resolution, message handling, keybinding logic
- [ ] Add integration tests for webview ↔ extension communication

## Performance

- [ ] Batch `checkFileExists` requests (queue paths, single round-trip)
- [ ] Add LRU cache for file existence results
- [ ] Profile and optimize link detection regex

## Features

- [ ] Terminal tabs / split panes
- [x] Copy/paste context menu (browser default)
- [x] Search in terminal (Cmd+F)
- [ ] Scrollback persistence across window reloads
- [ ] Terminal profiles (different shells, env vars)
- [x] Drag-and-drop files into terminal (paste path)
- [ ] Bracketed paste mode support
- [x] Bell notification (visual/audio)

## Developer Experience

- [ ] Publish ghostty-web to npm (replace `file:../ghostty-web`)
- [ ] Add `CHANGELOG.md` for releases
- [ ] Add contributing guide
- [ ] Document architecture (extension ↔ webview ↔ PTY flow)

## Selection & Clipboard

- [x] Verify ghostty-web selection API works correctly
- [x] Double-click to select word
- [x] Triple-click to select line
- [ ] Shift+click to extend selection

## Accessibility

- [ ] Screen reader support (ARIA labels)
- [ ] High contrast theme support
- [ ] Keyboard-only navigation

## Security

- [ ] Stricter file path validation (prevent path traversal)
- [ ] Configurable URL scheme allowlist
- [ ] Workspace-only file links option
