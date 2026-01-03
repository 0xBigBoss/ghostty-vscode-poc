# ghostty-vscode-poc

Proof-of-concept for integrating [Ghostty](https://github.com/ghostty-org/ghostty) terminal rendering into VS Code via [ghostty-web](https://github.com/coder/ghostty-web).

## Goal

Validate whether ghostty-web can replace xterm.js in a VS Code webview terminal with acceptable performance and compatibility.

## Status

**Phase 1: Drop-in Integration** - In progress

Using ghostty-web's Canvas2D renderer as a drop-in xterm.js replacement. See [SPEC.md](SPEC.md) for detailed workstreams and success criteria.

## Project Structure

```
ghostty-vscode-poc/
├── probe/          # VS Code extension + webview harness for testing
├── ghostty/        # Ghostty source (submodule, for reference)
├── ghostty-web/    # ghostty-web source (submodule)
├── artifacts/      # JSON outputs, screenshots
├── SPEC.md         # Detailed specification
└── TODO.md         # Current task tracking
```

## Quick Start

```bash
# Clone with submodules
git clone --recursive https://github.com/0xbigboss/ghostty-vscode-poc.git
cd ghostty-vscode-poc

# Install and build the probe extension
cd probe
npm install
npm run build

# Run in VS Code
# 1. Open this folder in VS Code
# 2. Press F5 to launch Extension Development Host
# 3. Run command: "Ghostty: Run All WebGL Probes"
```

## Probe Commands

- `Ghostty: Run All WebGL Probes` - Run all validation probes
- `Ghostty: Show Probe Panel` - Open interactive probe panel
- `Ghostty: Start Matrix Demo` - Launch Matrix rain demo with live metrics

## Success Criteria

| Metric | Target |
|--------|--------|
| Wasm init time | < 500ms |
| Plain text throughput | > 30 MiB/s |
| Shader compile | OK |
| Core xterm.js API coverage | Sufficient for VS Code terminal |

## Related Projects

- [Ghostty](https://github.com/ghostty-org/ghostty) - Fast, native terminal emulator
- [ghostty-web](https://github.com/coder/ghostty-web) - xterm.js-compatible wrapper around libghostty wasm
- [Mitchell's libghostty roadmap](https://mitchellh.com/writing/libghostty-is-coming)

## License

[MIT](LICENSE) - see LICENSE file.

Ghostty and ghostty-web are also MIT licensed.
