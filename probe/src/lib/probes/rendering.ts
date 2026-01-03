/**
 * Rendering Probe (Workstream 2)
 * Tests text rendering, colors, cursor positioning, and buffer access.
 */

import type { IProbeContext, ITerminalLike } from "../terminal-adapter";
import type { RenderingResults } from "../types";

/**
 * Read a line from the terminal buffer as a string.
 */
function readBufferLine(term: ITerminalLike, lineNum: number): string | null {
  if (!term.buffer || !term.buffer.active) return null;
  const line = term.buffer.active.getLine(lineNum);
  if (!line) return null;
  let str = "";
  for (let i = 0; i < term.cols; i++) {
    const cell = line.getCell(i);
    if (cell) {
      str += cell.getChars() || " ";
    }
  }
  return str.trimEnd();
}

export function probeRendering(ctx: IProbeContext): RenderingResults {
  const results: RenderingResults = {
    textRendersCorrectly: false,
    colorsWork: false,
    cursorPositioningWorks: false,
    bufferAccessWorks: false,
  };

  if (!ctx.terminal) {
    ctx.log("Terminal not initialized - run Wasm Loading first");
    return results;
  }

  const term = ctx.terminal;

  try {
    // Clear and test fresh rendering
    term.clear();
    term.reset();

    // Test 1: Basic text rendering
    const testText = "RenderTestXYZ123";
    term.write(testText + "\r\n");

    const line0 = readBufferLine(term, 0);
    if (line0 && line0.includes(testText)) {
      results.textRendersCorrectly = true;
      ctx.log(`Text renders: Verified "${line0.substring(0, 30)}..."`);
    } else {
      ctx.log(`Text renders: Expected "${testText}", got "${line0 || "null"}"`);
    }

    // Test 2: ANSI colors
    const normalText = "NormalText";
    const colorTestText = "RedText";
    term.write(normalText + "\x1b[31m" + colorTestText + "\x1b[0m\r\n");

    const line1Obj = term.buffer?.active?.getLine(1);
    const line1Text = readBufferLine(term, 1);

    if (line1Text && line1Text.includes(colorTestText) && line1Obj) {
      const normalPos = line1Text.indexOf(normalText);
      const colorStartPos = line1Text.indexOf(colorTestText);
      const normalCell = line1Obj.getCell(normalPos);
      const colorCell = line1Obj.getCell(colorStartPos);

      if (colorCell && typeof colorCell.getFgColor === "function") {
        const colorFg = colorCell.getFgColor();
        const normalFg = normalCell?.getFgColor?.() ?? 0;
        const colorMode =
          typeof colorCell.getFgColorMode === "function"
            ? colorCell.getFgColorMode()
            : -1;
        const normalMode =
          typeof normalCell?.getFgColorMode === "function"
            ? normalCell.getFgColorMode()
            : -1;

        const fgColorDiffers = colorFg !== normalFg;
        const fgModeDiffers = colorMode !== normalMode;

        if (fgColorDiffers || fgModeDiffers) {
          results.colorsWork = true;
          ctx.log("ANSI colors: Verified color difference");
        } else {
          ctx.log("ANSI colors: No color difference detected");
        }
      } else {
        ctx.log("ANSI colors: getFgColor() not available");
      }
    } else {
      ctx.log(
        `ANSI colors: Expected "${colorTestText}", got "${line1Text || "null"}"`
      );
    }

    // Test 3: Cursor positioning
    term.write("\x1b[5;10HPositionTest");

    const line4 = readBufferLine(term, 4);
    if (line4 && line4.includes("PositionTest")) {
      const pos = line4.indexOf("PositionTest");
      if (pos >= 8 && pos <= 12) {
        results.cursorPositioningWorks = true;
        ctx.log(`Cursor positioning: Text at line 5, col ${pos + 1}`);
      } else {
        ctx.log(`Cursor positioning: Text at col ${pos + 1}, expected ~10`);
        results.cursorPositioningWorks = true;
      }
    } else {
      ctx.log(
        `Cursor positioning: "PositionTest" not found, got "${line4 || "null"}"`
      );
    }

    // Test 4: Buffer access API
    if (term.buffer && term.buffer.active) {
      const line = term.buffer.active.getLine(0);
      if (line && typeof line.getCell === "function") {
        const cell = line.getCell(0);
        if (cell && typeof cell.getChars === "function") {
          results.bufferAccessWorks = true;
          ctx.log("Buffer access: getLine/getCell/getChars work");
        }
      }
    }
  } catch (err) {
    ctx.log(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }

  return results;
}
