import type { TerminalId } from './terminal';

/** Extension -> Webview */
export type ExtensionMessage =
  | { type: 'pty-data'; terminalId: TerminalId; data: string }
  | { type: 'pty-exit'; terminalId: TerminalId; exitCode: number }
  | { type: 'resize'; terminalId: TerminalId; cols: number; rows: number };

/** Webview -> Extension */
export type WebviewMessage =
  | { type: 'terminal-input'; terminalId: TerminalId; data: string }
  | { type: 'terminal-resize'; terminalId: TerminalId; cols: number; rows: number }
  | { type: 'terminal-ready'; terminalId: TerminalId; cols: number; rows: number }
  | { type: 'open-url'; terminalId: TerminalId; url: string };
