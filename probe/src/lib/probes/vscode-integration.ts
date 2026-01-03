/**
 * VS Code Integration Probe (Workstream 5)
 * Tests messaging, resize handling, theme integration, and focus management.
 */

import type { IProbeContext } from "../terminal-adapter";
import type { VsCodeIntegrationResults } from "../types";

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

export async function probeVsCodeIntegration(
  ctx: IProbeContext,
  vscode: VsCodeApi
): Promise<VsCodeIntegrationResults> {
  const results: VsCodeIntegrationResults = {
    messagingWorks: false,
    resizeWorks: false,
    themeIntegrationWorks: false,
    focusManagementWorks: false,
  };

  if (!ctx.terminal) {
    ctx.log("Terminal not initialized - run Wasm Loading first");
    return results;
  }

  const term = ctx.terminal;

  // Track round-trip message responses
  let integrationTestResolve: ((value: unknown) => void) | null = null;

  const messageHandler = (event: MessageEvent) => {
    const message = event.data;
    if (message.type === "integrationTestResponse" && integrationTestResolve) {
      integrationTestResolve(message.payload);
      integrationTestResolve = null;
    }
  };

  window.addEventListener("message", messageHandler);

  try {
    // Test 1: Message passing with round-trip validation
    try {
      const testPayload = { test: "ping", timestamp: Date.now() };
      const responsePromise = new Promise((resolve, reject) => {
        integrationTestResolve = resolve;
        setTimeout(() => {
          if (integrationTestResolve) {
            integrationTestResolve = null;
            reject(new Error("Timeout waiting for response"));
          }
        }, 2000);
      });

      vscode.postMessage({ type: "integrationTest", payload: testPayload });

      const response = (await responsePromise) as { echo?: string };
      if (response && response.echo === testPayload.test) {
        results.messagingWorks = true;
        ctx.log("Message passing: Round-trip verified");
      } else {
        ctx.log("Message passing: Extension did not echo correctly");
      }
    } catch (msgErr) {
      ctx.log(
        `Message passing: Failed - ${msgErr instanceof Error ? msgErr.message : String(msgErr)}`
      );
    }

    // Test 2: Terminal resize handling
    try {
      const originalCols = term.cols;
      const originalRows = term.rows;

      term.resize(100, 30);

      if (term.cols === 100 && term.rows === 30) {
        results.resizeWorks = true;
        ctx.log(
          `Resize handling: Resized from ${originalCols}x${originalRows} to 100x30`
        );
      } else {
        ctx.log(
          `Resize handling: Expected 100x30, got ${term.cols}x${term.rows}`
        );
      }

      term.resize(originalCols, originalRows);
    } catch (resizeErr) {
      ctx.log(
        `Resize handling: Failed - ${resizeErr instanceof Error ? resizeErr.message : String(resizeErr)}`
      );
    }

    // Test 3: Theme/color integration
    try {
      const computedStyle = getComputedStyle(document.body);
      const vscBg = computedStyle.getPropertyValue("--vscode-editor-background");
      const vscFg = computedStyle.getPropertyValue("--vscode-foreground");

      if (vscBg && vscFg) {
        results.themeIntegrationWorks = true;
        ctx.log(`Theme integration: Variables accessible (bg: ${vscBg.trim()})`);
      } else {
        ctx.log("Theme integration: VS Code CSS variables not found");
      }
    } catch (themeErr) {
      ctx.log(
        `Theme integration: Failed - ${themeErr instanceof Error ? themeErr.message : String(themeErr)}`
      );
    }

    // Test 4: Focus management
    try {
      const hasFocus = typeof term.focus === "function";
      const hasBlur = typeof term.blur === "function";

      if (hasFocus && hasBlur) {
        term.focus();
        term.blur();
        results.focusManagementWorks = true;
        ctx.log("Focus management: focus() and blur() work");
      } else {
        ctx.log("Focus management: APIs missing");
      }
    } catch (focusErr) {
      ctx.log(
        `Focus management: Failed - ${focusErr instanceof Error ? focusErr.message : String(focusErr)}`
      );
    }
  } finally {
    window.removeEventListener("message", messageHandler);
  }

  return results;
}
