/**
 * Matrix Rain Demo
 *
 * A visually impressive falling-characters animation inspired by The Matrix,
 * designed to showcase terminal throughput performance.
 */

import type { ITerminalLike } from "../terminal-adapter";

/** Configuration for the Matrix rain animation */
export interface MatrixConfig {
  /** Speed scale 1-10 (affects fall rate) */
  speed: number;
  /** Column density (0.0-1.0, fraction of columns active) */
  density: number;
}

/** Metrics returned by the animation */
export interface MatrixMetrics {
  /** Throughput in MiB/s */
  mibPerSec: number;
  /** Current frames per second */
  fps: number;
  /** Characters written per second */
  charsPerSec: number;
  /** Total frames rendered */
  framesRendered: number;
}

/** A single falling column of characters */
interface MatrixColumn {
  /** Column position (0-indexed) */
  x: number;
  /** Current head position (fractional for smooth animation) */
  y: number;
  /** Fall speed in rows per second */
  speed: number;
  /** Trail length in rows */
  length: number;
  /** Characters in the trail (head first) */
  chars: string[];
  /** Is this column currently active? */
  active: boolean;
}

// Katakana and half-width katakana for authentic Matrix look
const MATRIX_CHARS =
  "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789$#@&%";

// Green color palette (256-color mode: 22-46 are various greens)
// Brighter colors for head, dimmer for trail
const GREEN_BRIGHT = 46; // Bright green (head)
const GREEN_SHADES = [40, 34, 28, 22]; // Progressively dimmer greens

/**
 * Matrix Rain animation engine.
 * Renders falling green characters with brightness gradients.
 */
export class MatrixRain {
  private terminal: ITerminalLike;
  private columns: MatrixColumn[] = [];
  private _running = false;
  private frameId = 0;
  private lastFrameTime = 0;
  private config: MatrixConfig;

  // Metrics tracking
  private bytesWritten = 0;
  private framesRendered = 0;
  private startTime = 0;
  private lastMetricsTime = 0;
  private lastMetricsBytes = 0;
  private lastMetricsFrames = 0;
  private currentMibPerSec = 0;
  private currentFps = 0;
  private currentCharsPerSec = 0;

  constructor(terminal: ITerminalLike, config: Partial<MatrixConfig> = {}) {
    this.terminal = terminal;
    this.config = {
      speed: config.speed ?? 5,
      density: config.density ?? 0.4,
    };
    this.initColumns();
  }

  /** Whether the animation is currently running */
  get running(): boolean {
    return this._running;
  }

  /** Initialize columns based on terminal width */
  private initColumns(): void {
    this.columns = [];
    const numColumns = this.terminal.cols;
    for (let x = 0; x < numColumns; x++) {
      this.columns.push(this.createColumn(x));
    }
  }

  /** Create a new column at position x */
  private createColumn(x: number): MatrixColumn {
    const active = Math.random() < this.config.density;
    const speed = this.getBaseSpeed() * (0.5 + Math.random());
    const length = Math.floor(5 + Math.random() * 15);

    return {
      x,
      y: active ? -Math.random() * this.terminal.rows : -999,
      speed,
      length,
      chars: this.generateChars(length),
      active,
    };
  }

  /** Get base speed from config (rows per second) */
  private getBaseSpeed(): number {
    // Speed 1 = 5 rows/sec, Speed 10 = 100 rows/sec
    return 5 + (this.config.speed - 1) * 10.5;
  }

  /** Generate random characters for a trail */
  private generateChars(length: number): string[] {
    const chars: string[] = [];
    for (let i = 0; i < length; i++) {
      chars.push(MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)]);
    }
    return chars;
  }

  /** Get a random character */
  private randomChar(): string {
    return MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)];
  }

  /** Start the animation */
  start(): void {
    if (this._running) return;

    this._running = true;
    this.startTime = performance.now();
    this.lastFrameTime = this.startTime;
    this.lastMetricsTime = this.startTime;
    this.bytesWritten = 0;
    this.framesRendered = 0;
    this.lastMetricsBytes = 0;
    this.lastMetricsFrames = 0;

    // Clear screen and hide cursor
    this.terminal.write("\x1b[2J\x1b[H\x1b[?25l");

    this.initColumns();
    this.frame();
  }

  /** Stop the animation */
  stop(): void {
    if (!this._running) return;

    this._running = false;
    if (this.frameId) {
      cancelAnimationFrame(this.frameId);
      this.frameId = 0;
    }

    // Show cursor and reset colors
    this.terminal.write("\x1b[?25h\x1b[0m");
  }

  /** Update speed setting */
  setSpeed(speed: number): void {
    this.config.speed = Math.max(1, Math.min(10, speed));
    // Update existing column speeds
    const baseSpeed = this.getBaseSpeed();
    for (const col of this.columns) {
      col.speed = baseSpeed * (0.5 + Math.random());
    }
  }

  /** Get current metrics */
  getMetrics(): MatrixMetrics {
    return {
      mibPerSec: this.currentMibPerSec,
      fps: this.currentFps,
      charsPerSec: this.currentCharsPerSec,
      framesRendered: this.framesRendered,
    };
  }

  /** Animation frame */
  private frame = (): void => {
    if (!this._running) return;

    const now = performance.now();
    const delta = (now - this.lastFrameTime) / 1000; // seconds
    this.lastFrameTime = now;

    // Update metrics every second
    if (now - this.lastMetricsTime >= 1000) {
      const timeDelta = (now - this.lastMetricsTime) / 1000;
      const bytesDelta = this.bytesWritten - this.lastMetricsBytes;
      const framesDelta = this.framesRendered - this.lastMetricsFrames;

      this.currentMibPerSec =
        Math.round((bytesDelta / (1024 * 1024) / timeDelta) * 10) / 10;
      this.currentFps = Math.round(framesDelta / timeDelta);
      this.currentCharsPerSec = Math.round(bytesDelta / timeDelta);

      this.lastMetricsTime = now;
      this.lastMetricsBytes = this.bytesWritten;
      this.lastMetricsFrames = this.framesRendered;
    }

    // Build frame output
    let output = "";

    for (const col of this.columns) {
      if (!col.active) {
        // Random chance to activate
        if (Math.random() < 0.02) {
          col.active = true;
          col.y = 0;
          col.chars = this.generateChars(col.length);
          col.speed = this.getBaseSpeed() * (0.5 + Math.random());
        }
        continue;
      }

      // Move column down
      col.y += col.speed * delta;

      // Randomly mutate head character
      if (Math.random() < 0.3) {
        col.chars[0] = this.randomChar();
      }

      // Render the column
      const headRow = Math.floor(col.y);

      for (let i = 0; i < col.chars.length; i++) {
        const row = headRow - i;
        if (row < 0 || row >= this.terminal.rows) continue;

        // Position cursor (1-indexed for ANSI)
        output += `\x1b[${row + 1};${col.x + 1}H`;

        // Set color based on position in trail
        if (i === 0) {
          // Head: bright white-green
          output += `\x1b[38;5;${GREEN_BRIGHT}m`;
        } else {
          // Trail: progressively dimmer
          const shadeIndex = Math.min(i - 1, GREEN_SHADES.length - 1);
          output += `\x1b[38;5;${GREEN_SHADES[shadeIndex]}m`;
        }

        output += col.chars[i];
      }

      // Erase trailing character (one row above the tail)
      const tailRow = headRow - col.chars.length;
      if (tailRow >= 0 && tailRow < this.terminal.rows) {
        output += `\x1b[${tailRow + 1};${col.x + 1}H `;
      }

      // Check if column has left the screen
      if (headRow - col.length > this.terminal.rows) {
        col.active = false;
        col.y = -999;
      }
    }

    // Write frame
    if (output.length > 0) {
      this.terminal.write(output);
      this.bytesWritten += output.length;
    }

    this.framesRendered++;
    this.frameId = requestAnimationFrame(this.frame);
  };
}
