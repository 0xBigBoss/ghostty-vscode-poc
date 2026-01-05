// Type-only imports (stripped at build time)
import type { TerminalId } from '../types/terminal';
import type { ExtensionMessage, TerminalTheme } from '../types/messages';

// Import extracted utilities for testability (bundled by esbuild)
import {
  createFileCache,
  isAbsolutePath,
  stripGitDiffPrefix,
  resolvePath as resolvePathUtil,
  quoteShellPath,
  isWindowsPlatform,
} from '../file-cache';
import {
  isMacPlatform,
  isSearchShortcut,
  getKeyHandlerResult,
} from '../keybinding-utils';

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
  // Scrollback content as lines of text (extracted from buffer on state save)
  scrollbackContent?: string[];
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

  // File existence cache with TTL (uses extracted utility for testability)
  const fileCache = createFileCache(5000, 100); // 5s TTL, max 100 entries

  // Platform detection (cached at startup)
  const IS_MAC = isMacPlatform(navigator);
  const IS_WINDOWS = isWindowsPlatform(navigator);

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

  // Check if a file exists via extension (with caching)
  function checkFileExists(path: string): Promise<boolean> {
    // Check cache first (uses extracted utility)
    const cached = fileCache.get(path);
    if (cached !== undefined) {
      return Promise.resolve(cached);
    }

    return new Promise((resolve) => {
      const requestId = `req-${requestIdCounter++}`;
      pendingFileChecks.set(requestId, (exists: boolean) => {
        // Cache the result
        fileCache.set(path, exists);
        resolve(exists);
      });
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
          // Cache negative result on timeout
          fileCache.set(path, false);
          resolve(false);
        }
      }, 2000);
    });
  }

  // Resolve path relative to CWD (uses extracted utility)
  function resolvePath(path: string): string {
    return resolvePathUtil(path, currentCwd);
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

  // Initial fit - use double-rAF to ensure layout is complete before measuring
  // VS Code webviews may not have final dimensions until after paint
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      fitAddon.fit();
      // Backup fit after 100ms in case webview layout isn't fully settled
      setTimeout(() => fitAddon.fit(), 100);
    });
  });

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

  // Read theme colors from VS Code CSS variables
  // Priority: editor colors (consistent with font settings), then terminal colors as fallback
  // Note: VS Code has a known bug where webview CSS vars persist across theme changes (#96621)
  function getVSCodeThemeColors(): TerminalTheme {
    const style = getComputedStyle(document.documentElement);
    const get = (name: string, ...fallbacks: string[]): string | undefined => {
      let value = style.getPropertyValue(name).trim();
      if (!value) {
        for (const fallback of fallbacks) {
          value = style.getPropertyValue(fallback).trim();
          if (value) break;
        }
      }
      return value || undefined;
    };
    return {
      // Core colors: editor first, terminal as fallback (matches font settings priority)
      foreground: get('--vscode-editor-foreground', '--vscode-foreground', '--vscode-terminal-foreground'),
      background: get('--vscode-editor-background', '--vscode-panel-background', '--vscode-terminal-background'),
      cursor: get('--vscode-editorCursor-foreground', '--vscode-terminalCursor-foreground'),
      cursorAccent: get('--vscode-editorCursor-background', '--vscode-editor-background'),
      selectionBackground: get('--vscode-editor-selectionBackground', '--vscode-terminal-selectionBackground'),
      selectionForeground: get('--vscode-editor-selectionForeground', '--vscode-terminal-selectionForeground'),
      // ANSI colors: terminal-specific (no editor equivalents), fall back to ghostty-web defaults
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

  // ============================================================================
  // Search in Terminal (Cmd+F / Ctrl+F)
  // ============================================================================

  // Create search overlay UI
  const searchOverlay = document.createElement('div');
  searchOverlay.id = 'search-overlay';
  searchOverlay.innerHTML = `
    <div class="search-container">
      <input type="text" id="search-input" placeholder="Search..." />
      <span id="search-results-count"></span>
      <button id="search-prev" title="Previous (Shift+Enter)">▲</button>
      <button id="search-next" title="Next (Enter)">▼</button>
      <button id="search-close" title="Close (Escape)">✕</button>
    </div>
  `;
  searchOverlay.style.display = 'none';
  document.body.appendChild(searchOverlay);

  const searchInput = document.getElementById('search-input') as HTMLInputElement;
  const searchResultsCount = document.getElementById('search-results-count')!;
  const searchPrevBtn = document.getElementById('search-prev')!;
  const searchNextBtn = document.getElementById('search-next')!;
  const searchCloseBtn = document.getElementById('search-close')!;

  // Search state
  let searchMatches: Array<{ row: number; startCol: number; endCol: number }> = [];
  let currentMatchIndex = -1;

  // Extract all terminal lines for searching
  function getTerminalLines(): string[] {
    const lines: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buffer = (term as any).buffer;
    if (!buffer?.active) return lines;

    const scrollbackLength = buffer.active.length || 0;
    for (let y = 0; y < scrollbackLength; y++) {
      const line = buffer.active.getLine(y);
      if (line) {
        lines.push(line.translateToString(true));
      }
    }
    return lines;
  }

  // Perform search and find all matches
  function performSearch(query: string): void {
    searchMatches = [];
    currentMatchIndex = -1;

    if (!query) {
      updateSearchUI();
      term.clearSelection?.();
      return;
    }

    const lines = getTerminalLines();
    const lowerQuery = query.toLowerCase();

    for (let row = 0; row < lines.length; row++) {
      const line = lines[row].toLowerCase();
      let col = 0;
      while ((col = line.indexOf(lowerQuery, col)) !== -1) {
        searchMatches.push({
          row,
          startCol: col,
          endCol: col + query.length - 1,
        });
        col += 1; // Move past this match to find overlapping matches
      }
    }

    updateSearchUI();

    // Auto-select first match
    if (searchMatches.length > 0) {
      currentMatchIndex = 0;
      highlightCurrentMatch();
    } else {
      term.clearSelection?.();
    }
  }

  // Update search UI with results count
  function updateSearchUI(): void {
    if (searchMatches.length === 0) {
      searchResultsCount.textContent = searchInput.value ? 'No results' : '';
    } else {
      searchResultsCount.textContent = `${currentMatchIndex + 1} of ${searchMatches.length}`;
    }
  }

  // Highlight the current match by selecting it
  function highlightCurrentMatch(): void {
    if (currentMatchIndex < 0 || currentMatchIndex >= searchMatches.length) return;

    const match = searchMatches[currentMatchIndex];
    // Use terminal's select API to highlight the match
    // Need to scroll to the match row and select
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buffer = (term as any).buffer;
    const scrollbackLength = buffer?.active?.length || 0;
    const viewportRows = term.rows;

    // Calculate scroll position to center the match in viewport
    // In ghostty-web: viewportY = 0 at bottom, viewportY = scrollbackLength at top
    // Buffer row `r` is visible when: r = scrollbackLength - viewportY + viewportRow
    // So to show buffer row `match.row` at center of viewport:
    // match.row = scrollbackLength - viewportY + (viewportRows / 2)
    // viewportY = scrollbackLength - match.row + (viewportRows / 2)
    const targetViewportY = Math.max(0, Math.min(
      scrollbackLength,
      scrollbackLength - match.row + Math.floor(viewportRows / 2)
    ));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (term as any).scrollToLine?.(targetViewportY);

    // After scrolling, convert absolute buffer row to viewport-relative row
    // viewportRow = match.row - scrollbackLength + viewportY
    // Since we just set viewportY = targetViewportY:
    const viewportRelativeRow = match.row - scrollbackLength + targetViewportY;

    // Only select if the row is within viewport bounds
    if (viewportRelativeRow >= 0 && viewportRelativeRow < viewportRows) {
      term.select?.(match.startCol, viewportRelativeRow, match.endCol - match.startCol + 1);
    }

    updateSearchUI();
  }

  // Navigate to next match
  function goToNextMatch(): void {
    if (searchMatches.length === 0) return;
    currentMatchIndex = (currentMatchIndex + 1) % searchMatches.length;
    highlightCurrentMatch();
  }

  // Navigate to previous match
  function goToPrevMatch(): void {
    if (searchMatches.length === 0) return;
    currentMatchIndex = (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
    highlightCurrentMatch();
  }

  // Show search overlay
  function showSearch(): void {
    searchOverlay.style.display = 'block';
    searchInput.focus();
    searchInput.select();
  }

  // Hide search overlay
  function hideSearch(): void {
    searchOverlay.style.display = 'none';
    searchInput.value = '';
    searchMatches = [];
    currentMatchIndex = -1;
    searchResultsCount.textContent = '';
    term.clearSelection?.();
    term.focus?.();
  }

  // Search input handlers
  searchInput.addEventListener('input', () => {
    performSearch(searchInput.value);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        goToPrevMatch();
      } else {
        goToNextMatch();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      hideSearch();
    }
  });

  searchPrevBtn.addEventListener('click', goToPrevMatch);
  searchNextBtn.addEventListener('click', goToNextMatch);
  searchCloseBtn.addEventListener('click', hideSearch);

  // Keybinding passthrough: let VS Code handle Cmd/Ctrl combos
  // Uses extracted utilities for testability
  term.attachCustomKeyEventHandler((event: KeyboardEvent): boolean | undefined => {
    // Intercept Cmd+F / Ctrl+F for search (uses extracted utility)
    if (isSearchShortcut(event, IS_MAC)) {
      event.preventDefault();
      showSearch();
      return true; // We handled it
    }

    // Delegate to extracted utility for consistent keybinding logic
    return getKeyHandlerResult(event, IS_MAC, term.hasSelection?.() ?? false);
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
        // State is saved periodically and on visibility change, no need to save here
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

  // Handle bell notification (visual flash and notify extension for audio/system notification)
  term.onBell(() => {
    // Visual bell: brief flash of the terminal container
    const container = document.getElementById('terminal-container');
    if (container) {
      container.classList.add('bell-flash');
      setTimeout(() => container.classList.remove('bell-flash'), 150);
    }
    // Notify extension for system-level notification (audio, status bar, etc.)
    vscode.postMessage({ type: 'terminal-bell', terminalId: TERMINAL_ID });
  });

  // Handle resize: re-fit on container resize, notify extension
  // Debounce to prevent overwhelming WASM during rapid resize (window drag)
  // Note: ghostty-web has a known crash during resize while rendering - wrap in try-catch
  let resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  const RESIZE_DEBOUNCE_MS = 150; // Higher debounce to reduce crash likelihood

  const resizeObserver = new ResizeObserver(() => {
    if (resizeDebounceTimer) {
      clearTimeout(resizeDebounceTimer);
    }
    resizeDebounceTimer = setTimeout(() => {
      resizeDebounceTimer = null;
      try {
        fitAddon.fit();
        vscode.postMessage({
          type: 'terminal-resize',
          terminalId: TERMINAL_ID,
          cols: term.cols,
          rows: term.rows
        });
      } catch (err) {
        // ghostty-web WASM can crash during resize while rendering
        console.warn('[ghostty-terminal] Resize error (WASM bug):', err);
      }
    }, RESIZE_DEBOUNCE_MS);
  });
  resizeObserver.observe(document.getElementById('terminal-container')!);

  // Scrollback persistence: extract buffer content for state saving
  function extractScrollbackContent(): string[] {
    const lines: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buffer = (term as any).buffer;
    if (!buffer?.active) return lines;

    const length = buffer.active.length;
    // Limit to prevent excessive state size (max 5000 lines)
    const maxLines = Math.min(length, 5000);
    for (let y = 0; y < maxLines; y++) {
      const line = buffer.active.getLine(y);
      if (line) {
        lines.push(line.translateToString(true));
      }
    }
    return lines;
  }

  // Save state when document becomes hidden (webview about to be destroyed)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      const scrollbackContent = extractScrollbackContent();
      vscode.setState({
        currentCwd,
        scrollbackContent,
      } as WebviewState);
    }
  });

  // Also save state periodically (every 30 seconds) as backup
  setInterval(() => {
    const scrollbackContent = extractScrollbackContent();
    vscode.setState({
      currentCwd,
      scrollbackContent,
    } as WebviewState);
  }, 30000);

  // Restore scrollback content if available from saved state
  if (savedState?.scrollbackContent && savedState.scrollbackContent.length > 0) {
    // Write restored content with dim styling to indicate it's history
    const restoredContent = savedState.scrollbackContent.join('\r\n');
    term.write(`\x1b[90m${restoredContent}\x1b[0m\r\n`);
    term.write('\x1b[90m--- Session restored ---\x1b[0m\r\n');
  }

  // Drag-and-drop files: paste file path into terminal
  const container = document.getElementById('terminal-container')!;

  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    container.classList.add('drag-over');
  });

  container.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    container.classList.remove('drag-over');
  });

  container.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    container.classList.remove('drag-over');

    // Get dropped files
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    // Build paths string (space-separated, quoted for shell)
    // Uses extracted utility with platform-aware quoting
    const paths: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      // In VS Code webviews, file.path contains the full filesystem path
      // Note: This is a VS Code-specific extension to the File API
      const path = (file as File & { path?: string }).path;
      if (path) {
        // Use platform-aware quoting (POSIX vs Windows)
        paths.push(quoteShellPath(path, IS_WINDOWS));
      }
    }

    if (paths.length > 0) {
      // Send paths to terminal as user input
      vscode.postMessage({
        type: 'terminal-input',
        terminalId: TERMINAL_ID,
        data: paths.join(' ')
      });
    }
  });
})();
