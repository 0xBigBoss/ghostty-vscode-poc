/**
 * VS Code webview adapter entry point.
 *
 * Note: Currently the main webview logic is still in probeHtml.ts.
 * This module is prepared for when we fully migrate to bundled modules.
 *
 * When the migration is complete, this will:
 * 1. Initialize the messaging bridge
 * 2. Load ghostty-web wasm
 * 3. Create the terminal
 * 4. Run probes and report results
 */

export * from "./messaging";
export * from "./ui";

// Re-export lib modules for convenience
export * from "../../lib/types";
export * from "../../lib/data-generators";
export * from "../../lib/terminal-adapter";
