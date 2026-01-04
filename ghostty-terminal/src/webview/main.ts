// Type-only imports (stripped at build time)
import type { TerminalId } from '../types/terminal';
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  const termOptions: {
    cols: number;
    rows: number;
    ghostty?: unknown;
    onLinkClick?: (url: string, event: MouseEvent) => boolean;
  } = {
    cols: 80,
    rows: 24,
    // Handle link clicks by posting message to extension (window.open doesn't work in webviews)
    onLinkClick: (url: string, event: MouseEvent) => {
      // Only open links when Ctrl/Cmd is held (standard terminal behavior)
      if (event.ctrlKey || event.metaKey) {
        vscode.postMessage({ type: 'open-url', terminalId: TERMINAL_ID, url });
        return true; // Handled
      }
      return false; // Not handled
    },
  };
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
  term.onData((data: string) => {
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
})();
