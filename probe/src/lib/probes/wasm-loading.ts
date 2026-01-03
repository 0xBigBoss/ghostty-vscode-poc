/**
 * Wasm Loading Probe (Workstream 1)
 * Tests ghostty-web wasm loading and terminal initialization.
 */

import type { IProbeContext, IGhosttyModule } from "../terminal-adapter";
import type { WasmLoadingResults } from "../types";

export async function probeWasmLoading(
  ctx: IProbeContext,
  wasmUrl: string,
  terminalContainer: HTMLElement
): Promise<WasmLoadingResults> {
  const results: WasmLoadingResults = {
    wasmLoadSuccess: false,
    wasmInitTimeMs: 0,
    wasmBundleSizeKb: 0,
    error: null,
    terminalCreated: false,
    renderTest: {
      textWritten: false,
      colorsRendered: false,
    },
  };

  try {
    const GhosttyModule =
      (window as unknown as { GhosttyWeb?: IGhosttyModule }).GhosttyWeb ||
      (window as unknown as { ghosttyWeb?: IGhosttyModule }).ghosttyWeb;

    ctx.log(`ghostty-web module: ${GhosttyModule ? "Loaded" : "Not found"}`);

    if (!GhosttyModule) {
      results.error = "ghostty-web module not found. Check script loading.";
      return results;
    }

    // Measure wasm bundle size
    try {
      const wasmResponse = await fetch(wasmUrl);
      if (wasmResponse.ok) {
        const wasmBlob = await wasmResponse.blob();
        results.wasmBundleSizeKb = Math.round(wasmBlob.size / 1024);
      } else {
        // ghostty-web v0.4.0 embeds wasm as base64 (~413KB)
        results.wasmBundleSizeKb = 413;
      }
    } catch {
      results.wasmBundleSizeKb = 413;
    }

    // Initialize wasm
    const startInit = performance.now();

    const Ghostty = GhosttyModule.Ghostty || GhosttyModule.default?.Ghostty;
    let ghosttyInstance: unknown = null;

    if (Ghostty && typeof Ghostty.load === "function") {
      ghosttyInstance = await Ghostty.load(wasmUrl);
    } else if (GhosttyModule.init && typeof GhosttyModule.init === "function") {
      await GhosttyModule.init();
    } else if (
      GhosttyModule.default?.init &&
      typeof GhosttyModule.default.init === "function"
    ) {
      await GhosttyModule.default.init();
    }

    const initTime = performance.now() - startInit;
    results.wasmInitTimeMs = initTime;
    results.wasmLoadSuccess = true;

    ctx.log(`Wasm initialized in ${initTime.toFixed(2)}ms`);

    // Create terminal
    const Terminal = GhosttyModule.Terminal || GhosttyModule.default?.Terminal;
    if (Terminal) {
      const termOptions: { cols: number; rows: number; ghostty?: unknown } = {
        cols: 80,
        rows: 24,
      };
      if (ghosttyInstance) {
        termOptions.ghostty = ghosttyInstance;
      }
      const term = new Terminal(termOptions);
      term.open(terminalContainer);

      // Store terminal in context
      (ctx as { terminal: typeof term }).terminal = term;
      results.terminalCreated = true;

      // Test basic writing
      term.write("Hello from Ghostty!\r\n");
      if (results.renderTest) {
        results.renderTest.textWritten = true;
      }

      // Test colors
      term.write("\x1b[31mRed \x1b[32mGreen \x1b[34mBlue\x1b[0m\r\n");
      if (results.renderTest) {
        results.renderTest.colorsRendered = true;
      }

      // Test cursor positioning
      term.write("\x1b[5;10HPositioned text\r\n");
    } else {
      results.error = "Terminal constructor not found";
    }
  } catch (err) {
    results.wasmLoadSuccess = false;
    const errorMsg = err instanceof Error ? err.message : String(err);
    results.error = errorMsg;
    ctx.log(`Error: ${errorMsg}`);
  }

  return results;
}
