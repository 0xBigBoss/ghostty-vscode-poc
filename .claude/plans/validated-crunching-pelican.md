# Ghostty Terminal Extension Plan

## Goal

Build a VS Code terminal extension using ghostty-web connected to a real PTY. This is the production terminal implementation following the successful Phase 1 probe (40+ MiB/s, all workstreams GO).

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     VS Code Extension Host                       │
│  ┌─────────────────┐    ┌──────────────────┐                    │
│  │ terminal-manager │◄──►│   pty-service    │                    │
│  │  (orchestrates)  │    │  (node-pty)      │                    │
│  └────────┬─────────┘    └────────┬─────────┘                    │
│           │                       │                              │
│           ▼                       ▼                              │
│  ┌─────────────────────────────────────────┐                    │
│  │         webview-provider                 │                    │
│  │   (creates WebviewPanel, bridges msgs)   │                    │
│  └─────────────────┬───────────────────────┘                    │
└────────────────────│────────────────────────────────────────────┘
                     │ postMessage / onDidReceiveMessage
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Webview (DOM)                             │
│  ┌─────────────────────────────────────────┐                    │
│  │   ghostty-web Terminal + FitAddon        │                    │
│  └─────────────────────────────────────────┘                    │
└─────────────────────────────────────────────────────────────────┘
```

## Why Webview (Not Terminal Panel)

VS Code's terminal panel uses built-in xterm.js. To use ghostty-web we need a webview because:
- ghostty-web requires DOM/Canvas access
- Can't inject into VS Code's terminal panel without patching VS Code itself

## Directory Structure

New extension at `ghostty-terminal/` (sibling to `probe/`):

```
ghostty-terminal/
├── package.json
├── tsconfig.json
├── esbuild.config.mjs
├── src/
│   ├── extension.ts           # Entry, commands
│   ├── terminal-manager.ts    # Orchestrates PTY ↔ Webview
│   ├── pty-service.ts         # node-pty wrapper
│   ├── webview-provider.ts    # WebviewPanel creation
│   ├── types/
│   │   ├── messages.ts        # Message protocol
│   │   └── terminal.ts        # Terminal types
│   └── webview/
│       ├── main.ts            # ghostty-web init
│       ├── template.html
│       └── styles.css
```

## Key Types

### `src/types/terminal.ts` (types only - safe for webview import)
```typescript
/** Branded terminal ID for type safety (types-only, no runtime imports) */
export type TerminalId = string & { readonly __brand: 'TerminalId' };

export interface TerminalConfig {
  shell?: string;
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;  // Initial cols from FitAddon measurement
  rows?: number;  // Initial rows from FitAddon measurement
}

/** Terminal instance state tracked by manager (extension-host only) */
export interface TerminalInstance {
  id: TerminalId;
  config: Partial<TerminalConfig>;  // Partial: defaults applied at PTY spawn
  panel: import('vscode').WebviewPanel;
  ready: boolean;           // Set true after terminal-ready received
  readyTimeout?: NodeJS.Timeout;  // Timeout for ready signal
  dataQueue: string[];      // Buffer PTY data until ready (capped)
}
```

### `src/terminal-utils.ts` (extension-host only - has Node imports)
```typescript
import { randomUUID } from 'crypto';
import type { TerminalId, TerminalConfig } from './types/terminal';

/** Generate a new unique terminal ID (Node-only, never import in webview) */
export function createTerminalId(): TerminalId {
  return randomUUID() as TerminalId;
}

/** Default terminal configuration */
export const DEFAULT_CONFIG: TerminalConfig = {
  shell: undefined,  // Use platform default (detected at spawn)
  cwd: undefined,    // Use workspace root or home
  env: undefined,    // Inherit process.env at spawn time
  cols: 80,
  rows: 24,
};

/** Merge user config with defaults, inheriting process.env */
export function resolveConfig(partial?: Partial<TerminalConfig>): TerminalConfig {
  return {
    ...DEFAULT_CONFIG,
    ...partial,
    // Merge env: start with process.env, overlay user overrides
    env: { ...process.env, ...(partial?.env ?? {}) } as Record<string, string>,
  };
}

/** Buffer size limits */
export const MAX_DATA_QUEUE_SIZE = 1000;  // Max buffered chunks
export const READY_TIMEOUT_MS = 10000;    // 10s timeout for terminal-ready
export const EXIT_CLOSE_DELAY_MS = 1500;  // Delay before closing panel after PTY exit
```

Note: Split into types-only (`terminal.ts`) and Node-runtime (`terminal-utils.ts`) to prevent Node imports from polluting webview bundle. Webview uses `import type { TerminalId }` only.

### `src/types/messages.ts`
```typescript
/** Extension → Webview */
export type ExtensionMessage =
  | { type: 'pty-data'; terminalId: TerminalId; data: string }
  | { type: 'pty-exit'; terminalId: TerminalId; exitCode: number }
  | { type: 'resize'; terminalId: TerminalId; cols: number; rows: number };

/** Webview → Extension */
export type WebviewMessage =
  | { type: 'terminal-input'; terminalId: TerminalId; data: string }
  | { type: 'terminal-resize'; terminalId: TerminalId; cols: number; rows: number }
  | { type: 'terminal-ready'; terminalId: TerminalId; cols: number; rows: number };
```

Note: `terminalId` is injected into the template HTML via `data-terminal-id` attribute, not via message protocol. This avoids race conditions where webview loads before message arrives.

## Terminal Manager Design

### ID Generation and Mapping
- Each terminal gets a unique `TerminalId` via `createTerminalId()` (UUID)
- Manager maintains `Map<TerminalId, TerminalInstance>` for routing
- Single webview panel per terminal (1:1 mapping)
- Panel title includes terminal ID suffix for disambiguation

### Message Buffering Strategy
1. PTY spawned immediately with default 80x24 (shell startup begins)
2. PTY data buffered in `TerminalInstance.dataQueue` until `ready === true`
3. Buffer is capped at `MAX_DATA_QUEUE_SIZE` (1000 chunks) to prevent memory bloat
4. Timeout (`READY_TIMEOUT_MS` = 10s) kills PTY and closes panel if terminal-ready never arrives
5. On `terminal-ready` message: clear timeout, resize PTY to actual dimensions, flush queue, set `ready = true`
6. Prevents dropped output during webview initialization

### Initial Size Handshake
1. PTY spawns immediately with default 80x24 (acceptable initial mismatch)
2. Webview loads, runs FitAddon.fit() to measure container
3. Webview sends `terminal-ready` with measured `cols` and `rows`
4. Extension resizes PTY to match measured dimensions
5. Shell adapts to new size (most shells handle SIGWINCH gracefully)

Note: We accept brief initial size mismatch to avoid delaying shell startup. The resize happens within ~100ms of panel open.

### Lifecycle and Cleanup
- `TerminalManager.dispose()`: kill all PTYs, dispose all panels
- Panel `onDidDispose`: kill associated PTY, remove from map, dispose listeners
- Extension `deactivate`: call `TerminalManager.dispose()`
- `PtyService.kill(id)`: send SIGTERM, cleanup listeners, remove from internal map

## Implementation Phases

### Phase 1: Project Setup
- Create `ghostty-terminal/` with package.json, tsconfig, esbuild config
- Install deps: `ghostty-web`, `node-pty`
- Copy build patterns from probe extension
- Configure esbuild to externalize `node-pty` (native module)
- Add `postinstall` script for node-pty prebuilds
- Configure `extensionDependencies` or bundle node-pty with prebuilds

**esbuild.config.mjs native module handling:**
```javascript
esbuild.build({
  // ... other config
  external: ['node-pty'],  // Don't bundle native module
  platform: 'node',
});
```

**package.json scripts:**
```json
{
  "scripts": {
    "postinstall": "node-pty-prebuilt-multiarch || true",
    "vscode:prepublish": "npm run build"
  }
}
```

**package.json contributes and activation:**
```json
{
  "activationEvents": [],
  "contributes": {
    "commands": [
      {
        "command": "ghostty.newTerminal",
        "title": "Ghostty: New Terminal"
      },
      {
        "command": "ghostty.newTerminalHere",
        "title": "Ghostty: New Terminal Here"
      }
    ],
    "menus": {
      "explorer/context": [
        {
          "command": "ghostty.newTerminalHere",
          "group": "navigation"
        }
      ]
    }
  }
}
```

Note: `activationEvents` is empty because VS Code 1.74+ auto-generates activation events from `contributes.commands`. The extension activates when either command is invoked.

### Phase 2: Types
- `src/types/terminal.ts` - TerminalId, TerminalConfig
- `src/types/messages.ts` - Discriminated union message protocol

### Phase 3: PTY Service
- Wrap node-pty spawn/write/resize/kill
- Handle platform-specific shell detection
- Emit data, exit, and error events
- Implement `dispose()` to kill all PTYs and cleanup listeners

**PtyService interface:**
```typescript
/** Result of spawn attempt */
export type SpawnResult =
  | { ok: true }
  | { ok: false; error: string };

/** PTY event handlers */
export interface PtyHandlers {
  onData: (data: string) => void;
  onExit: (code: number) => void;
  onError: (error: Error) => void;  // Runtime errors (e.g., process crash)
}

class PtyService implements vscode.Disposable {
  private instances = new Map<TerminalId, PtyInstance>();

  /** Spawn PTY, returns error if shell/cwd invalid or native module fails */
  spawn(id: TerminalId, config: TerminalConfig, handlers: PtyHandlers): SpawnResult {
    try {
      const shell = config.shell || this.getDefaultShell();
      const proc = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: config.cols || 80,
        rows: config.rows || 24,
        cwd: config.cwd || process.env.HOME,
        env: config.env,
      });

      // Setup listeners
      proc.onData(handlers.onData);
      proc.onExit(({ exitCode }) => handlers.onExit(exitCode));

      // Handle runtime errors (node-pty emits 'error' on process failures)
      (proc as any).on?.('error', (err: Error) => {
        handlers.onError(err);
        this.kill(id);  // Cleanup on error
      });

      this.instances.set(id, { id, process: proc });
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  }

  write(id: TerminalId, data: string): void;
  resize(id: TerminalId, cols: number, rows: number): void;
  kill(id: TerminalId): void;  // SIGTERM, remove listeners, delete from map
  dispose(): void;             // Kill all, called on extension deactivate
}
```

### Phase 4: Webview
- `template.html` - HTML shell with CSP, script tags, data attributes
- `styles.css` - Full-viewport terminal container
- `main.ts` - Initialize ghostty-web wasm, Terminal, FitAddon, message bridge

**Template HTML with asset URIs and data injection:**
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src {{cspSource}} 'unsafe-inline' 'wasm-unsafe-eval'; style-src {{cspSource}} 'unsafe-inline'; img-src {{cspSource}} data:; font-src {{cspSource}}; connect-src {{cspSource}};">
  <link rel="stylesheet" href="{{stylesUri}}">
</head>
<body data-terminal-id="{{terminalId}}" data-wasm-url="{{wasmUri}}">
  <div id="terminal-container"></div>
  <script src="{{ghosttyWebJsUri}}"></script>
  <script src="{{mainJsUri}}"></script>
</body>
</html>
```

Note: CSP includes `'wasm-unsafe-eval'` which is required for ghostty wasm instantiation.

**WebviewProvider generates URIs and HTML (matching probe patterns):**
```typescript
// webview-provider.ts
export function createWebviewHtml(
  panel: vscode.WebviewPanel,
  extensionPath: string,
  terminalId: TerminalId
): string {
  const ghosttyWebPath = path.join(extensionPath, 'node_modules', 'ghostty-web', 'dist');

  const ghosttyWebJsUri = panel.webview.asWebviewUri(
    vscode.Uri.file(path.join(ghosttyWebPath, 'ghostty-web.umd.cjs'))
  );
  const wasmUri = panel.webview.asWebviewUri(
    vscode.Uri.file(path.join(ghosttyWebPath, 'ghostty-vt.wasm'))
  );
  const mainJsUri = panel.webview.asWebviewUri(
    vscode.Uri.file(path.join(extensionPath, 'out', 'webview', 'main.js'))
  );
  const stylesUri = panel.webview.asWebviewUri(
    vscode.Uri.file(path.join(extensionPath, 'out', 'webview', 'styles.css'))
  );

  // Read template and replace all placeholders including terminalId
  const templatePath = path.join(extensionPath, 'out', 'webview', 'template.html');
  let html = fs.readFileSync(templatePath, 'utf8');

  html = html
    .replace(/\{\{cspSource\}\}/g, panel.webview.cspSource)
    .replace(/\{\{terminalId\}\}/g, terminalId)  // Critical: inject terminal ID
    .replace(/\{\{wasmUri\}\}/g, wasmUri.toString())
    .replace(/\{\{ghosttyWebJsUri\}\}/g, ghosttyWebJsUri.toString())
    .replace(/\{\{mainJsUri\}\}/g, mainJsUri.toString())
    .replace(/\{\{stylesUri\}\}/g, stylesUri.toString());

  return html;
}
```

**Webview initialization sequence (main.ts):**

Note: Uses IIFE pattern (not ESM) to match probe build. esbuild bundles to IIFE format for webview compatibility.

```typescript
import type { TerminalId } from '../types/terminal';  // Type-only import (stripped at build)
import type { ExtensionMessage } from '../types/messages';

// Declare VS Code API (provided by webview host)
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

// Initialize VS Code API (must be called exactly once)
const vscode = acquireVsCodeApi();

// Wrap in async IIFE for top-level await (IIFE build target)
(async () => {
  // Read injected config from body data attributes
  const TERMINAL_ID = document.body.dataset.terminalId as TerminalId;
  const WASM_URL = document.body.dataset.wasmUrl || '';

  // Initialize ghostty-web wasm (matching probe pattern)
  const GhosttyModule = (window as any).GhosttyWeb || (window as any).ghosttyWeb;

  // Guard for missing global (script load failure)
  if (!GhosttyModule) {
    throw new Error('ghostty-web failed to load: GhosttyWeb global not found. Check script loading and CSP.');
  }

  // Prefer Ghostty.load(wasmUrl) if available, fallback to init()
  const Ghostty = GhosttyModule.Ghostty || GhosttyModule.default?.Ghostty;
  let ghosttyInstance: unknown = null;

  if (Ghostty && typeof Ghostty.load === 'function') {
    ghosttyInstance = await Ghostty.load(WASM_URL);
  } else if (GhosttyModule.init && typeof GhosttyModule.init === 'function') {
    await GhosttyModule.init();
  } else if (GhosttyModule.default?.init) {
    await GhosttyModule.default.init();
  }

  // Create terminal
  const Terminal = GhosttyModule.Terminal || GhosttyModule.default?.Terminal;
  if (!Terminal) {
    throw new Error('ghostty-web Terminal not found');
  }

  const termOptions: { cols: number; rows: number; ghostty?: unknown } = { cols: 80, rows: 24 };
  if (ghosttyInstance) {
    termOptions.ghostty = ghosttyInstance;
  }
  const term = new Terminal(termOptions);

  // Get FitAddon from ghostty-web module
  const FitAddon = GhosttyModule.FitAddon || GhosttyModule.default?.FitAddon;
  if (!FitAddon) {
    throw new Error('ghostty-web FitAddon not found');
  }

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(document.getElementById('terminal-container')!);
  fitAddon.fit();

  // Register message listener BEFORE posting terminal-ready
  // This ensures the ready-triggered flush doesn't arrive before handler exists
  window.addEventListener('message', (e) => {
    const msg = e.data as ExtensionMessage;
    switch (msg.type) {
      case 'pty-data': term.write(msg.data); break;
      case 'pty-exit':
        term.write(`\r\n\x1b[90m[Process exited with code ${msg.exitCode}]\x1b[0m\r\n`);
        break;
      case 'resize':
        term.resize(msg.cols, msg.rows);
        break;
    }
  });

  // Now that listener is registered, send ready with measured dimensions
  vscode.postMessage({
    type: 'terminal-ready',
    terminalId: TERMINAL_ID,
    cols: term.cols,
    rows: term.rows
  });

  // Send input to PTY
  term.onData((data) => {
    vscode.postMessage({ type: 'terminal-input', terminalId: TERMINAL_ID, data });
  });

  // Handle resize: re-fit on container resize, notify extension
  const resizeObserver = new ResizeObserver(() => {
    fitAddon.fit();
    vscode.postMessage({
      type: 'terminal-resize',
      terminalId: TERMINAL_ID,
      cols: term.cols,
      rows: term.rows
    });
  });
  resizeObserver.observe(document.getElementById('terminal-container')!);
})();  // End async IIFE
```

### Phase 5: Webview Provider
- Create WebviewPanel with proper resource roots
- Set `retainContextWhenHidden: true` to preserve terminal state when panel hidden
- Set up bidirectional message bridge (onDidReceiveMessage handler)
- Handle panel lifecycle

**WebviewPanel options:**
```typescript
const panel = vscode.window.createWebviewPanel(
  'ghosttyTerminal',
  `Ghostty Terminal`,
  vscode.ViewColumn.One,
  {
    enableScripts: true,
    retainContextWhenHidden: true,  // Keep terminal alive when hidden
    localResourceRoots: [
      vscode.Uri.joinPath(extensionUri, 'out'),
      vscode.Uri.joinPath(extensionUri, 'node_modules', 'ghostty-web', 'dist'),
    ],
  }
);
```

Note: `retainContextWhenHidden: true` preserves the webview DOM and JavaScript state when the panel is not visible. This prevents:
- Terminal content loss when switching tabs
- Need to reconnect/rehydrate terminal state
- Dropped PTY output while hidden (continues to render in background)

**onDidReceiveMessage bridge (webview → extension):**
```typescript
// In WebviewProvider.createPanel() or TerminalManager.createPanel()
panel.webview.onDidReceiveMessage(
  (message: WebviewMessage) => {
    switch (message.type) {
      case 'terminal-ready':
        this.handleTerminalReady(message.terminalId, message.cols, message.rows);
        break;
      case 'terminal-input':
        this.handleTerminalInput(message.terminalId, message.data);
        break;
      case 'terminal-resize':
        this.handleTerminalResize(message.terminalId, message.cols, message.rows);
        break;
    }
  },
  undefined,
  context.subscriptions  // Auto-dispose with extension
);
```

### Phase 6: Terminal Manager
- Create terminal instances on command
- Route PTY data → webview (with buffering until ready)
- Route webview input → PTY
- Handle resize synchronization
- Implement full lifecycle cleanup

**TerminalManager interface:**
```typescript
import { MAX_DATA_QUEUE_SIZE, READY_TIMEOUT_MS, EXIT_CLOSE_DELAY_MS } from './terminal-utils';

class TerminalManager implements vscode.Disposable {
  private terminals = new Map<TerminalId, TerminalInstance>();
  private ptyService: PtyService;

  createTerminal(config?: Partial<TerminalConfig>): TerminalId | null {
    const id = createTerminalId();
    const panel = this.createPanel(id);
    const instance: TerminalInstance = {
      id, config: config ?? {}, panel,
      ready: false,
      dataQueue: []
    };
    this.terminals.set(id, instance);

    // Spawn PTY with resolved config
    const resolvedConfig = resolveConfig(config);
    const result = this.ptyService.spawn(id, resolvedConfig, {
      onData: (data) => this.handlePtyData(id, data),
      onExit: (code) => this.handlePtyExit(id, code),
      onError: (error) => this.handlePtyError(id, error),
    });

    // Handle spawn failure
    if (!result.ok) {
      vscode.window.showErrorMessage(`Failed to start terminal: ${result.error}`);
      panel.dispose();
      this.terminals.delete(id);
      return null;
    }

    // Set timeout for terminal-ready (webview load failure protection)
    instance.readyTimeout = setTimeout(() => {
      if (!instance.ready) {
        vscode.window.showErrorMessage('Terminal failed to initialize (timeout)');
        this.destroyTerminal(id);
      }
    }, READY_TIMEOUT_MS);

    // Cleanup on panel close
    panel.onDidDispose(() => this.destroyTerminal(id));
    return id;
  }

  private handlePtyData(id: TerminalId, data: string): void {
    const instance = this.terminals.get(id);
    if (!instance) return;
    if (!instance.ready) {
      // Buffer until ready, with cap to prevent memory bloat
      if (instance.dataQueue.length < MAX_DATA_QUEUE_SIZE) {
        instance.dataQueue.push(data);
      }
      // Silently drop if over cap (better than OOM)
    } else {
      instance.panel.webview.postMessage({ type: 'pty-data', terminalId: id, data });
    }
  }

  private handleTerminalReady(id: TerminalId, cols: number, rows: number): void {
    const instance = this.terminals.get(id);
    if (!instance) return;

    // Clear the ready timeout
    if (instance.readyTimeout) {
      clearTimeout(instance.readyTimeout);
      instance.readyTimeout = undefined;
    }

    // Resize PTY to webview-measured dimensions
    this.ptyService.resize(id, cols, rows);

    // Flush buffered data
    for (const data of instance.dataQueue) {
      instance.panel.webview.postMessage({ type: 'pty-data', terminalId: id, data });
    }
    instance.dataQueue = [];
    instance.ready = true;
  }

  private handleTerminalInput(id: TerminalId, data: string): void {
    // Forward webview input to PTY
    this.ptyService.write(id, data);
  }

  private handleTerminalResize(id: TerminalId, cols: number, rows: number): void {
    // Webview detected resize, propagate to PTY
    this.ptyService.resize(id, cols, rows);
  }

  private handlePtyExit(id: TerminalId, exitCode: number): void {
    const instance = this.terminals.get(id);
    if (!instance) return;

    // Notify webview of exit (shows "[Process exited with code N]")
    instance.panel.webview.postMessage({ type: 'pty-exit', terminalId: id, exitCode });

    // Close panel after brief delay to allow user to see exit message
    // (Aligns with success criteria: "Exit command closes terminal cleanly")
    setTimeout(() => {
      this.destroyTerminal(id);
    }, EXIT_CLOSE_DELAY_MS);
  }

  private handlePtyError(id: TerminalId, error: Error): void {
    const instance = this.terminals.get(id);
    if (!instance) return;

    vscode.window.showErrorMessage(`Terminal error: ${error.message}`);
    this.destroyTerminal(id);
  }

  private destroyTerminal(id: TerminalId): void {
    // Idempotency guard: remove from map FIRST to prevent re-entry
    const instance = this.terminals.get(id);
    if (!instance) return;  // Already destroyed
    this.terminals.delete(id);

    // Clear ready timeout if pending
    if (instance.readyTimeout) {
      clearTimeout(instance.readyTimeout);
      instance.readyTimeout = undefined;
    }

    // Kill PTY process (safe to call if already dead)
    this.ptyService.kill(id);

    // Dispose panel (onDidDispose will call destroyTerminal but guard above prevents re-entry)
    instance.panel.dispose();
  }

  dispose(): void {
    for (const [id, instance] of this.terminals) {
      if (instance.readyTimeout) {
        clearTimeout(instance.readyTimeout);
      }
      this.ptyService.kill(id);
      instance.panel.dispose();
    }
    this.terminals.clear();
    this.ptyService.dispose();
  }
}
```

### Phase 7: Extension Entry
- Register commands: `ghostty.newTerminal`, `ghostty.newTerminalHere`
- Activate terminal manager
- Register manager for disposal on deactivate

**extension.ts:**
```typescript
import * as fs from 'fs';
import * as path from 'path';

let manager: TerminalManager | undefined;

/** Resolve cwd: ensure it's a directory, fallback to workspace or home */
function resolveCwd(uri?: vscode.Uri): string | undefined {
  if (!uri?.fsPath) {
    // Use first workspace folder or undefined (PtyService uses home)
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  try {
    const stat = fs.statSync(uri.fsPath);
    if (stat.isDirectory()) {
      return uri.fsPath;
    }
    // If file, use its parent directory
    return path.dirname(uri.fsPath);
  } catch {
    // Path doesn't exist, fallback
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }
}

export function activate(context: vscode.ExtensionContext) {
  manager = new TerminalManager(context);
  context.subscriptions.push(manager);  // Auto-dispose on deactivate

  context.subscriptions.push(
    vscode.commands.registerCommand('ghostty.newTerminal', () => manager!.createTerminal()),
    vscode.commands.registerCommand('ghostty.newTerminalHere', (uri?: vscode.Uri) =>
      manager!.createTerminal({ cwd: resolveCwd(uri) })
    )
  );
}

export function deactivate() {
  // manager.dispose() called automatically via subscriptions
}
```

## Files to Create

| File | Description |
|------|-------------|
| `ghostty-terminal/package.json` | Extension manifest, dependencies |
| `ghostty-terminal/tsconfig.json` | TypeScript config |
| `ghostty-terminal/esbuild.config.mjs` | Build config |
| `ghostty-terminal/src/types/terminal.ts` | Terminal types (TerminalId, TerminalConfig) |
| `ghostty-terminal/src/types/messages.ts` | Message protocol |
| `ghostty-terminal/src/terminal-utils.ts` | Node-only utils (createTerminalId, constants) |
| `ghostty-terminal/src/pty-service.ts` | node-pty wrapper |
| `ghostty-terminal/src/webview/template.html` | Webview HTML |
| `ghostty-terminal/src/webview/styles.css` | Webview styles |
| `ghostty-terminal/src/webview/main.ts` | Webview entry |
| `ghostty-terminal/src/webview-provider.ts` | Panel creation |
| `ghostty-terminal/src/terminal-manager.ts` | Orchestration |
| `ghostty-terminal/src/extension.ts` | Entry point |

## Success Criteria

1. `npm run build` succeeds
2. Extension activates without errors
3. "Ghostty: New Terminal" opens webview with working terminal
4. Shell prompt appears (PTY connected)
5. Input echoes correctly
6. Resize works (FitAddon + PTY sync)
7. Exit command closes terminal cleanly

## Risks

| Risk | Mitigation |
|------|------------|
| node-pty native module issues | Use prebuilds, document requirements |
| Webview security restrictions | Proper CSP, explicit resource roots |
| Message ordering | Buffer data until terminal ready |
