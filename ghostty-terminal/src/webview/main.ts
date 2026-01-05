// Type-only imports (stripped at build time)
import type { TerminalId } from '../types/terminal';
import type { ExtensionMessage, TerminalTheme } from '../types/messages';

// Declare VS Code API (provided by webview host)
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

// Initialize VS Code API (must be called exactly once)
const vscode = acquireVsCodeApi();

// Webview state persistence interface
interface WebviewState {
  currentCwd?: string;
  // Note: Scrollback buffer cannot be persisted - it's in WASM memory
  // When moving to a new window, the webview is destroyed and recreated,
  // losing the WASM instance and its scrollback. This is a fundamental
  // limitation that would require ghostty-web to add serialization APIs.
}

// Wrap in async IIFE for top-level await (IIFE build target)
(async () => {
  // Read injected config from body data attributes
  const TERMINAL_ID = document.body.dataset.terminalId as TerminalId;
  const WASM_URL = document.body.dataset.wasmUrl || '';

  // Restore persisted state (survives tab switches due to retainContextWhenHidden,
  // and partial state survives window moves via VS Code's webview state API)
  const savedState = vscode.getState() as WebviewState | undefined;

  // State for file path detection
  let currentCwd: string | undefined = savedState?.currentCwd;
  const pendingFileChecks = new Map<string, (exists: boolean) => void>();
  let requestIdCounter = 0;

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

  // File path pattern: matches paths like src/foo.ts:42:10 or ./bar.js(10,5)
  // Captures: path, optional line, optional column
  const FILE_PATH_PATTERN = /(?:^|[\s'"(])((\.{0,2}\/)?[\w./-]+\.[a-zA-Z0-9]+)(?:[:(](\d+)(?:[,:](\d+))?[\])]?)?/g;

  // Check if a file exists via extension
  function checkFileExists(path: string): Promise<boolean> {
    return new Promise((resolve) => {
      const requestId = `req-${requestIdCounter++}`;
      pendingFileChecks.set(requestId, resolve);
      vscode.postMessage({
        type: 'check-file-exists',
        terminalId: TERMINAL_ID,
        requestId,
        path,
      });
      // Timeout after 2 seconds
      setTimeout(() => {
        if (pendingFileChecks.has(requestId)) {
          pendingFileChecks.delete(requestId);
          resolve(false);
        }
      }, 2000);
    });
  }

  // Resolve path relative to CWD
  function resolvePath(path: string): string {
    // Already absolute
    if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) {
      return path;
    }
    // Strip git diff prefixes
    if (path.startsWith('a/') || path.startsWith('b/')) {
      path = path.slice(2);
    }
    // Resolve relative to CWD
    if (currentCwd) {
      return currentCwd + '/' + path;
    }
    return path;
  }

  // Handle file link click
  function handleFileLinkClick(path: string, line?: number, column?: number): void {
    const absolutePath = resolvePath(path);
    vscode.postMessage({
      type: 'open-file',
      terminalId: TERMINAL_ID,
      path: absolutePath,
      line,
      column,
    });
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
        // Check if this looks like a file path (Unix or Windows)
        // Unix: /path/to/file.ts, ./rel/path.ts, ../parent/file.ts
        // Windows: C:\path\to\file.ts, C:/path/to/file.ts
        const fileMatch = url.match(/^((?:[a-zA-Z]:)?(?:\.{0,2}[\\/])?[\w.\\/-]+\.[a-zA-Z0-9]+)(?:[:(](\d+)(?:[,:](\d+))?[\])]?)?$/);
        if (fileMatch) {
          const [, filePath, lineStr, colStr] = fileMatch;
          const line = lineStr ? parseInt(lineStr, 10) : undefined;
          const col = colStr ? parseInt(colStr, 10) : undefined;
          handleFileLinkClick(filePath, line, col);
          return true;
        }
        // Otherwise treat as URL
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

  // FilePathLinkProvider: detects file paths in terminal output and opens them on Cmd/Ctrl+Click
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filePathLinkProvider = {
    provideLinks(y: number, callback: (links: unknown[] | undefined) => void): void {
      // Get the line text from terminal buffer
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const buffer = (term as any).buffer;
      if (!buffer?.active) {
        callback(undefined);
        return;
      }
      const line = buffer.active.getLine(y);
      if (!line) {
        callback(undefined);
        return;
      }
      const lineText = line.translateToString(true);
      if (!lineText) {
        callback(undefined);
        return;
      }

      // Find file path matches (Unix and Windows)
      // Unix: /path/to/file.ts, ./rel/path.ts, ../parent/file.ts
      // Windows: C:\path\to\file.ts, C:/path/to/file.ts
      // With optional :line:col or (line,col) suffix
      const pathPattern = /(?:^|[\s'"(])((?:[a-zA-Z]:)?(?:\.{0,2}[\\/])?[\w.\\/-]+\.[a-zA-Z0-9]+)(?:[:(](\d+)(?:[,:](\d+))?[\])]?)?/g;
      const matches: Array<{
        text: string;
        path: string;
        line?: number;
        column?: number;
        startX: number;
        endX: number;
      }> = [];

      let match;
      while ((match = pathPattern.exec(lineText)) !== null) {
        const fullMatch = match[0];
        const path = match[1];
        const lineNum = match[2] ? parseInt(match[2], 10) : undefined;
        const colNum = match[3] ? parseInt(match[3], 10) : undefined;

        // Calculate start position (skip leading whitespace/quote)
        let startX = match.index;
        // Skip prefix character if not start of path
        const firstChar = fullMatch[0];
        if (firstChar !== '.' && firstChar !== '/' && firstChar !== '\\' && !/[a-zA-Z]/.test(firstChar)) {
          startX += 1; // Skip the prefix character
        }

        matches.push({
          text: path + (lineNum ? `:${lineNum}` : '') + (colNum ? `:${colNum}` : ''),
          path,
          line: lineNum,
          column: colNum,
          startX,
          endX: startX + path.length + (lineNum ? String(lineNum).length + 1 : 0) + (colNum ? String(colNum).length + 1 : 0),
        });
      }

      if (matches.length === 0) {
        callback(undefined);
        return;
      }

      // Validate and create links asynchronously
      const validateAndCreateLinks = async () => {
        const links: unknown[] = [];
        for (const m of matches) {
          const absolutePath = resolvePath(m.path);
          const exists = await checkFileExists(absolutePath);
          if (exists) {
            links.push({
              text: m.text,
              range: {
                start: { x: m.startX, y },
                end: { x: m.endX, y },
              },
              activate: (event: MouseEvent) => {
                // Only open on Ctrl/Cmd+Click (standard terminal behavior)
                if (event.ctrlKey || event.metaKey) {
                  handleFileLinkClick(m.path, m.line, m.column);
                }
              },
            });
          }
        }
        callback(links.length > 0 ? links : undefined);
      };

      validateAndCreateLinks();
    },
  };

  // Register the file path link provider
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof (term as any).registerLinkProvider === 'function') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (term as any).registerLinkProvider(filePathLinkProvider);
  }

  // Read theme colors from VS Code CSS variables (reliable access to theme colors)
  function getVSCodeThemeColors(): TerminalTheme {
    const style = getComputedStyle(document.documentElement);
    const get = (name: string): string | undefined => {
      const value = style.getPropertyValue(name).trim();
      return value || undefined;
    };
    return {
      foreground: get('--vscode-terminal-foreground'),
      background: get('--vscode-terminal-background'),
      cursor: get('--vscode-terminalCursor-foreground'),
      cursorAccent: get('--vscode-terminalCursor-background'),
      selectionBackground: get('--vscode-terminal-selectionBackground'),
      selectionForeground: get('--vscode-terminal-selectionForeground'),
      black: get('--vscode-terminal-ansiBlack'),
      red: get('--vscode-terminal-ansiRed'),
      green: get('--vscode-terminal-ansiGreen'),
      yellow: get('--vscode-terminal-ansiYellow'),
      blue: get('--vscode-terminal-ansiBlue'),
      magenta: get('--vscode-terminal-ansiMagenta'),
      cyan: get('--vscode-terminal-ansiCyan'),
      white: get('--vscode-terminal-ansiWhite'),
      brightBlack: get('--vscode-terminal-ansiBrightBlack'),
      brightRed: get('--vscode-terminal-ansiBrightRed'),
      brightGreen: get('--vscode-terminal-ansiBrightGreen'),
      brightYellow: get('--vscode-terminal-ansiBrightYellow'),
      brightBlue: get('--vscode-terminal-ansiBrightBlue'),
      brightMagenta: get('--vscode-terminal-ansiBrightMagenta'),
      brightCyan: get('--vscode-terminal-ansiBrightCyan'),
      brightWhite: get('--vscode-terminal-ansiBrightWhite'),
    };
  }

  // Apply initial theme from CSS variables
  term.options.theme = getVSCodeThemeColors();

  // Watch for theme changes via MutationObserver
  // - body class changes: when VS Code switches dark/light theme
  // - documentElement style changes: when colorCustomizations or theme colors change
  const themeObserver = new MutationObserver(() => {
    term.options.theme = getVSCodeThemeColors();
  });
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });

  // Keybinding passthrough: let VS Code handle Cmd/Ctrl combos
  // Returns: true = handler consumed (preventDefault, no terminal processing)
  //          false = bubble to VS Code (no preventDefault, no terminal processing)
  //          undefined = default terminal processing
  term.attachCustomKeyEventHandler((event: KeyboardEvent): boolean | undefined => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

    // On Mac: Cmd is the VS Code modifier, Ctrl sends terminal control sequences
    // On Windows/Linux: Ctrl+Shift is VS Code, Ctrl alone is terminal control
    if (isMac) {
      // Cmd combos bubble to VS Code (Cmd+P, Cmd+Shift+P, etc.)
      if (event.metaKey) {
        return false;
      }
      // Ctrl+letter on Mac: let terminal process as control sequences (Ctrl+C→^C, etc.)
      // Return undefined to let InputHandler process normally
      if (event.ctrlKey && !event.altKey && event.key.length === 1 && /[a-zA-Z]/.test(event.key)) {
        return undefined;
      }
    } else {
      // Windows/Linux: Ctrl serves dual purpose
      if (event.ctrlKey) {
        // Ctrl+Shift combos: bubble to VS Code (Ctrl+Shift+P, etc.)
        if (event.shiftKey) {
          return false;
        }
        // Ctrl+C with selection: bubble to let browser handle copy
        if (event.key === 'c' && term.hasSelection?.()) {
          return false;
        }
        // Terminal control sequences: Ctrl+C (no selection), Ctrl+D, Ctrl+Z, Ctrl+L, etc.
        // Return undefined to let InputHandler process normally
        if (!event.altKey && event.key.length === 1 && /[a-zA-Z]/.test(event.key)) {
          return undefined;
        }
        // Other Ctrl combos (Ctrl+Tab, Ctrl+numbers, etc.): bubble to VS Code
        return false;
      }
    }

    // Default terminal processing for everything else
    return undefined;
  });

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
      case 'update-settings':
        // Hot reload font settings
        if (msg.settings.fontFamily !== undefined) {
          term.options.fontFamily = msg.settings.fontFamily;
        }
        if (msg.settings.fontSize !== undefined) {
          term.options.fontSize = msg.settings.fontSize;
        }
        // Recalculate dimensions after font change and notify PTY
        fitAddon.fit();
        vscode.postMessage({
          type: 'terminal-resize',
          terminalId: TERMINAL_ID,
          cols: term.cols,
          rows: term.rows
        });
        break;
      case 'update-theme':
        // Hot reload theme colors from extension (colorCustomizations overrides)
        // Merge with CSS variables as base, allowing explicit customizations to override
        // Note: existing cell content keeps original colors (terminal limitation)
        const baseTheme = getVSCodeThemeColors();
        const mergedTheme: TerminalTheme = { ...baseTheme };
        // Only override defined values from colorCustomizations
        for (const [key, value] of Object.entries(msg.theme)) {
          if (value !== undefined) {
            (mergedTheme as Record<string, string | undefined>)[key] = value;
          }
        }
        term.options.theme = mergedTheme;
        break;
      case 'update-cwd':
        // Track current working directory for relative path resolution
        currentCwd = msg.cwd;
        // Persist state for webview restoration (survives window moves)
        vscode.setState({ currentCwd } as WebviewState);
        break;
      case 'file-exists-result':
        // Resolve pending file existence check
        const callback = pendingFileChecks.get(msg.requestId);
        if (callback) {
          pendingFileChecks.delete(msg.requestId);
          callback(msg.exists);
        }
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
