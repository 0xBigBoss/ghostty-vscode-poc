import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import type { ProbeResults, ProbeMessage } from "./lib/types";

let probePanel: vscode.WebviewPanel | undefined;
let lastProbeResults: ProbeResults | undefined;
let probeResultsPromiseResolve: ((results: ProbeResults) => void) | undefined;

// Matrix demo state
interface MatrixMetrics {
  mibPerSec: number;
  fps: number;
  charsPerSec: number;
  framesRendered: number;
}
let lastMatrixMetrics: MatrixMetrics | null = null;
let matrixMetricsPromiseResolve: ((metrics: MatrixMetrics | null) => void) | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const showPanelCommand = vscode.commands.registerCommand(
    "ghostty-probe.showPanel",
    () => showProbePanel(context)
  );

  const runAllCommand = vscode.commands.registerCommand(
    "ghostty-probe.runAll",
    () => {
      // Clear previous results so waitForResults blocks until new results arrive
      lastProbeResults = undefined;
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

  // Matrix demo commands
  const startMatrixDemoCommand = vscode.commands.registerCommand(
    "ghostty-probe.startMatrixDemo",
    () => {
      if (!probePanel) {
        showProbePanel(context);
      }
      probePanel?.webview.postMessage({ command: "startMatrixDemo" });
    }
  );

  const stopMatrixDemoCommand = vscode.commands.registerCommand(
    "ghostty-probe.stopMatrixDemo",
    () => {
      probePanel?.webview.postMessage({ command: "stopMatrixDemo" });
    }
  );

  const getMatrixMetricsCommand = vscode.commands.registerCommand(
    "ghostty-probe.getMatrixMetrics",
    (timeoutMs: number = 5000) => {
      return new Promise<MatrixMetrics | null>((resolve, _reject) => {
        // Request metrics from webview
        probePanel?.webview.postMessage({ command: "getMatrixMetrics" });

        // Set up resolver for when metrics come in
        matrixMetricsPromiseResolve = resolve;

        // Timeout
        setTimeout(() => {
          if (matrixMetricsPromiseResolve === resolve) {
            matrixMetricsPromiseResolve = undefined;
            // Return last known metrics or null
            resolve(lastMatrixMetrics);
          }
        }, timeoutMs);
      });
    }
  );

  context.subscriptions.push(
    showPanelCommand,
    runAllCommand,
    getResultsCommand,
    waitForResultsCommand,
    startMatrixDemoCommand,
    stopMatrixDemoCommand,
    getMatrixMetricsCommand
  );
}

function showProbePanel(context: vscode.ExtensionContext): void {
  if (probePanel) {
    probePanel.reveal(vscode.ViewColumn.One);
    return;
  }

  // Get paths to resources
  const ghosttyWebPath = path.join(
    context.extensionPath,
    "node_modules",
    "ghostty-web",
    "dist"
  );
  const webviewPath = path.join(context.extensionPath, "out", "webview");

  probePanel = vscode.window.createWebviewPanel(
    "ghosttyProbe",
    "Ghostty Probe",
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.file(ghosttyWebPath),
        vscode.Uri.file(webviewPath),
        vscode.Uri.file(path.join(context.extensionPath, "node_modules")),
      ],
    }
  );

  // Create URIs for resources
  const ghosttyWebJsUri = probePanel.webview.asWebviewUri(
    vscode.Uri.file(path.join(ghosttyWebPath, "ghostty-web.umd.cjs"))
  );
  const ghosttyWasmUri = probePanel.webview.asWebviewUri(
    vscode.Uri.file(path.join(ghosttyWebPath, "ghostty-vt.wasm"))
  );
  const mainJsUri = probePanel.webview.asWebviewUri(
    vscode.Uri.file(path.join(webviewPath, "main.js"))
  );
  const stylesUri = probePanel.webview.asWebviewUri(
    vscode.Uri.file(path.join(webviewPath, "styles.css"))
  );

  // Load and process HTML template
  const templatePath = path.join(webviewPath, "template.html");
  let html = fs.readFileSync(templatePath, "utf8");

  // Replace template placeholders
  html = html
    .replace(/\{\{cspSource\}\}/g, probePanel.webview.cspSource)
    .replace(/\{\{ghosttyWebJsUri\}\}/g, ghosttyWebJsUri.toString())
    .replace(/\{\{mainJsUri\}\}/g, mainJsUri.toString())
    .replace(/\{\{stylesUri\}\}/g, stylesUri.toString())
    .replace(/\{\{wasmUri\}\}/g, ghosttyWasmUri.toString());

  probePanel.webview.html = html;

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
    case "matrixMetrics": {
      // Store metrics
      lastMatrixMetrics = message.payload;
      // Resolve any waiting promises
      if (matrixMetricsPromiseResolve) {
        matrixMetricsPromiseResolve(message.payload);
        matrixMetricsPromiseResolve = undefined;
      }
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
