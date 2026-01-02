# TODO - Workstream 1: Wasm Loading

## Completed
- [x] Read existing probe/ structure (iteration 1)
- [x] Add ghostty-web@0.4.0 to probe/package.json (iteration 1)
- [x] Run npm install - success (iteration 1)
- [x] Update extension.ts to serve ghostty-web files via webview URIs (iteration 1)
- [x] Update probeHtml.ts with wasm loading test (iteration 1)
- [x] Compile extension - success (iteration 1)
- [x] Add CSP with wasm-unsafe-eval for WASM support (iteration 1)

## In Progress
- [ ] Test wasm loading in VS Code webview (manual test needed)

## Pending
- [ ] Capture results in JSON to artifacts/

## Manual Test Instructions
1. Open VS Code in the `probe/` directory
2. Press F5 to launch Extension Development Host (or use "Run Extension" debug config)
3. In the new VS Code window, open Command Palette (Cmd+Shift+P)
4. Run "Ghostty: Show Probe Panel"
5. Click "Test Wasm Loading" button
6. Observe results in the webview
7. Check VS Code Output panel "Ghostty Probe" for JSON results

### Expected Results
- ghostty-web module: Loaded (pass)
- Wasm initialized: <500ms (pass)
- Terminal created: OK (pass)
- Text written: OK (pass)
- Colors rendered: OK (pass)

### If CSP Errors Occur
Check Developer Tools console (Help > Toggle Developer Tools) for:
- "Refused to load script" errors
- WASM compilation blocked errors
- Missing `wasm-unsafe-eval` CSP directive

## Blocked
(none)

## Notes
- ghostty-web UMD bundle loaded via script tag in webview
- wasm file served via VS Code webview URI system
- Extension compiles successfully
- Need manual VS Code testing to verify wasm actually loads
