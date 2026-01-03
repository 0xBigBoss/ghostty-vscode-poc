import * as assert from "assert";
import * as vscode from "vscode";

type WasmLoadingResults = {
  wasmLoadSuccess: boolean;
  wasmInitTimeMs: number;
  wasmBundleSizeKb: number;
  error?: string | null;
  terminalCreated: boolean;
  renderTest?: {
    textWritten: boolean;
    colorsRendered: boolean;
  };
};

type RenderingResults = {
  textRendersCorrectly: boolean;
  colorsWork: boolean;
  cursorPositioningWorks: boolean;
  bufferAccessWorks: boolean;
};

type InputHandlingResults = {
  onDataCallbackWorks: boolean;
  standardTypingWorks: boolean;
  arrowKeysWork: boolean;
  ctrlCWorks: boolean;
  capturedInputs: Array<{ data: string; codes: number[] }>;
};

type ApiCompatibilityResults = {
  coreAPIsPresent: string[];
  missingAPIs: string[];
  bufferAccessWorks: boolean;
  fitAddonWorks: boolean;
  selectionAPIsWork: boolean;
};

type ProbeResults = {
  timestamp: string;
  wasmLoading?: WasmLoadingResults;
  rendering?: RenderingResults;
  inputHandling?: InputHandlingResults;
  apiCompatibility?: ApiCompatibilityResults;
};

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
    this.timeout(60000); // 60 second timeout for wasm loading

    // Run the probes
    await vscode.commands.executeCommand("ghostty-probe.runAll");

    // Wait for probe results with 30 second timeout
    const results = (await vscode.commands.executeCommand(
      "ghostty-probe.waitForResults",
      30000
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
    this.timeout(60000);

    // Run the probes
    await vscode.commands.executeCommand("ghostty-probe.runAll");

    // Wait for probe results
    const results = (await vscode.commands.executeCommand(
      "ghostty-probe.waitForResults",
      30000
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
    this.timeout(60000);

    // Run the probes
    await vscode.commands.executeCommand("ghostty-probe.runAll");

    // Wait for probe results
    const results = (await vscode.commands.executeCommand(
      "ghostty-probe.waitForResults",
      30000
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
    this.timeout(60000);

    // Run the probes
    await vscode.commands.executeCommand("ghostty-probe.runAll");

    // Wait for probe results
    const results = (await vscode.commands.executeCommand(
      "ghostty-probe.waitForResults",
      30000
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
});
