import * as vscode from "vscode";
import { getProbeHtml } from "./webview/probeHtml";
import * as path from "path";
import type { ProbeResults, ProbeMessage } from "./lib/types";

let probePanel: vscode.WebviewPanel | undefined;
let lastProbeResults: ProbeResults | undefined;
let probeResultsPromiseResolve: ((results: ProbeResults) => void) | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const showPanelCommand = vscode.commands.registerCommand(
    "ghostty-probe.showPanel",
    () => showProbePanel(context)
  );

  const runAllCommand = vscode.commands.registerCommand(
    "ghostty-probe.runAll",
    () => {
      showProbePanel(context);
      probePanel?.webview.postMessage({ command: "runAll" });
    }
  );

  // Command to get last probe results (for testing)
  const getResultsCommand = vscode.commands.registerCommand(
    "ghostty-probe.getLastResults",
    () => lastProbeResults
  );

  // Command to wait for probe results (for testing)
  const waitForResultsCommand = vscode.commands.registerCommand(
    "ghostty-probe.waitForResults",
    (timeoutMs: number = 30000) => {
      return new Promise<ProbeResults>((resolve, reject) => {
        // If we already have results, return them
        if (lastProbeResults) {
          resolve(lastProbeResults);
          return;
        }
        // Set up resolver for when results come in
        probeResultsPromiseResolve = resolve;
        // Timeout
        setTimeout(() => {
          if (probeResultsPromiseResolve === resolve) {
            probeResultsPromiseResolve = undefined;
            reject(new Error("Timeout waiting for probe results"));
          }
        }, timeoutMs);
      });
    }
  );

  context.subscriptions.push(
    showPanelCommand,
    runAllCommand,
    getResultsCommand,
    waitForResultsCommand
  );
}

function showProbePanel(context: vscode.ExtensionContext): void {
  if (probePanel) {
    probePanel.reveal(vscode.ViewColumn.One);
    return;
  }

  // Get the path to ghostty-web in node_modules
  const ghosttyWebPath = path.join(
    context.extensionPath,
    "node_modules",
    "ghostty-web",
    "dist"
  );

  probePanel = vscode.window.createWebviewPanel(
    "ghosttyProbe",
    "Ghostty Probe",
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.file(ghosttyWebPath),
        vscode.Uri.file(path.join(context.extensionPath, "node_modules")),
      ],
    }
  );

  // Create URIs for ghostty-web files
  const ghosttyWebJsUri = probePanel.webview.asWebviewUri(
    vscode.Uri.file(path.join(ghosttyWebPath, "ghostty-web.umd.cjs"))
  );
  const ghosttyWasmUri = probePanel.webview.asWebviewUri(
    vscode.Uri.file(path.join(ghosttyWebPath, "ghostty-vt.wasm"))
  );

  probePanel.webview.html = getProbeHtml(
    ghosttyWebJsUri.toString(),
    ghosttyWasmUri.toString(),
    probePanel.webview.cspSource
  );

  probePanel.webview.onDidReceiveMessage(
    (message: ProbeMessage) => handleProbeMessage(message, context),
    undefined,
    context.subscriptions
  );

  probePanel.onDidDispose(() => {
    probePanel = undefined;
  });
}

async function handleProbeMessage(
  message: ProbeMessage,
  _context: vscode.ExtensionContext
): Promise<void> {
  switch (message.type) {
    case "probeResults": {
      // Store results for testing
      lastProbeResults = message.payload;
      // Resolve any waiting promises
      if (probeResultsPromiseResolve) {
        probeResultsPromiseResolve(message.payload);
        probeResultsPromiseResolve = undefined;
      }

      const outputChannel = vscode.window.createOutputChannel("Ghostty Probe");
      outputChannel.appendLine(JSON.stringify(message.payload, null, 2));
      outputChannel.show();

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const fileName = `probe-results-${timestamp}.json`;
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;

      if (workspaceRoot) {
        const artifactsDirUri = vscode.Uri.joinPath(workspaceRoot, "artifacts");
        const artifactsUri = vscode.Uri.joinPath(artifactsDirUri, fileName);
        const content = Buffer.from(
          JSON.stringify(message.payload, null, 2),
          "utf-8"
        );
        try {
          // Ensure artifacts directory exists
          await vscode.workspace.fs.createDirectory(artifactsDirUri);
          await vscode.workspace.fs.writeFile(artifactsUri, content);
          vscode.window.showInformationMessage(`Probe results saved: ${fileName}`);
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Failed to save probe results: ${errorMessage}`);
          console.error("[Probe] Failed to save results:", err);
        }
      } else {
        vscode.window.showWarningMessage("No workspace folder open. Results shown in Output panel only.");
      }
      break;
    }
    case "log":
      console.log("[Probe]", message.payload);
      break;
    case "integrationTest": {
      // Echo the message back to validate round-trip messaging
      console.log("[Probe] Integration test received:", message.payload);
      probePanel?.webview.postMessage({
        type: "integrationTestResponse",
        payload: { echo: message.payload.test, timestamp: message.payload.timestamp },
      });
      break;
    }
    default: {
      const _exhaustive: never = message;
      throw new Error(`unhandled message type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

export function deactivate(): void {
  probePanel?.dispose();
}
