# TODO - Ghostty Terminal Extension Implementation

## Completed
- [x] Phase 1: Project structure (package.json, tsconfig, esbuild.config.mjs) - iteration 1
- [x] Phase 2: Type definitions (terminal.ts, messages.ts) - iteration 1
- [x] Phase 3: PTY service (terminal-utils.ts, pty-service.ts) - iteration 1
- [x] Phase 4: Webview files (template.html, styles.css, main.ts) - iteration 1
- [x] Phase 5: Webview provider (webview-provider.ts) - iteration 1
- [x] Phase 6: Terminal manager (terminal-manager.ts) - iteration 1
- [x] Phase 7: Extension entry (extension.ts) - iteration 1
- [x] npm install succeeds - iteration 1
- [x] npm run build succeeds - iteration 1
- [x] TypeScript type check passes (npx tsc --noEmit) - iteration 1
- [x] Fix shell detection for macOS (fallback to /bin/zsh) - iteration 2
- [x] Add TERM_PROGRAM=ghostty environment variable - iteration 2
- [x] Manual VS Code Extension Development Host testing - iteration 2
  - [x] Extension activates without errors
  - [x] "Ghostty: New Terminal" opens webview terminal
  - [x] Shell prompt appears (PTY connected)
  - [x] Input echoes correctly
  - [x] $TERM_PROGRAM shows "ghostty"
  - [x] $COLORTERM shows "truecolor"
- [x] #2 Keybinding Passthrough - Platform-specific: Mac (Cmd→VS Code, Ctrl→terminal), Win/Linux (Ctrl+Shift→VS Code, Ctrl+letter→terminal)
- [x] #3 Custom Fonts - Settings (minimum: 6), hot reload with PTY resize notification
- [x] #4 Custom Themes - CSS variables with MutationObserver, colorCustomizations merge
- [x] #8 Open File in Editor - FilePathLinkProvider with registerLinkProvider, checkFileExists validation, OSC 7 CWD tracking, Windows path support

## In Progress
(none)

## Bugs (from QA)
- [x] **Font defaults wrong**: Fixed - now defaults to `editor.fontFamily`/`editor.fontSize`, overridable by `ghostty.*`
- [x] **Custom color schemes broken**: Fixed - MutationObserver now watches documentElement style changes
- [x] **Keybindings captured by terminal**: Fixed in commit 28feb7d
- [x] **Scrollback lost on window move**: Partial fix - CWD persists via getState/setState. Scrollback cannot persist (WASM memory limitation - would require ghostty-web serialization APIs)

## Pending
- [ ] Test resize functionality
- [ ] Test exit closes terminal cleanly
- [ ] Explore e2e testing setup (Playwright + VS Code or @vscode/test-electron)

## Blocked
(none)

## Notes
- Build output: `out/extension.js`, `out/webview/main.js`, `out/webview/template.html`, `out/webview/styles.css`
- All 13 files created per plan at `.claude/plans/validated-crunching-pelican.md`
- Shell detection improved to check VS Code settings, then $SHELL, then fallback to /bin/zsh
- Terminal identifies as TERM_PROGRAM=ghostty, COLORTERM=truecolor
- Theme hot reload limitation: existing cell content keeps original colors (cells store RGB at write time)
- Font/theme settings priority: ghostty.* > editor.* > defaults (fixed from terminal.integrated.*)
- OSC 7 tracked per terminal instance for CWD-relative path resolution
- Unit tests added for settings resolution logic (`npm test`)
