/** Branded terminal ID for type safety (types-only, no runtime imports) */
export type TerminalId = string & { readonly __brand: "TerminalId" };

export interface TerminalConfig {
	shell?: string;
	cwd?: string;
	env?: Record<string, string>;
	cols?: number; // Initial cols from FitAddon measurement
	rows?: number; // Initial rows from FitAddon measurement
}

/** Terminal instance state tracked by manager (extension-host only) */
export interface TerminalInstance {
	id: TerminalId;
	config: Partial<TerminalConfig>; // Partial: defaults applied at PTY spawn
	panel: import("vscode").WebviewPanel;
	ready: boolean; // Set true after terminal-ready received
	readyTimeout?: ReturnType<typeof setTimeout>; // Timeout for ready signal
	dataQueue: string[]; // Buffer PTY data until ready (capped)
	currentCwd?: string; // Current working directory (tracked via OSC 7)
}
