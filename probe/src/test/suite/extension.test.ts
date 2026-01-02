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

type ProbeResults = {
  timestamp: string;
  wasmLoading?: WasmLoadingResults;
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
});
