/**
 * Terminal adapter interface for probes.
 *
 * This defines a minimal xterm.js-compatible interface that can be implemented by:
 * - ghostty-web (native support)
 * - xterm.js (identical API)
 * - CLI adapter (mock for stdout)
 */

/**
 * Event listener pattern (matches xterm.js/ghostty-web)
 */
export interface IDisposable {
  dispose(): void;
}

export type IEvent<T> = (listener: (arg: T) => void) => IDisposable;

/**
 * Buffer cell for content inspection
 */
export interface IBufferCell {
  getChars(): string;
  getCode(): number;
  getFgColor(): number;
  getFgColorMode(): number;
  getBgColor(): number;
  getBgColorMode(): number;
}

/**
 * Buffer line for content inspection
 */
export interface IBufferLine {
  readonly length: number;
  getCell(x: number): IBufferCell | undefined;
}

/**
 * Buffer for accessing terminal content
 */
export interface IBuffer {
  readonly type: "normal" | "alternate";
  readonly cursorX: number;
  readonly cursorY: number;
  getLine(y: number): IBufferLine | undefined;
}

/**
 * Minimal terminal interface for probes.
 * Subset of xterm.js API that ghostty-web implements.
 */
export interface ITerminalLike {
  // Dimensions
  readonly cols: number;
  readonly rows: number;

  // Lifecycle
  open(parent: HTMLElement): void;
  dispose(): void;

  // Output
  write(data: string | Uint8Array, callback?: () => void): void;
  writeln(data: string | Uint8Array, callback?: () => void): void;

  // Input
  readonly onData: IEvent<string>;
  readonly onBinary?: IEvent<string>;
  input(data: string, wasUserInput?: boolean): void;
  paste(data: string): void;

  // Resize
  resize(cols: number, rows: number): void;
  readonly onResize: IEvent<{ cols: number; rows: number }>;

  // Buffer access (for rendering probe verification)
  readonly buffer: {
    readonly active: IBuffer;
  };

  // Control
  clear(): void;
  reset(): void;
  focus(): void;
  blur(): void;

  // Selection (optional - for API compatibility probe)
  getSelection?(): string;
  hasSelection?(): boolean;
  clearSelection?(): void;
  select?(column: number, row: number, length: number): void;

  // Addons (optional)
  loadAddon?(addon: unknown): void;

  // Additional xterm.js APIs (optional - for API compatibility probe)
  readonly options?: unknown;
  readonly onBell?: IEvent<void>;
  readonly onKey?: IEvent<{ key: string; domEvent: KeyboardEvent }>;
  readonly onTitleChange?: IEvent<string>;
  readonly onScroll?: IEvent<number>;
  scrollLines?(amount: number): void;
  scrollPages?(pageCount: number): void;
  scrollToTop?(): void;
  scrollToBottom?(): void;
}

/**
 * Context passed to probe functions.
 * Provides access to terminal and utilities without coupling to specific platforms.
 */
export interface IProbeContext {
  /** Terminal instance (null if not yet initialized) */
  terminal: ITerminalLike | null;

  /** Log a message (implementation varies by platform) */
  log: (msg: string) => void;

  /** Get current memory usage in MB */
  getMemory: () => number;

  /** Update UI with probe results (implementation varies by platform) */
  addResult?: (
    section: string,
    label: string,
    value: string,
    status: "pass" | "fail" | "warn"
  ) => void;
}

/**
 * FitAddon interface
 */
export interface IFitAddon {
  fit(): void;
  proposeDimensions(): { cols: number; rows: number } | undefined;
}

/**
 * Ghostty-web specific module interface.
 * Used for wasm loading probe.
 */
export interface IGhosttyModule {
  Terminal?: new (options?: Record<string, unknown>) => ITerminalLike;
  FitAddon?: new () => IFitAddon;
  Ghostty?: {
    load(wasmUrl: string): Promise<unknown>;
  };
  init?: () => Promise<void>;
  default?: {
    Terminal?: new (options?: Record<string, unknown>) => ITerminalLike;
    FitAddon?: new () => IFitAddon;
    Ghostty?: {
      load(wasmUrl: string): Promise<unknown>;
    };
    init?: () => Promise<void>;
  };
}
