# Ghostty + VS Code Feasibility PoC Workspace

This directory is a shared workspace for the Ghostty + VS Code WebGL feasibility PoC.

## Layout
- ghostty/      - Ghostty source submodule (inspect renderer/shaders)
- ghostty-web/  - ghostty-web source submodule (xterm.js-compatible wasm wrapper)
- probe/        - VS Code extension + webview harness for probes
- artifacts/    - JSON outputs, notes, screenshots
- vscode/       - Optional VS Code source (only if patching VS Code internals)

## Notes
- The PoC runs as a VS Code extension + webview. Building VS Code is optional.
- Keep outputs in artifacts/ with date-stamped filenames.
