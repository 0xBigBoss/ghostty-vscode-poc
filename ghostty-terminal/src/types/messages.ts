import type { TerminalId } from './terminal';

/** Display settings for terminal */
export interface DisplaySettings {
  fontFamily?: string;
  fontSize?: number;
}

/** Terminal theme colors */
export interface TerminalTheme {
  foreground?: string;
  background?: string;
  cursor?: string;
  cursorAccent?: string;
  selectionBackground?: string;
  selectionForeground?: string;
  black?: string;
  red?: string;
  green?: string;
  yellow?: string;
  blue?: string;
  magenta?: string;
  cyan?: string;
  white?: string;
  brightBlack?: string;
  brightRed?: string;
  brightGreen?: string;
  brightYellow?: string;
  brightBlue?: string;
  brightMagenta?: string;
  brightCyan?: string;
  brightWhite?: string;
}

/** Extension -> Webview */
export type ExtensionMessage =
  | { type: 'pty-data'; terminalId: TerminalId; data: string }
  | { type: 'pty-exit'; terminalId: TerminalId; exitCode: number }
  | { type: 'resize'; terminalId: TerminalId; cols: number; rows: number }
  | { type: 'update-settings'; terminalId: TerminalId; settings: DisplaySettings }
  | { type: 'update-theme'; terminalId: TerminalId; theme: TerminalTheme }
  | { type: 'update-cwd'; terminalId: TerminalId; cwd: string }
  | { type: 'file-exists-result'; requestId: string; exists: boolean };

/** Webview -> Extension */
export type WebviewMessage =
  | { type: 'terminal-input'; terminalId: TerminalId; data: string }
  | { type: 'terminal-resize'; terminalId: TerminalId; cols: number; rows: number }
  | { type: 'terminal-ready'; terminalId: TerminalId; cols: number; rows: number }
  | { type: 'open-url'; terminalId: TerminalId; url: string }
  | { type: 'open-file'; terminalId: TerminalId; path: string; line?: number; column?: number }
  | { type: 'check-file-exists'; terminalId: TerminalId; requestId: string; path: string }
  | { type: 'terminal-bell'; terminalId: TerminalId };
