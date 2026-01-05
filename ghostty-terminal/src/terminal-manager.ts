import * as vscode from 'vscode';
import type { TerminalId, TerminalConfig, TerminalInstance } from './types/terminal';
import type { WebviewMessage, TerminalTheme } from './types/messages';
import { PtyService } from './pty-service';
import { createTerminalId, resolveConfig, MAX_DATA_QUEUE_SIZE, READY_TIMEOUT_MS, EXIT_CLOSE_DELAY_MS } from './terminal-utils';
import { createWebviewPanel } from './webview-provider';
import { resolveDisplaySettings, createVSCodeConfigGetter } from './settings-resolver';

/** Get display settings using the shared resolver (tested in settings-resolver.test.ts) */
function getDisplaySettings() {
  const configGetter = createVSCodeConfigGetter(
    (section) => vscode.workspace.getConfiguration(section)
  );
  return resolveDisplaySettings(configGetter);
}

/** Get terminal theme colors from workbench.colorCustomizations */
function resolveTerminalTheme(): TerminalTheme {
  const colorCustomizations = vscode.workspace
    .getConfiguration('workbench')
    .get<Record<string, string>>('colorCustomizations') ?? {};

  return {
    foreground: colorCustomizations['terminal.foreground'],
    background: colorCustomizations['terminal.background'],
    cursor: colorCustomizations['terminal.cursor.foreground'],
    cursorAccent: colorCustomizations['terminal.cursor.background'],
    selectionBackground: colorCustomizations['terminal.selectionBackground'],
    selectionForeground: colorCustomizations['terminal.selectionForeground'],
    black: colorCustomizations['terminal.ansiBlack'],
    red: colorCustomizations['terminal.ansiRed'],
    green: colorCustomizations['terminal.ansiGreen'],
    yellow: colorCustomizations['terminal.ansiYellow'],
    blue: colorCustomizations['terminal.ansiBlue'],
    magenta: colorCustomizations['terminal.ansiMagenta'],
    cyan: colorCustomizations['terminal.ansiCyan'],
    white: colorCustomizations['terminal.ansiWhite'],
    brightBlack: colorCustomizations['terminal.ansiBrightBlack'],
    brightRed: colorCustomizations['terminal.ansiBrightRed'],
    brightGreen: colorCustomizations['terminal.ansiBrightGreen'],
    brightYellow: colorCustomizations['terminal.ansiBrightYellow'],
    brightBlue: colorCustomizations['terminal.ansiBrightBlue'],
    brightMagenta: colorCustomizations['terminal.ansiBrightMagenta'],
    brightCyan: colorCustomizations['terminal.ansiBrightCyan'],
    brightWhite: colorCustomizations['terminal.ansiBrightWhite'],
  };
}

export class TerminalManager implements vscode.Disposable {
  private terminals = new Map<TerminalId, TerminalInstance>();
  private ptyService: PtyService;
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.ptyService = new PtyService();

    // Listen for configuration changes (font settings hot reload)
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('ghostty') ||
            e.affectsConfiguration('editor.fontFamily') ||
            e.affectsConfiguration('editor.fontSize')) {
          this.broadcastSettingsUpdate();
        }
        // Theme colors from workbench.colorCustomizations
        if (e.affectsConfiguration('workbench.colorCustomizations')) {
          this.broadcastThemeUpdate();
        }
      })
    );

    // Listen for color theme changes (user switches dark/light theme)
    context.subscriptions.push(
      vscode.window.onDidChangeActiveColorTheme(() => {
        this.broadcastThemeUpdate();
      })
    );
  }

  /** Broadcast updated settings to all ready terminals */
  private broadcastSettingsUpdate(): void {
    const settings = getDisplaySettings();
    for (const [id, instance] of this.terminals) {
      if (instance.ready) {
        instance.panel.webview.postMessage({
          type: 'update-settings',
          terminalId: id,
          settings,
        });
      }
    }
  }

  /** Broadcast updated theme to all ready terminals */
  private broadcastThemeUpdate(): void {
    const theme = resolveTerminalTheme();
    for (const [id, instance] of this.terminals) {
      if (instance.ready) {
        instance.panel.webview.postMessage({
          type: 'update-theme',
          terminalId: id,
          theme,
        });
      }
    }
  }

  createTerminal(config?: Partial<TerminalConfig>): TerminalId | null {
    const id = createTerminalId();
    const panel = createWebviewPanel(this.context.extensionUri, id);
    const instance: TerminalInstance = {
      id,
      config: config ?? {},
      panel,
      ready: false,
      dataQueue: []
    };
    this.terminals.set(id, instance);

    // Setup message handler for webview -> extension
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
          case 'open-url':
            this.handleOpenUrl(message.url);
            break;
          case 'open-file':
            this.handleOpenFile(message.path, message.line, message.column);
            break;
          case 'check-file-exists':
            this.handleCheckFileExists(message.terminalId, message.requestId, message.path);
            break;
        }
      },
      undefined,
      this.context.subscriptions
    );

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

  /** Parse OSC 7 escape sequence for CWD tracking */
  private parseOSC7(data: string): string | undefined {
    // OSC 7 format: ESC ] 7 ; file://hostname/path ESC \ (or BEL)
    const match = data.match(/\x1b\]7;file:\/\/[^/]*([^\x07\x1b]+)(?:\x07|\x1b\\)/);
    if (match) {
      return decodeURIComponent(match[1]);
    }
    return undefined;
  }

  private handlePtyData(id: TerminalId, data: string): void {
    const instance = this.terminals.get(id);
    if (!instance) return;

    // Check for OSC 7 CWD update
    const cwd = this.parseOSC7(data);
    if (cwd) {
      instance.currentCwd = cwd;
      // Notify webview of CWD change for relative path resolution
      if (instance.ready) {
        instance.panel.webview.postMessage({
          type: 'update-cwd',
          terminalId: id,
          cwd,
        });
      }
    }

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

    // Send initial display settings
    const settings = getDisplaySettings();
    instance.panel.webview.postMessage({
      type: 'update-settings',
      terminalId: id,
      settings,
    });

    // Send initial theme
    const theme = resolveTerminalTheme();
    instance.panel.webview.postMessage({
      type: 'update-theme',
      terminalId: id,
      theme,
    });

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

  // Allowed URL schemes for external opening (security: prevent command injection)
  private static readonly ALLOWED_URL_SCHEMES = new Set([
    'http',
    'https',
    'mailto',
    'ftp',
    'ssh',
    'git',
    'tel',
  ]);

  private handleOpenUrl(url: string): void {
    // Parse and validate URL before opening
    let uri: vscode.Uri;
    try {
      uri = vscode.Uri.parse(url, true); // strict mode
    } catch {
      console.warn(`[ghostty-terminal] Invalid URL: ${url}`);
      return;
    }

    // Security: only allow safe schemes (prevent command:, vscode:, file: etc.)
    if (!TerminalManager.ALLOWED_URL_SCHEMES.has(uri.scheme)) {
      console.warn(`[ghostty-terminal] Blocked URL with disallowed scheme: ${uri.scheme}`);
      return;
    }

    // Open URL externally using VS Code's API (works in webviews)
    vscode.env.openExternal(uri).then(
      (success) => {
        if (!success) {
          console.warn(`[ghostty-terminal] Failed to open URL: ${url}`);
        }
      },
      (error) => {
        console.error(`[ghostty-terminal] Error opening URL: ${error}`);
      }
    );
  }

  private async handleOpenFile(path: string, line?: number, column?: number): Promise<void> {
    try {
      const uri = vscode.Uri.file(path);
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc);

      if (line !== undefined) {
        const position = new vscode.Position(
          Math.max(0, line - 1), // Convert to 0-indexed
          column !== undefined ? Math.max(0, column - 1) : 0
        );
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(
          new vscode.Range(position, position),
          vscode.TextEditorRevealType.InCenter
        );
      }
    } catch (error) {
      console.warn(`[ghostty-terminal] Failed to open file: ${path}`, error);
    }
  }

  private async handleCheckFileExists(
    terminalId: TerminalId,
    requestId: string,
    path: string
  ): Promise<void> {
    const instance = this.terminals.get(terminalId);
    if (!instance) return;

    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(path));
      instance.panel.webview.postMessage({
        type: 'file-exists-result',
        requestId,
        exists: true,
      });
    } catch {
      instance.panel.webview.postMessage({
        type: 'file-exists-result',
        requestId,
        exists: false,
      });
    }
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
