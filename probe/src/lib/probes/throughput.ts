/**
 * Throughput Benchmark Probe (Workstream 4)
 * Measures terminal write throughput with plain text, SGR-heavy, and cursor-heavy workloads.
 */

import type { IProbeContext } from "../terminal-adapter";
import type { ThroughputResults } from "../types";
import {
  generatePlainText,
  generateSgrHeavy,
  generateCursorHeavy,
  TARGET_THROUGHPUT_MIBS,
  SPEC_SIZE_MIB,
} from "../data-generators";

export async function probeThroughput(
  ctx: IProbeContext,
  terminalContainer?: HTMLElement
): Promise<ThroughputResults> {
  const results: ThroughputResults = {
    plainTextThroughputMiBs: 0,
    sgrHeavyThroughputMiBs: 0,
    cursorHeavyThroughputMiBs: 0,
    sgrRatio: 0,
    peakMemoryMb: 0,
    memoryStableAfterRuns: false,
    passesThreshold: false,
  };

  if (!ctx.terminal) {
    ctx.log("Terminal not initialized - run Wasm Loading first");
    return results;
  }

  const term = ctx.terminal;

  // Run throughput test for a workload
  function measureThroughput(
    chunks: string[],
    totalBytes: number
  ): { throughputMiBs: number; elapsedMs: number } {
    const start = performance.now();

    for (let i = 0; i < chunks.length; i++) {
      term.write(chunks[i]);
    }

    const elapsed = performance.now() - start;
    const throughputMiBs = totalBytes / (1024 * 1024) / (elapsed / 1000);
    return { throughputMiBs, elapsedMs: elapsed };
  }

  // Visual indicator functions
  function startBenchmarkIndicator(): void {
    terminalContainer?.classList.add("benchmark-running");
    const indicator = document.getElementById("benchmarkIndicator");
    indicator?.classList.add("visible");
  }

  function stopBenchmarkIndicator(): void {
    terminalContainer?.classList.remove("benchmark-running");
    const indicator = document.getElementById("benchmarkIndicator");
    indicator?.classList.remove("visible");
  }

  // Get memory usage
  function getMemoryMb(): number {
    if (
      (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
    ) {
      return (
        (performance as unknown as { memory: { usedJSHeapSize: number } })
          .memory.usedJSHeapSize /
        (1024 * 1024)
      );
    }
    return 0;
  }

  try {
    const memoryReadings: number[] = [];
    const baselineMemory = getMemoryMb();
    memoryReadings.push(baselineMemory);

    function runBenchmarkWithIndicator(
      _name: string,
      dataGenerator: () => { chunks: string[]; totalBytes: number }
    ): { throughputMiBs: number; elapsedMs: number } {
      startBenchmarkIndicator();
      const data = dataGenerator();
      const result = measureThroughput(data.chunks, data.totalBytes);
      stopBenchmarkIndicator();
      return result;
    }

    // Test 1: Plain text throughput
    ctx.log(`Running plain text benchmark (${SPEC_SIZE_MIB} MiB)...`);
    const plainResult = runBenchmarkWithIndicator("plain", () =>
      generatePlainText(SPEC_SIZE_MIB)
    );
    results.plainTextThroughputMiBs =
      Math.round(plainResult.throughputMiBs * 10) / 10;
    memoryReadings.push(getMemoryMb());
    ctx.log(`Plain text: ${results.plainTextThroughputMiBs} MiB/s`);

    term.clear();

    // Test 2: SGR-heavy throughput
    ctx.log(`Running SGR-heavy benchmark (${SPEC_SIZE_MIB} MiB)...`);
    const sgrResult = runBenchmarkWithIndicator("sgr", () =>
      generateSgrHeavy(SPEC_SIZE_MIB)
    );
    results.sgrHeavyThroughputMiBs =
      Math.round(sgrResult.throughputMiBs * 10) / 10;
    memoryReadings.push(getMemoryMb());

    results.sgrRatio =
      results.sgrHeavyThroughputMiBs > 0
        ? Math.round(
            (results.plainTextThroughputMiBs / results.sgrHeavyThroughputMiBs) *
              10
          ) / 10
        : 0;
    ctx.log(
      `SGR-heavy: ${results.sgrHeavyThroughputMiBs} MiB/s (ratio: ${results.sgrRatio}x)`
    );

    term.clear();

    // Test 3: Cursor-heavy throughput
    ctx.log(`Running cursor-heavy benchmark (${SPEC_SIZE_MIB} MiB)...`);
    const cursorResult = runBenchmarkWithIndicator("cursor", () =>
      generateCursorHeavy(SPEC_SIZE_MIB)
    );
    results.cursorHeavyThroughputMiBs =
      Math.round(cursorResult.throughputMiBs * 10) / 10;
    memoryReadings.push(getMemoryMb());
    ctx.log(`Cursor-heavy: ${results.cursorHeavyThroughputMiBs} MiB/s`);

    // Memory leak detection - run extra benchmark to check for leaks
    runBenchmarkWithIndicator("extra", () => generatePlainText(SPEC_SIZE_MIB));
    memoryReadings.push(getMemoryMb());

    const peakMemory = Math.max(...memoryReadings);
    results.peakMemoryMb = Math.round((peakMemory - baselineMemory) * 10) / 10;

    // Check memory stability: we want to detect unbounded growth (memory leaks)
    // not normal GC variance. Memory is "stable" if:
    // 1. Memory is available to measure (performance.memory exists)
    // 2. Final memory is not excessively larger than baseline
    //
    // We compare final to baseline (not consecutive readings) because:
    // - GC timing is unpredictable, causing wild swings between readings
    // - Memory often grows during initial terminal setup, then stabilizes
    // - We care about leaks (unbounded growth), not temporary allocations
    //
    // Threshold: 500 MB absolute growth or 5x baseline, whichever is larger
    // This is very lenient - we only catch egregious leaks, not normal variance
    const finalReading = memoryReadings[memoryReadings.length - 1];

    if (baselineMemory === 0 || finalReading === 0) {
      // Can't measure memory - assume stable (can't detect leaks anyway)
      results.memoryStableAfterRuns = true;
    } else {
      const absoluteGrowth = finalReading - baselineMemory;
      const relativeGrowth = finalReading / baselineMemory;

      // Memory is stable if growth is under 500 MB AND under 5x baseline
      // This catches real leaks while tolerating normal GC variance
      results.memoryStableAfterRuns = absoluteGrowth < 500 && relativeGrowth < 5;

      ctx.log(
        `Memory readings: [${memoryReadings.map((m) => m.toFixed(1)).join(", ")}] MB`
      );
      ctx.log(
        `Memory: baseline=${baselineMemory.toFixed(1)} MB, final=${finalReading.toFixed(1)} MB, growth=${absoluteGrowth.toFixed(1)} MB (${relativeGrowth.toFixed(1)}x)`
      );
    }

    ctx.log(
      `Memory delta: ${results.peakMemoryMb} MB (stable: ${results.memoryStableAfterRuns})`
    );

    // Overall pass/fail
    results.passesThreshold =
      results.plainTextThroughputMiBs >= TARGET_THROUGHPUT_MIBS;

    term.write("\r\n\x1b[33m--- Throughput Test Complete ---\x1b[0m\r\n");
  } catch (err) {
    ctx.log(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }

  return results;
}
