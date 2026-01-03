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

## In Progress
(none)

## Pending
- [ ] Test resize functionality
- [ ] Test exit closes terminal cleanly

## Blocked
(none)

## Notes
- Build output: `out/extension.js`, `out/webview/main.js`, `out/webview/template.html`, `out/webview/styles.css`
- All 13 files created per plan at `.claude/plans/validated-crunching-pelican.md`
- Shell detection improved to check VS Code settings, then $SHELL, then fallback to /bin/zsh
- Terminal identifies as TERM_PROGRAM=ghostty, COLORTERM=truecolor
