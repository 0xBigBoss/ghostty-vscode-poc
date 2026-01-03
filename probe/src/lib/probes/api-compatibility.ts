/**
 * API Compatibility Probe (Workstream 6)
 * Tests xterm.js API compatibility with ghostty-web.
 */

import type {
  IProbeContext,
  IGhosttyModule,
  IFitAddon,
} from "../terminal-adapter";
import type { ApiCompatibilityResults } from "../types";

export function probeApiCompatibility(
  ctx: IProbeContext
): ApiCompatibilityResults {
  const results: ApiCompatibilityResults = {
    coreAPIsPresent: [],
    missingAPIs: [],
    bufferAccessWorks: false,
    fitAddonWorks: false,
    selectionAPIsWork: false,
  };

  const GhosttyModule =
    (window as unknown as { GhosttyWeb?: IGhosttyModule }).GhosttyWeb ||
    (window as unknown as { ghosttyWeb?: IGhosttyModule }).ghosttyWeb;

  const Terminal = GhosttyModule?.Terminal || GhosttyModule?.default?.Terminal;
  const FitAddon = GhosttyModule?.FitAddon || GhosttyModule?.default?.FitAddon;

  const term = ctx.terminal;

  // Define expected xterm.js APIs
  const expectedAPIs: Record<string, () => boolean> = {
    // Terminal lifecycle
    "Terminal constructor": () => typeof Terminal === "function",
    "term.open": () => !!term && typeof term.open === "function",
    "term.dispose": () => !!term && typeof term.dispose === "function",

    // I/O
    "term.write": () => !!term && typeof term.write === "function",
    "term.writeln": () => !!term && typeof term.writeln === "function",
    "term.onData": () => !!term && term.onData !== undefined,
    "term.onBinary": () => !!term && term.onBinary !== undefined,
    "term.input": () => !!term && typeof term.input === "function",
    "term.paste": () => !!term && typeof term.paste === "function",

    // Dimensions
    "term.cols": () => !!term && typeof term.cols === "number",
    "term.rows": () => !!term && typeof term.rows === "number",
    "term.resize": () => !!term && typeof term.resize === "function",
    "term.onResize": () => !!term && term.onResize !== undefined,

    // Buffer access
    "term.buffer": () => !!term && term.buffer !== undefined,
    "term.buffer.active": () => !!term?.buffer?.active,
    "buffer.active.getLine": () =>
      !!term?.buffer?.active &&
      typeof term.buffer.active.getLine === "function",

    // Selection
    "term.getSelection": () =>
      !!term && typeof term.getSelection === "function",
    "term.select": () => !!term && typeof term.select === "function",
    "term.clearSelection": () =>
      !!term && typeof term.clearSelection === "function",
    "term.hasSelection": () =>
      !!term && typeof term.hasSelection === "function",

    // Focus
    "term.focus": () => !!term && typeof term.focus === "function",
    "term.blur": () => !!term && typeof term.blur === "function",

    // Addons
    "term.loadAddon": () => !!term && typeof term.loadAddon === "function",
    FitAddon: () => typeof FitAddon === "function",

    // Events
    "term.onBell": () => !!term && term.onBell !== undefined,
    "term.onKey": () => !!term && term.onKey !== undefined,
    "term.onTitleChange": () => !!term && term.onTitleChange !== undefined,
    "term.onScroll": () => !!term && term.onScroll !== undefined,

    // Scrolling
    "term.scrollLines": () => !!term && typeof term.scrollLines === "function",
    "term.scrollPages": () => !!term && typeof term.scrollPages === "function",
    "term.scrollToTop": () => !!term && typeof term.scrollToTop === "function",
    "term.scrollToBottom": () =>
      !!term && typeof term.scrollToBottom === "function",

    // Other
    "term.clear": () => !!term && typeof term.clear === "function",
    "term.reset": () => !!term && typeof term.reset === "function",
    "term.options": () => !!term && term.options !== undefined,
  };

  // Test each API
  for (const [api, test] of Object.entries(expectedAPIs)) {
    try {
      const present = test();
      if (present) {
        results.coreAPIsPresent.push(api);
        ctx.log(`${api}: Present`);
      } else {
        results.missingAPIs.push(api);
        ctx.log(`${api}: Missing`);
      }
    } catch (err) {
      results.missingAPIs.push(api);
      ctx.log(
        `${api}: Error - ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Test buffer access in detail
  if (term?.buffer?.active) {
    try {
      const line = term.buffer.active.getLine(0);
      if (line && typeof line.getCell === "function") {
        const cell = line.getCell(0);
        if (cell && typeof cell.getChars === "function") {
          results.bufferAccessWorks = true;
        }
      }
    } catch {
      // Buffer access failed
    }
  }

  // Test FitAddon
  if (FitAddon && term && term.loadAddon) {
    try {
      const fitAddon = new FitAddon() as IFitAddon;
      term.loadAddon(fitAddon);
      if (typeof fitAddon.fit === "function") {
        results.fitAddonWorks = true;
        ctx.log("FitAddon.fit(): Works");
      }
    } catch (err) {
      ctx.log(
        `FitAddon.fit(): Error - ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Test selection APIs
  if (term && term.select && term.getSelection && term.clearSelection) {
    try {
      term.select(0, 0, 5);
      term.getSelection();
      term.clearSelection();
      results.selectionAPIsWork = true;
    } catch {
      // Selection APIs may have issues
    }
  }

  const total = Object.keys(expectedAPIs).length;
  const present = results.coreAPIsPresent.length;
  const coverage = Math.round((present / total) * 100);
  ctx.log(`API Coverage: ${present}/${total} (${coverage}%)`);

  return results;
}
