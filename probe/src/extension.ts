import * as vscode from "vscode";
import { getProbeHtml } from "./webview/probeHtml";

let probePanel: vscode.WebviewPanel | undefined;

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

  context.subscriptions.push(showPanelCommand, runAllCommand);
}

function showProbePanel(context: vscode.ExtensionContext): void {
  if (probePanel) {
    probePanel.reveal(vscode.ViewColumn.One);
    return;
  }

  probePanel = vscode.window.createWebviewPanel(
    "ghosttyProbe",
    "Ghostty WebGL Probe",
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    }
  );

  probePanel.webview.html = getProbeHtml();

  probePanel.webview.onDidReceiveMessage(
    (message: ProbeMessage) => handleProbeMessage(message, context),
    undefined,
    context.subscriptions
  );

  probePanel.onDidDispose(() => {
    probePanel = undefined;
  });
}

type ProbeMessage =
  | { type: "probeResults"; payload: ProbeResults }
  | { type: "log"; payload: string };

type ProbeResults = {
  timestamp: string;
  capabilities: CapabilityResults;
  microbench?: MicrobenchResults;
  atlasSampling?: AtlasSamplingResults;
};

type CapabilityResults = {
  webgl2Available: boolean;
  vendor?: string;
  renderer?: string;
  maxTextureSize?: number;
  maxUniformBlockSize?: number;
  extensions: string[];
  shaderCompileOk: boolean;
  shaderErrors?: string[];
};

type MicrobenchResults = {
  gridSize: { cols: number; rows: number };
  iterations: number;
  encodeMs: { median: number; p95: number };
  submitMs: { median: number; p95: number };
  waitMs: { median: number; p95: number };
};

type AtlasSamplingResults = {
  texelFetchOk: boolean;
  normalizedOk: boolean;
  bleedingDetected: boolean;
  notes: string[];
};

async function handleProbeMessage(
  message: ProbeMessage,
  _context: vscode.ExtensionContext
): Promise<void> {
  switch (message.type) {
    case "probeResults": {
      const outputChannel = vscode.window.createOutputChannel("Ghostty Probe");
      outputChannel.appendLine(JSON.stringify(message.payload, null, 2));
      outputChannel.show();

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const fileName = `probe-results-${timestamp}.json`;
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;

      if (workspaceRoot) {
        const artifactsUri = vscode.Uri.joinPath(
          workspaceRoot,
          "artifacts",
          fileName
        );
        const content = Buffer.from(
          JSON.stringify(message.payload, null, 2),
          "utf-8"
        );
        await vscode.workspace.fs.writeFile(artifactsUri, content);
        vscode.window.showInformationMessage(`Probe results saved: ${fileName}`);
      }
      break;
    }
    case "log":
      console.log("[Probe]", message.payload);
      break;
    default: {
      const _exhaustive: never = message;
      throw new Error(`unhandled message type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

export function deactivate(): void {
  probePanel?.dispose();
}
