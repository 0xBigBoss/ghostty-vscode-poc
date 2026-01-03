/**
 * Webview main entry point.
 * This is bundled by esbuild and loaded in the VS Code webview.
 */

import type { ProbeResults, ProbeMessage, ExtensionMessage } from "../lib/types";
import type { IProbeContext, ITerminalLike } from "../lib/terminal-adapter";
import {
  probeWasmLoading,
  probeRendering,
  probeInputHandling,
  probeThroughput,
  probeVsCodeIntegration,
  probeApiCompatibility,
  probeWebglCapabilities,
} from "../lib/probes";
import { MatrixRain } from "../lib/demos";

// Declare VS Code API
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

// Initialize VS Code API
const vscode = acquireVsCodeApi();

// DOM elements
const resultsDiv = document.getElementById("results")!;
const terminalContainer = document.getElementById("terminalContainer")!;
const canvas = document.getElementById("glCanvas") as HTMLCanvasElement;

// Get wasm URL from data attribute on body
const WASM_URL = document.body.dataset.wasmUrl || "";

// Store probe results
const probeResults: ProbeResults = {
  timestamp: new Date().toISOString(),
  wasmLoading: undefined,
  rendering: undefined,
  inputHandling: undefined,
  apiCompatibility: undefined,
  throughput: undefined,
  vsCodeIntegration: undefined,
  capabilities: undefined,
};

// Store terminal instance
let terminalInstance: ITerminalLike | null = null;

// Matrix demo state
let matrixRain: MatrixRain | null = null;
let metricsUpdateInterval: number | null = null;

// Create probe context
function createContext(): IProbeContext {
  return {
    terminal: terminalInstance,
    log: (msg: string) => {
      console.log(`[Probe] ${msg}`);
      vscode.postMessage({ type: "log", payload: msg } as ProbeMessage);
    },
    getMemory: () => {
      const perf = performance as unknown as { memory?: { usedJSHeapSize: number } };
      if (perf.memory) {
        return perf.memory.usedJSHeapSize / (1024 * 1024);
      }
      return 0;
    },
  };
}

// UI Helpers
function createSection(title: string): HTMLElement {
  const h2 = document.createElement("h2");
  h2.textContent = title;
  resultsDiv.appendChild(h2);

  const div = document.createElement("div");
  resultsDiv.appendChild(div);
  return div;
}

function addResult(
  container: HTMLElement,
  label: string,
  value: string,
  status?: "pass" | "fail" | "warn"
): void {
  const p = document.createElement("p");
  p.className = "status";
  p.innerHTML = `<strong>${label}:</strong> <span class="${status || ""}">${value}</span>`;
  container.appendChild(p);
}

// --- Probe Runners ---

async function runWasmLoadingProbe(): Promise<void> {
  const section = createSection("Wasm Loading (Workstream 1)");
  const ctx = createContext();

  terminalContainer.classList.add("visible");
  const results = await probeWasmLoading(ctx, WASM_URL, terminalContainer);

  // Update terminal instance from context
  terminalInstance = ctx.terminal;

  // Enable matrix demo controls if terminal loaded
  if (terminalInstance) {
    enableMatrixControls();
  }

  // Display results
  addResult(section, "Wasm loaded", results.wasmLoadSuccess ? "Yes" : "No", results.wasmLoadSuccess ? "pass" : "fail");
  addResult(section, "Init time", `${results.wasmInitTimeMs.toFixed(2)}ms`, results.wasmInitTimeMs < 500 ? "pass" : "warn");
  addResult(section, "Bundle size", `${results.wasmBundleSizeKb}KB`, "pass");
  addResult(section, "Terminal created", results.terminalCreated ? "Yes" : "No", results.terminalCreated ? "pass" : "fail");

  if (results.error) {
    addResult(section, "Error", results.error, "fail");
  }

  probeResults.wasmLoading = results;
}

function runRenderingProbe(): void {
  const section = createSection("Basic Rendering (Workstream 2)");
  const ctx = createContext();

  const results = probeRendering(ctx);

  addResult(section, "Text renders", results.textRendersCorrectly ? "Yes" : "No", results.textRendersCorrectly ? "pass" : "fail");
  addResult(section, "Colors work", results.colorsWork ? "Yes" : "No", results.colorsWork ? "pass" : "fail");
  addResult(section, "Cursor positioning", results.cursorPositioningWorks ? "Yes" : "No", results.cursorPositioningWorks ? "pass" : "fail");
  addResult(section, "Buffer access", results.bufferAccessWorks ? "Yes" : "No", results.bufferAccessWorks ? "pass" : "warn");

  probeResults.rendering = results;
}

function runInputHandlingProbe(): void {
  const section = createSection("Input Handling (Workstream 3)");
  const ctx = createContext();

  const results = probeInputHandling(ctx);

  addResult(section, "onData callback", results.onDataCallbackWorks ? "Yes" : "No", results.onDataCallbackWorks ? "pass" : "fail");
  addResult(section, "Standard typing", results.standardTypingWorks ? "Yes" : "No", results.standardTypingWorks ? "pass" : "warn");
  addResult(section, "Arrow keys", results.arrowKeysWork ? "Yes" : "No", results.arrowKeysWork ? "pass" : "warn");
  addResult(section, "Ctrl+C", results.ctrlCWorks ? "Yes" : "No", results.ctrlCWorks ? "pass" : "warn");

  probeResults.inputHandling = results;
}

async function runThroughputProbe(): Promise<void> {
  const section = createSection("Throughput Benchmark (Workstream 4)");
  const ctx = createContext();

  const results = await probeThroughput(ctx, terminalContainer);

  addResult(section, "Plain text", `${results.plainTextThroughputMiBs} MiB/s`, results.passesThreshold ? "pass" : "fail");
  addResult(section, "SGR-heavy", `${results.sgrHeavyThroughputMiBs} MiB/s`, "pass");
  addResult(section, "Cursor-heavy", `${results.cursorHeavyThroughputMiBs} MiB/s`, "pass");
  addResult(section, "SGR ratio", `${results.sgrRatio}x`, results.sgrRatio <= 2 ? "pass" : "warn");
  addResult(section, "Memory stable", results.memoryStableAfterRuns ? "Yes" : "No", results.memoryStableAfterRuns ? "pass" : "warn");

  probeResults.throughput = results;
}

async function runVsCodeIntegrationProbe(): Promise<void> {
  const section = createSection("VS Code Integration (Workstream 5)");
  const ctx = createContext();

  const results = await probeVsCodeIntegration(ctx, vscode);

  addResult(section, "Messaging", results.messagingWorks ? "Yes" : "No", results.messagingWorks ? "pass" : "fail");
  addResult(section, "Resize", results.resizeWorks ? "Yes" : "No", results.resizeWorks ? "pass" : "fail");
  addResult(section, "Theme integration", results.themeIntegrationWorks ? "Yes" : "No", results.themeIntegrationWorks ? "pass" : "warn");
  addResult(section, "Focus management", results.focusManagementWorks ? "Yes" : "No", results.focusManagementWorks ? "pass" : "fail");

  probeResults.vsCodeIntegration = results;
}

function runApiCompatibilityProbe(): void {
  const section = createSection("xterm.js API Compatibility (Workstream 6)");
  const ctx = createContext();

  const results = probeApiCompatibility(ctx);

  const total = results.coreAPIsPresent.length + results.missingAPIs.length;
  const coverage = Math.round((results.coreAPIsPresent.length / total) * 100);

  addResult(section, "API Coverage", `${results.coreAPIsPresent.length}/${total} (${coverage}%)`, coverage >= 90 ? "pass" : coverage >= 70 ? "warn" : "fail");
  addResult(section, "Buffer access", results.bufferAccessWorks ? "Yes" : "No", results.bufferAccessWorks ? "pass" : "warn");
  addResult(section, "FitAddon", results.fitAddonWorks ? "Yes" : "No", results.fitAddonWorks ? "pass" : "warn");
  addResult(section, "Selection APIs", results.selectionAPIsWork ? "Yes" : "No", results.selectionAPIsWork ? "pass" : "warn");

  if (results.missingAPIs.length > 0) {
    addResult(section, "Missing APIs", results.missingAPIs.join(", "), "warn");
  }

  probeResults.apiCompatibility = results;
}

function runCapabilitiesProbe(): void {
  const section = createSection("WebGL2 Capabilities");
  const ctx = createContext();

  const results = probeWebglCapabilities(ctx, canvas);

  addResult(section, "WebGL2", results.webgl2Available ? "Available" : "Not available", results.webgl2Available ? "pass" : "fail");
  addResult(section, "Vendor", results.vendor || "unknown");
  addResult(section, "Renderer", results.renderer || "unknown");
  addResult(section, "MAX_TEXTURE_SIZE", (results.maxTextureSize || 0).toString(), (results.maxTextureSize || 0) >= 4096 ? "pass" : "warn");

  probeResults.capabilities = results;
}

// Run all probes
async function runAllProbes(): Promise<void> {
  resultsDiv.innerHTML = "";
  probeResults.timestamp = new Date().toISOString();

  console.log("[Probe] Starting all probes...");

  await runWasmLoadingProbe();
  runRenderingProbe();
  runInputHandlingProbe();
  await runThroughputProbe();
  await runVsCodeIntegrationProbe();
  runApiCompatibilityProbe();
  runCapabilitiesProbe();

  console.log("[Probe] All probes complete!");
  vscode.postMessage({ type: "probeResults", payload: probeResults } as ProbeMessage);
}

// Event handlers
document.getElementById("runWasmLoading")?.addEventListener("click", async () => {
  resultsDiv.innerHTML = "";
  await runWasmLoadingProbe();
  vscode.postMessage({ type: "probeResults", payload: probeResults } as ProbeMessage);
});

document.getElementById("runAll")?.addEventListener("click", runAllProbes);

// --- Matrix Demo Controls ---

const matrixControls = document.getElementById("matrixControls");
const matrixMetrics = document.getElementById("matrixMetrics");
const matrixToggle = document.getElementById("matrixToggle");
const matrixSpeed = document.getElementById("matrixSpeed") as HTMLInputElement | null;
const speedLabel = document.getElementById("speedLabel");

function updateMatrixMetrics(): void {
  if (!matrixRain) return;

  const metrics = matrixRain.getMetrics();
  const mibEl = document.getElementById("metricMiB");
  const fpsEl = document.getElementById("metricFPS");
  const charsEl = document.getElementById("metricChars");

  if (mibEl) mibEl.textContent = metrics.mibPerSec.toFixed(1);
  if (fpsEl) fpsEl.textContent = metrics.fps.toString();
  if (charsEl) charsEl.textContent = formatNumber(metrics.charsPerSec);
}

function formatNumber(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return n.toString();
}

function startMatrixDemo(): void {
  if (!terminalInstance) {
    vscode.postMessage({ type: "log", payload: "Cannot start Matrix demo: terminal not initialized" } as ProbeMessage);
    return;
  }

  // Create and start the demo
  const speed = matrixSpeed ? parseInt(matrixSpeed.value, 10) : 5;
  matrixRain = new MatrixRain(terminalInstance, { speed, density: 0.4 });
  matrixRain.start();

  // Update UI
  if (matrixToggle) {
    matrixToggle.textContent = "Stop Matrix";
    matrixToggle.classList.add("running");
  }
  matrixMetrics?.classList.remove("hidden");
  terminalContainer.classList.add("matrix-mode");

  // Start metrics update
  metricsUpdateInterval = window.setInterval(updateMatrixMetrics, 100);

  vscode.postMessage({ type: "log", payload: "Matrix demo started" } as ProbeMessage);
}

function stopMatrixDemo(): void {
  if (matrixRain) {
    matrixRain.stop();
    matrixRain = null;
  }

  // Update UI
  if (matrixToggle) {
    matrixToggle.textContent = "Start Matrix";
    matrixToggle.classList.remove("running");
  }
  matrixMetrics?.classList.add("hidden");
  terminalContainer.classList.remove("matrix-mode");

  // Stop metrics update
  if (metricsUpdateInterval) {
    clearInterval(metricsUpdateInterval);
    metricsUpdateInterval = null;
  }

  vscode.postMessage({ type: "log", payload: "Matrix demo stopped" } as ProbeMessage);
}

function getMatrixMetrics(): { mibPerSec: number; fps: number; charsPerSec: number; framesRendered: number } | null {
  if (!matrixRain) return null;
  return matrixRain.getMetrics();
}

// Matrix toggle button
matrixToggle?.addEventListener("click", () => {
  if (matrixRain?.running) {
    stopMatrixDemo();
  } else {
    startMatrixDemo();
  }
});

// Speed slider
matrixSpeed?.addEventListener("input", () => {
  const speed = parseInt(matrixSpeed.value, 10);
  if (speedLabel) speedLabel.textContent = speed.toString();
  matrixRain?.setSpeed(speed);
});

// Show matrix controls after wasm loads
function enableMatrixControls(): void {
  matrixControls?.classList.remove("hidden");
}

// Message handler for extension commands
window.addEventListener("message", (event) => {
  const message = event.data as ExtensionMessage;

  if ("command" in message) {
    switch (message.command) {
      case "runAll":
        runAllProbes();
        break;
      case "startMatrixDemo":
        startMatrixDemo();
        break;
      case "stopMatrixDemo":
        stopMatrixDemo();
        break;
      case "getMatrixMetrics":
        vscode.postMessage({
          type: "matrixMetrics",
          payload: getMatrixMetrics(),
        });
        break;
    }
  }
});

// Log ready
vscode.postMessage({ type: "log", payload: "Probe webview loaded" } as ProbeMessage);
