/**
 * Input Handling Probe (Workstream 3)
 * Tests onData callback, keyboard input, arrow keys, and control sequences.
 */

import type { IProbeContext } from "../terminal-adapter";
import type { InputHandlingResults } from "../types";

export function probeInputHandling(ctx: IProbeContext): InputHandlingResults {
  const results: InputHandlingResults = {
    onDataCallbackWorks: false,
    standardTypingWorks: false,
    arrowKeysWork: false,
    ctrlCWorks: false,
    capturedInputs: [],
  };

  if (!ctx.terminal) {
    ctx.log("Terminal not initialized - run Wasm Loading first");
    return results;
  }

  const term = ctx.terminal;

  try {
    // Test 1: onData callback
    let receivedData: string[] = [];
    const disposable = term.onData((data: string) => {
      receivedData.push(data);
      results.capturedInputs.push({
        data: data,
        codes: data.split("").map((c) => c.charCodeAt(0)),
      });
    });

    // Test 2: Standard typing via input()
    if (typeof term.input === "function") {
      term.input("x", true);

      if (receivedData.length > 0 && receivedData.includes("x")) {
        results.onDataCallbackWorks = true;
        results.standardTypingWorks = true;
        ctx.log(`onData callback: Received "${receivedData.join("")}"`);
      } else {
        ctx.log("onData callback: input() did not trigger onData");
      }
    } else {
      ctx.log("input() method: Not available");
    }

    // Test 3: Arrow key sequences
    receivedData = [];
    const arrowUpSeq = "\x1b[A";
    term.input(arrowUpSeq, true);

    if (receivedData.length > 0) {
      const received = receivedData.join("");
      const codes = received.split("").map((c) => c.charCodeAt(0));

      const isCSIArrowUp =
        codes.length >= 3 &&
        codes[0] === 0x1b &&
        codes[1] === 0x5b &&
        codes[2] === 0x41;
      const isSS3ArrowUp =
        codes.length >= 3 &&
        codes[0] === 0x1b &&
        codes[1] === 0x4f &&
        codes[2] === 0x41;

      if (isCSIArrowUp || isSS3ArrowUp) {
        results.arrowKeysWork = true;
        ctx.log(
          `Arrow key sequence: Verified ${isCSIArrowUp ? "CSI" : "SS3"} mode`
        );
      } else if (codes[0] === 0x1b) {
        ctx.log(`Arrow key sequence: Wrong sequence [${codes.join(", ")}]`);
      } else {
        ctx.log(`Arrow key sequence: Not an escape sequence`);
      }
    } else {
      ctx.log("Arrow key sequence: No data received");
    }

    // Test 4: Ctrl+C
    receivedData = [];
    const ctrlC = "\x03";
    term.input(ctrlC, true);

    if (receivedData.length > 0) {
      const received = receivedData.join("");
      if (received.charCodeAt(0) === 0x03) {
        results.ctrlCWorks = true;
        ctx.log("Ctrl+C: Received interrupt signal");
      } else {
        ctx.log("Ctrl+C: Wrong code received");
      }
    } else {
      ctx.log("Ctrl+C: No data received");
    }

    // Clean up
    disposable.dispose();

    term.write("\r\n\x1b[33m--- Input Test Complete ---\x1b[0m\r\n");
    term.focus();
  } catch (err) {
    ctx.log(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }

  return results;
}
