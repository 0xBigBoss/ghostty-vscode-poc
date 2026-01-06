/**
 * Panel webview script for multi-terminal management.
 * Handles tab bar UI and multiple terminal instances within a single webview.
 */

import {
	createFileCache,
	isWindowsPlatform,
	quoteShellPath,
	resolvePath as resolvePathUtil,
} from "../file-cache";
import {
	getKeyHandlerResult,
	isMacPlatform,
	isSearchShortcut,
} from "../keybinding-utils";
import type {
	PanelExtensionMessage,
	PanelWebviewMessage,
	TerminalTheme,
} from "../types/messages";
import type { TerminalId } from "../types/terminal";

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
	tabs?: Array<{ id: TerminalId; title: string; active: boolean }>;
	currentCwd?: Record<TerminalId, string>;
}

// Terminal instance managed within the panel
interface PanelTerminal {
	id: TerminalId;
	title: string;
	term: unknown; // ghostty-web Terminal instance
	fitAddon: unknown; // FitAddon instance
	container: HTMLElement;
	currentCwd?: string;
}

// Wrap in async IIFE for top-level await
(async () => {
	const WASM_URL = document.body.dataset.wasmUrl || "";

	// Restore persisted state
	const savedState = vscode.getState() as WebviewState | undefined;

	// Terminal instances
	const terminals = new Map<TerminalId, PanelTerminal>();
	let activeTerminalId: TerminalId | null = null;

	// File existence cache
	const fileCache = createFileCache(5000, 100);
	const pendingFileChecks = new Map<string, (exists: boolean) => void>();
	let requestIdCounter = 0;

	// Platform detection
	const IS_MAC = isMacPlatform(navigator);
	const IS_WINDOWS = isWindowsPlatform(navigator);

	// Initialize ghostty-web wasm (matching probe pattern)
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const GhosttyModule =
		(window as any).GhosttyWeb || (window as any).ghosttyWeb;

	if (!GhosttyModule) {
		throw new Error("ghostty-web failed to load: GhosttyWeb global not found.");
	}

	const Ghostty = GhosttyModule.Ghostty || GhosttyModule.default?.Ghostty;
	let ghosttyInstance: unknown = null;

	if (Ghostty && typeof Ghostty.load === "function") {
		ghosttyInstance = await Ghostty.load(WASM_URL);
	} else if (GhosttyModule.init && typeof GhosttyModule.init === "function") {
		await GhosttyModule.init();
	} else if (GhosttyModule.default?.init) {
		await GhosttyModule.default.init();
	}

	const Terminal = GhosttyModule.Terminal || GhosttyModule.default?.Terminal;
	const FitAddon = GhosttyModule.FitAddon || GhosttyModule.default?.FitAddon;

	if (!Terminal) throw new Error("ghostty-web Terminal not found");
	if (!FitAddon) throw new Error("ghostty-web FitAddon not found");

	// DOM elements
	const tabList = document.getElementById("tab-list")!;
	const newTabBtn = document.getElementById("new-tab-btn")!;
	const terminalsContainer = document.getElementById("terminals-container")!;

	// Read theme colors from VS Code CSS variables
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
			foreground: get(
				"--vscode-editor-foreground",
				"--vscode-foreground",
				"--vscode-terminal-foreground",
			),
			background: get(
				"--vscode-editor-background",
				"--vscode-panel-background",
				"--vscode-terminal-background",
			),
			cursor: get(
				"--vscode-editorCursor-foreground",
				"--vscode-terminalCursor-foreground",
			),
			cursorAccent: get(
				"--vscode-editorCursor-background",
				"--vscode-editor-background",
			),
			selectionBackground: get(
				"--vscode-editor-selectionBackground",
				"--vscode-terminal-selectionBackground",
			),
			selectionForeground: get(
				"--vscode-editor-selectionForeground",
				"--vscode-terminal-selectionForeground",
			),
			black: get("--vscode-terminal-ansiBlack"),
			red: get("--vscode-terminal-ansiRed"),
			green: get("--vscode-terminal-ansiGreen"),
			yellow: get("--vscode-terminal-ansiYellow"),
			blue: get("--vscode-terminal-ansiBlue"),
			magenta: get("--vscode-terminal-ansiMagenta"),
			cyan: get("--vscode-terminal-ansiCyan"),
			white: get("--vscode-terminal-ansiWhite"),
			brightBlack: get("--vscode-terminal-ansiBrightBlack"),
			brightRed: get("--vscode-terminal-ansiBrightRed"),
			brightGreen: get("--vscode-terminal-ansiBrightGreen"),
			brightYellow: get("--vscode-terminal-ansiBrightYellow"),
			brightBlue: get("--vscode-terminal-ansiBrightBlue"),
			brightMagenta: get("--vscode-terminal-ansiBrightMagenta"),
			brightCyan: get("--vscode-terminal-ansiBrightCyan"),
			brightWhite: get("--vscode-terminal-ansiBrightWhite"),
		};
	}

	// Check if a file exists via extension (for future hyperlink detection)
	function _checkFileExists(
		path: string,
		terminalId: TerminalId,
	): Promise<boolean> {
		const cached = fileCache.get(path);
		if (cached !== undefined) {
			return Promise.resolve(cached);
		}

		return new Promise((resolve) => {
			const requestId = `req-${requestIdCounter++}`;
			pendingFileChecks.set(requestId, (exists: boolean) => {
				fileCache.set(path, exists);
				resolve(exists);
			});
			vscode.postMessage({
				type: "check-file-exists",
				terminalId,
				requestId,
				path,
			});
			setTimeout(() => {
				if (pendingFileChecks.has(requestId)) {
					pendingFileChecks.delete(requestId);
					fileCache.set(path, false);
					resolve(false);
				}
			}, 2000);
		});
	}

	// Create a terminal tab element
	function createTabElement(id: TerminalId, title: string): HTMLElement {
		const tab = document.createElement("div");
		tab.className = "tab";
		tab.dataset.terminalId = id;

		const titleSpan = document.createElement("span");
		titleSpan.className = "tab-title";
		titleSpan.textContent = title;

		const closeBtn = document.createElement("button");
		closeBtn.className = "tab-close";
		closeBtn.textContent = "×";
		closeBtn.title = "Close";

		tab.appendChild(titleSpan);
		tab.appendChild(closeBtn);

		// Click to activate
		tab.addEventListener("click", (e) => {
			if (!(e.target as HTMLElement).classList.contains("tab-close")) {
				activateTerminal(id);
			}
		});

		// Close button
		closeBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			vscode.postMessage({
				type: "tab-close-requested",
				terminalId: id,
			} satisfies PanelWebviewMessage);
		});

		return tab;
	}

	// Create a terminal instance
	function createTerminal(id: TerminalId, title: string): PanelTerminal {
		// Create container
		const wrapper = document.createElement("div");
		wrapper.className = "terminal-wrapper";
		wrapper.dataset.terminalId = id;

		const container = document.createElement("div");
		container.className = "terminal-container";
		wrapper.appendChild(container);
		terminalsContainer.appendChild(wrapper);

		// Create terminal (using any for ghostty-web Terminal options)
		const termOptions: any = {
			cols: 80,
			rows: 24,
			onLinkClick: (url: string, event: MouseEvent) => {
				if (event.ctrlKey || event.metaKey) {
					const fileMatch = url.match(
						/^((?:[a-zA-Z]:)?(?:\.{0,2}[\\/])?[\w.\\/-]+\.[a-zA-Z0-9]+)(?:[:(](\d+)(?:[,:](\d+))?[\])]?)?$/,
					);
					if (fileMatch) {
						const [, filePath, lineStr, colStr] = fileMatch;
						const terminal = terminals.get(id);
						const absolutePath = terminal?.currentCwd
							? resolvePathUtil(filePath, terminal.currentCwd)
							: filePath;
						vscode.postMessage({
							type: "open-file",
							terminalId: id,
							path: absolutePath,
							line: lineStr ? Number.parseInt(lineStr, 10) : undefined,
							column: colStr ? Number.parseInt(colStr, 10) : undefined,
						});
						return true;
					}
					vscode.postMessage({ type: "open-url", terminalId: id, url });
					return true;
				}
				return false;
			},
		};
		if (ghosttyInstance) {
			termOptions.ghostty = ghosttyInstance;
		}
		const term = new Terminal(termOptions);

		const fitAddon = new FitAddon();
		term.loadAddon(fitAddon);
		term.open(container);

		// Apply theme
		term.options.theme = getVSCodeThemeColors();

		// Watch for theme changes
		const themeObserver = new MutationObserver(() => {
			term.options.theme = getVSCodeThemeColors();
		});
		themeObserver.observe(document.body, {
			attributes: true,
			attributeFilter: ["class"],
		});
		themeObserver.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["style"],
		});

		// Keybinding passthrough
		term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
			if (isSearchShortcut(event, IS_MAC)) {
				event.preventDefault();
				// TODO: implement search for panel terminals
				return true;
			}
			return getKeyHandlerResult(event, IS_MAC, term.hasSelection?.() ?? false);
		});

		// Send input to PTY
		term.onData((data: string) => {
			vscode.postMessage({
				type: "terminal-input",
				terminalId: id,
				data,
			});
		});

		// Handle bell
		term.onBell(() => {
			container.classList.add("bell-flash");
			setTimeout(() => container.classList.remove("bell-flash"), 150);
			vscode.postMessage({ type: "terminal-bell", terminalId: id });
		});

		// Resize handling
		let resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
		const resizeObserver = new ResizeObserver(() => {
			if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
			resizeDebounceTimer = setTimeout(() => {
				resizeDebounceTimer = null;
				if (activeTerminalId === id) {
					try {
						fitAddon.fit();
						vscode.postMessage({
							type: "terminal-resize",
							terminalId: id,
							cols: term.cols,
							rows: term.rows,
						});
					} catch (err) {
						console.warn("[ghostty-terminal] Resize error:", err);
					}
				}
			}, 150);
		});
		resizeObserver.observe(container);

		// Drag-and-drop
		container.addEventListener("dragover", (e) => {
			e.preventDefault();
			container.classList.add("drag-over");
		});
		container.addEventListener("dragleave", (e) => {
			e.preventDefault();
			container.classList.remove("drag-over");
		});
		container.addEventListener("drop", (e) => {
			e.preventDefault();
			container.classList.remove("drag-over");
			const files = e.dataTransfer?.files;
			if (!files || files.length === 0) return;
			const paths: string[] = [];
			for (let i = 0; i < files.length; i++) {
				const file = files[i];
				const path = (file as File & { path?: string }).path;
				if (path) {
					paths.push(quoteShellPath(path, IS_WINDOWS));
				}
			}
			if (paths.length > 0) {
				vscode.postMessage({
					type: "terminal-input",
					terminalId: id,
					data: paths.join(" "),
				});
			}
		});

		// Create tab
		const tabElement = createTabElement(id, title);
		tabList.appendChild(tabElement);

		const panelTerminal: PanelTerminal = {
			id,
			title,
			term,
			fitAddon,
			container: wrapper,
		};
		terminals.set(id, panelTerminal);

		return panelTerminal;
	}

	// Activate a terminal (show it, hide others)
	function activateTerminal(id: TerminalId): void {
		const terminal = terminals.get(id);
		if (!terminal) return;

		activeTerminalId = id;

		// Update tab styling
		const tabs = tabList.querySelectorAll(".tab");
		for (let i = 0; i < tabs.length; i++) {
			const tab = tabs[i] as HTMLElement;
			const tabId = tab.dataset.terminalId;
			tab.classList.toggle("active", tabId === id);
		}

		// Update terminal visibility
		for (const [tid, t] of terminals) {
			t.container.classList.toggle("active", tid === id);
		}

		// Fit the active terminal and notify extension
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				try {
					// biome-ignore lint/suspicious/noFocusedTests: This is xterm FitAddon.fit(), not a test
					(terminal.fitAddon as unknown as { fit: () => void }).fit();
					const term = terminal.term as unknown as {
						cols: number;
						rows: number;
						focus?: () => void;
					};
					vscode.postMessage({
						type: "tab-activated",
						terminalId: id,
						cols: term.cols,
						rows: term.rows,
					} satisfies PanelWebviewMessage);
					term.focus?.();
				} catch (err) {
					console.warn("[ghostty-terminal] Fit error:", err);
				}
			});
		});

		saveState();
	}

	// Remove a terminal
	function removeTerminal(id: TerminalId): void {
		const terminal = terminals.get(id);
		if (!terminal) return;

		// Remove DOM elements
		terminal.container.remove();
		const tab = tabList.querySelector(`[data-terminal-id="${id}"]`);
		tab?.remove();

		terminals.delete(id);

		// Activate another terminal if this was active
		if (activeTerminalId === id) {
			const remaining = Array.from(terminals.keys());
			if (remaining.length > 0) {
				activateTerminal(remaining[remaining.length - 1]);
			} else {
				activeTerminalId = null;
			}
		}

		saveState();
	}

	// Rename a terminal
	function renameTerminal(id: TerminalId, title: string): void {
		const terminal = terminals.get(id);
		if (!terminal) return;

		terminal.title = title;
		const tab = tabList.querySelector(`[data-terminal-id="${id}"]`);
		if (tab) {
			const titleSpan = tab.querySelector(".tab-title");
			if (titleSpan) titleSpan.textContent = title;
		}

		saveState();
	}

	// Save webview state
	function saveState(): void {
		const tabs: WebviewState["tabs"] = [];
		const currentCwd: Record<TerminalId, string> = {};

		for (const [id, t] of terminals) {
			tabs.push({
				id,
				title: t.title,
				active: id === activeTerminalId,
			});
			if (t.currentCwd) {
				currentCwd[id] = t.currentCwd;
			}
		}

		vscode.setState({ tabs, currentCwd } as WebviewState);
	}

	// Handle messages from extension
	window.addEventListener("message", (e) => {
		const msg = e.data as PanelExtensionMessage;

		switch (msg.type) {
			case "add-tab": {
				const terminal = createTerminal(msg.terminalId, msg.title);
				if (msg.makeActive) {
					activateTerminal(msg.terminalId);
				}
				// Send terminal-ready
				requestAnimationFrame(() => {
					requestAnimationFrame(() => {
						try {
							// biome-ignore lint/suspicious/noFocusedTests: This is xterm FitAddon.fit(), not a test
							(terminal.fitAddon as unknown as { fit: () => void }).fit();
							const term = terminal.term as unknown as {
								cols: number;
								rows: number;
							};
							vscode.postMessage({
								type: "terminal-ready",
								terminalId: msg.terminalId,
								cols: term.cols,
								rows: term.rows,
							});
						} catch (err) {
							console.warn("[ghostty-terminal] Fit error:", err);
						}
					});
				});
				break;
			}

			case "remove-tab":
				removeTerminal(msg.terminalId);
				break;

			case "rename-tab":
				renameTerminal(msg.terminalId, msg.title);
				break;

			case "activate-tab":
				activateTerminal(msg.terminalId);
				break;

			case "pty-data": {
				const terminal = terminals.get(msg.terminalId);
				if (terminal) {
					(terminal.term as unknown as { write: (data: string) => void }).write(
						msg.data,
					);
				}
				break;
			}

			case "pty-exit": {
				const terminal = terminals.get(msg.terminalId);
				if (terminal) {
					(terminal.term as unknown as { write: (data: string) => void }).write(
						`\r\n\x1b[90m[Process exited with code ${msg.exitCode}]\x1b[0m\r\n`,
					);
				}
				break;
			}

			case "resize": {
				const terminal = terminals.get(msg.terminalId);
				if (terminal) {
					(
						terminal.term as unknown as {
							resize: (cols: number, rows: number) => void;
						}
					).resize(msg.cols, msg.rows);
				}
				break;
			}

			case "update-settings": {
				const terminal = terminals.get(msg.terminalId);
				if (terminal) {
					const term = terminal.term as unknown as {
						options: { fontFamily?: string; fontSize?: number };
						cols: number;
						rows: number;
					};
					if (msg.settings.fontFamily !== undefined) {
						term.options.fontFamily = msg.settings.fontFamily;
					}
					if (msg.settings.fontSize !== undefined) {
						term.options.fontSize = msg.settings.fontSize;
					}
					// biome-ignore lint/suspicious/noFocusedTests: This is xterm FitAddon.fit(), not a test
					(terminal.fitAddon as unknown as { fit: () => void }).fit();
					vscode.postMessage({
						type: "terminal-resize",
						terminalId: msg.terminalId,
						cols: term.cols,
						rows: term.rows,
					});
				}
				break;
			}

			case "update-theme": {
				const terminal = terminals.get(msg.terminalId);
				if (terminal) {
					const baseTheme = getVSCodeThemeColors();
					const mergedTheme: TerminalTheme = { ...baseTheme };
					for (const [key, value] of Object.entries(msg.theme)) {
						if (value !== undefined) {
							(mergedTheme as Record<string, string | undefined>)[key] = value;
						}
					}
					(
						terminal.term as unknown as {
							options: { theme: TerminalTheme };
						}
					).options.theme = mergedTheme;
				}
				break;
			}

			case "update-cwd": {
				const terminal = terminals.get(msg.terminalId);
				if (terminal) {
					terminal.currentCwd = msg.cwd;
				}
				break;
			}

			case "file-exists-result": {
				const callback = pendingFileChecks.get(msg.requestId);
				if (callback) {
					pendingFileChecks.delete(msg.requestId);
					callback(msg.exists);
				}
				break;
			}
		}
	});

	// New tab button
	newTabBtn.addEventListener("click", () => {
		vscode.postMessage({
			type: "new-tab-requested",
		} satisfies PanelWebviewMessage);
	});

	// Send panel-ready to extension
	vscode.postMessage({ type: "panel-ready" } satisfies PanelWebviewMessage);

	// Restore tabs from saved state if available
	if (savedState?.tabs && savedState.tabs.length > 0) {
		// The extension will recreate terminals via add-tab messages
		// State restoration is handled by panel-view-provider
	}

	// Periodic state save
	setInterval(saveState, 30000);
})();
