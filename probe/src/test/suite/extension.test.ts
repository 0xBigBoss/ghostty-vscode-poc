import * as assert from "assert";
import * as vscode from "vscode";

suite("Ghostty Probe Extension Test Suite", () => {
  test("Extension should be present", () => {
    const extension = vscode.extensions.getExtension("0xbigboss.ghostty-webgl-probe");
    assert.ok(extension, "Extension should be installed");
  });

  test("Extension should activate", async () => {
    const extension = vscode.extensions.getExtension("0xbigboss.ghostty-webgl-probe");
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

  test("Show Probe Panel command should execute without error", async () => {
    try {
      await vscode.commands.executeCommand("ghostty-probe.showPanel");
      // Give the webview time to load
      await new Promise((resolve) => setTimeout(resolve, 2000));
      assert.ok(true, "Command executed successfully");
    } catch (err) {
      assert.fail(`Command failed: ${err}`);
    }
  });
});
