import * as assert from "assert";
import * as vscode from "vscode";
import type { ProbeResults } from "../../lib/types";

suite("Ghostty Probe Extension Test Suite", () => {
  test("Extension should be present", () => {
    const extension = vscode.extensions.getExtension(
      "0xbigboss.ghostty-webgl-probe"
    );
    assert.ok(extension, "Extension should be installed");
  });

  test("Extension should activate", async () => {
    const extension = vscode.extensions.getExtension(
      "0xbigboss.ghostty-webgl-probe"
    );
    if (extension && !extension.isActive) {
      await extension.activate();
    }
    assert.ok(extension?.isActive, "Extension should be active");
  });

  test("Show Probe Panel command should be registered", async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("ghostty-probe.showPanel"),
      "ghostty-probe.showPanel command should be registered"
    );
  });

  test("Run All Probes command should be registered", async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("ghostty-probe.runAll"),
      "ghostty-probe.runAll command should be registered"
    );
  });

  test("Wasm should load successfully in webview (success criteria 5-6)", async function () {
    this.timeout(600000); // 10 minute timeout (runAll includes 10 MiB throughput benchmark)

    // Run the probes
    await vscode.commands.executeCommand("ghostty-probe.runAll");

    // Wait for probe results with 9 minute timeout (throughput takes time)
    const results = (await vscode.commands.executeCommand(
      "ghostty-probe.waitForResults",
      540000
    )) as ProbeResults;

    // Validate wasm loading results
    assert.ok(results, "Should receive probe results");
    assert.ok(results.wasmLoading, "Should have wasmLoading results");

    const wasmResults = results.wasmLoading;

    // Success criteria 5: Extension runs in VS Code and webview loads without errors
    // Success criteria 6: Wasm initialization completes (no CSP/sandbox errors)
    assert.strictEqual(
      wasmResults.wasmLoadSuccess,
      true,
      `Wasm should load successfully. Error: ${wasmResults.error || "none"}`
    );

    // Verify init time is reasonable (< 500ms per spec)
    assert.ok(
      wasmResults.wasmInitTimeMs < 500,
      `Wasm init time should be < 500ms, got ${wasmResults.wasmInitTimeMs}ms`
    );

    // Verify bundle size is measured (not 0)
    assert.ok(
      wasmResults.wasmBundleSizeKb > 0,
      `Wasm bundle size should be measured, got ${wasmResults.wasmBundleSizeKb}KB`
    );

    // Verify terminal was created
    assert.strictEqual(
      wasmResults.terminalCreated,
      true,
      "Terminal should be created after wasm init"
    );

    // Log results for visibility
    console.log("[Test] Wasm loading results:", JSON.stringify(wasmResults, null, 2));
  });

  test("Rendering should work correctly (Workstream 2)", async function () {
    this.timeout(600000); // 10 minute timeout (runAll includes 10 MiB throughput benchmark)

    // Run the probes
    await vscode.commands.executeCommand("ghostty-probe.runAll");

    // Wait for probe results
    const results = (await vscode.commands.executeCommand(
      "ghostty-probe.waitForResults",
      540000
    )) as ProbeResults;

    assert.ok(results.rendering, "Should have rendering results");

    const renderResults = results.rendering;

    // Verify text rendering
    assert.strictEqual(
      renderResults.textRendersCorrectly,
      true,
      "Text should render correctly"
    );

    // Verify colors work
    assert.strictEqual(
      renderResults.colorsWork,
      true,
      "ANSI colors should work"
    );

    // Verify cursor positioning
    assert.strictEqual(
      renderResults.cursorPositioningWorks,
      true,
      "Cursor positioning should work"
    );

    console.log("[Test] Rendering results:", JSON.stringify(renderResults, null, 2));
  });

  test("Input handling should work (Workstream 3)", async function () {
    this.timeout(600000); // 10 minute timeout (runAll includes 10 MiB throughput benchmark)

    // Run the probes
    await vscode.commands.executeCommand("ghostty-probe.runAll");

    // Wait for probe results
    const results = (await vscode.commands.executeCommand(
      "ghostty-probe.waitForResults",
      540000
    )) as ProbeResults;

    assert.ok(results.inputHandling, "Should have input handling results");

    const inputResults = results.inputHandling;

    // Verify onData callback works - must receive actual data
    assert.strictEqual(
      inputResults.onDataCallbackWorks,
      true,
      "onData callback should receive data when input() is called"
    );

    // Verify standard typing works - must receive the typed character
    assert.strictEqual(
      inputResults.standardTypingWorks,
      true,
      "Standard typing should work - input('x') must trigger onData with 'x'"
    );

    // Verify arrow keys work - must receive escape sequence
    assert.strictEqual(
      inputResults.arrowKeysWork,
      true,
      "Arrow keys should work - must receive ESC[A sequence via onData"
    );

    // Verify Ctrl+C works - must receive 0x03
    assert.strictEqual(
      inputResults.ctrlCWorks,
      true,
      "Ctrl+C should work - must receive 0x03 via onData"
    );

    // Verify we actually captured inputs
    assert.ok(
      inputResults.capturedInputs.length >= 3,
      `Should capture at least 3 inputs (char, arrow, ctrl+c), got ${inputResults.capturedInputs.length}`
    );

    console.log("[Test] Input handling results:", JSON.stringify(inputResults, null, 2));
  });

  test("xterm.js API compatibility (Workstream 6)", async function () {
    this.timeout(600000); // 10 minute timeout (runAll includes 10 MiB throughput benchmark)

    // Run the probes
    await vscode.commands.executeCommand("ghostty-probe.runAll");

    // Wait for probe results
    const results = (await vscode.commands.executeCommand(
      "ghostty-probe.waitForResults",
      540000
    )) as ProbeResults;

    assert.ok(results.apiCompatibility, "Should have API compatibility results");

    const apiResults = results.apiCompatibility;

    // Verify high API coverage (at least 70%)
    const total = apiResults.coreAPIsPresent.length + apiResults.missingAPIs.length;
    const coverage = Math.round((apiResults.coreAPIsPresent.length / total) * 100);

    assert.ok(
      coverage >= 70,
      `API coverage should be at least 70%, got ${coverage}%`
    );

    // Log summary
    console.log("[Test] API compatibility results:");
    console.log(`  Coverage: ${apiResults.coreAPIsPresent.length}/${total} (${coverage}%)`);
    console.log(`  Buffer access: ${apiResults.bufferAccessWorks}`);
    console.log(`  FitAddon: ${apiResults.fitAddonWorks}`);
    console.log(`  Selection APIs: ${apiResults.selectionAPIsWork}`);
    if (apiResults.missingAPIs.length > 0) {
      console.log(`  Missing APIs: ${apiResults.missingAPIs.join(", ")}`);
    }
  });

  test("Throughput benchmark should measure and report (Workstream 4)", async function () {
    this.timeout(600000); // 10 minute timeout for throughput tests (10 MiB x 4 runs)

    // Run the probes
    await vscode.commands.executeCommand("ghostty-probe.runAll");

    // Wait for probe results with longer timeout for throughput tests
    const results = (await vscode.commands.executeCommand(
      "ghostty-probe.waitForResults",
      540000 // 9 minute timeout for results
    )) as ProbeResults;

    assert.ok(results.throughput, "Should have throughput results");

    const throughputResults = results.throughput;
    const TARGET_THROUGHPUT = 30; // MiB/s

    // Verify measurements were taken (non-zero values)
    assert.ok(
      throughputResults.plainTextThroughputMiBs > 0,
      "Plain text throughput must be measured"
    );
    assert.ok(
      throughputResults.sgrHeavyThroughputMiBs > 0,
      "SGR-heavy throughput must be measured"
    );
    assert.ok(
      throughputResults.cursorHeavyThroughputMiBs > 0,
      "Cursor-heavy throughput must be measured"
    );

    // Log the actual throughput for visibility
    console.log("[Test] Throughput results (10 MiB workload, 4KB chunks per spec):");
    console.log(`  Plain text: ${throughputResults.plainTextThroughputMiBs} MiB/s`);
    console.log(`  SGR-heavy: ${throughputResults.sgrHeavyThroughputMiBs} MiB/s`);
    console.log(`  Cursor-heavy: ${throughputResults.cursorHeavyThroughputMiBs} MiB/s`);
    console.log(`  SGR ratio: ${throughputResults.sgrRatio}x (target: <=2x)`);
    console.log(`  Memory stable: ${throughputResults.memoryStableAfterRuns}`);
    console.log(`  Peak memory delta: ${throughputResults.peakMemoryMb} MB`);

    // Enforce spec thresholds - these are the Go/No-Go criteria per SPEC.md
    // Plain text must be >30 MiB/s
    assert.ok(
      throughputResults.passesThreshold,
      `Plain text throughput must be >${TARGET_THROUGHPUT} MiB/s per spec, got ${throughputResults.plainTextThroughputMiBs} MiB/s (NO-GO: Consider Phase 2 custom WebGL renderer)`
    );

    // SGR-heavy must be within 2x of plain text
    assert.ok(
      throughputResults.sgrRatio <= 2,
      `SGR ratio must be <=2x per spec, got ${throughputResults.sgrRatio}x`
    );

    // Memory stability check - warn only, don't fail the test
    // Rationale: performance.memory measurements are inherently flaky due to:
    // - Unpredictable GC timing in Chromium
    // - WASM memory not fully captured by usedJSHeapSize
    // - Electron's process model affecting heap measurements
    // The check exists to catch egregious leaks during manual investigation,
    // not as a reliable automated gate.
    if (!throughputResults.memoryStableAfterRuns) {
      console.warn(
        `[Test] WARNING: Memory appears unstable (peak delta: ${throughputResults.peakMemoryMb} MB). ` +
          "This may indicate a memory leak, or may be GC timing variance. " +
          "Investigate if this warning persists across multiple runs."
      );
    }

    console.log("");
    console.log("[Test] OVERALL: GO - All throughput criteria met");
  });

  test("VS Code integration should work (Workstream 5)", async function () {
    this.timeout(600000); // 10 minute timeout (includes throughput benchmark)

    // Run the probes
    await vscode.commands.executeCommand("ghostty-probe.runAll");

    // Wait for probe results (same timeout as throughput test)
    const results = (await vscode.commands.executeCommand(
      "ghostty-probe.waitForResults",
      540000
    )) as ProbeResults;

    assert.ok(results.vsCodeIntegration, "Should have VS Code integration results");

    const integrationResults = results.vsCodeIntegration;

    // Verify message passing works
    assert.strictEqual(
      integrationResults.messagingWorks,
      true,
      "Message passing (extension ↔ webview) should work"
    );

    // Verify resize handling works
    assert.strictEqual(
      integrationResults.resizeWorks,
      true,
      "Terminal resize handling should work"
    );

    // Verify focus management works
    assert.strictEqual(
      integrationResults.focusManagementWorks,
      true,
      "Focus management (focus/blur APIs) should work"
    );

    // Log results
    console.log("[Test] VS Code integration results:");
    console.log(`  Messaging: ${integrationResults.messagingWorks}`);
    console.log(`  Resize: ${integrationResults.resizeWorks}`);
    console.log(`  Theme integration: ${integrationResults.themeIntegrationWorks}`);
    console.log(`  Focus management: ${integrationResults.focusManagementWorks}`);
  });
});
