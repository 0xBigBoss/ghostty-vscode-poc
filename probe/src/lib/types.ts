/**
 * Shared type definitions for the ghostty-vscode probe extension.
 * These types are used across the extension, webview, and tests.
 */

// ============================================================================
// Probe Result Types
// ============================================================================

export type ProbeResults = {
  timestamp: string;
  wasmLoading?: WasmLoadingResults;
  rendering?: RenderingResults;
  inputHandling?: InputHandlingResults;
  apiCompatibility?: ApiCompatibilityResults;
  throughput?: ThroughputResults;
  vsCodeIntegration?: VsCodeIntegrationResults;
  capabilities?: CapabilityResults;
  microbench?: MicrobenchResults;
  atlasSampling?: AtlasSamplingResults;
};

export type WasmLoadingResults = {
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

export type RenderingResults = {
  textRendersCorrectly: boolean;
  colorsWork: boolean;
  cursorPositioningWorks: boolean;
  bufferAccessWorks: boolean;
};

export type InputHandlingResults = {
  onDataCallbackWorks: boolean;
  standardTypingWorks: boolean;
  arrowKeysWork: boolean;
  ctrlCWorks: boolean;
  capturedInputs: Array<{ data: string; codes: number[] }>;
};

export type ApiCompatibilityResults = {
  coreAPIsPresent: string[];
  missingAPIs: string[];
  bufferAccessWorks: boolean;
  fitAddonWorks: boolean;
  selectionAPIsWork: boolean;
};

export type ThroughputResults = {
  plainTextThroughputMiBs: number;
  sgrHeavyThroughputMiBs: number;
  cursorHeavyThroughputMiBs: number;
  sgrRatio: number;
  peakMemoryMb: number;
  memoryStableAfterRuns: boolean;
  passesThreshold: boolean;
};

export type VsCodeIntegrationResults = {
  messagingWorks: boolean;
  resizeWorks: boolean;
  themeIntegrationWorks: boolean;
  focusManagementWorks: boolean;
};

export type CapabilityResults = {
  webgl2Available: boolean;
  vendor?: string;
  renderer?: string;
  maxTextureSize?: number;
  maxUniformBlockSize?: number;
  extensions: string[];
  shaderCompileOk: boolean;
  shaderErrors?: string[];
};

export type MicrobenchResults = {
  gridSize: { cols: number; rows: number };
  iterations: number;
  encodeMs: { median: number; p95: number };
  submitMs: { median: number; p95: number };
  waitMs: { median: number; p95: number };
};

export type AtlasSamplingResults = {
  texelFetchOk: boolean;
  normalizedOk: boolean;
  bleedingDetected: boolean;
  notes: string[];
};

// ============================================================================
// Message Types (Extension <-> Webview)
// ============================================================================

export type MatrixMetricsPayload = {
  mibPerSec: number;
  fps: number;
  charsPerSec: number;
  framesRendered: number;
} | null;

export type ProbeMessage =
  | { type: "probeResults"; payload: ProbeResults }
  | { type: "log"; payload: string }
  | { type: "integrationTest"; payload: { test: string; timestamp: number } }
  | { type: "matrixMetrics"; payload: MatrixMetricsPayload };

export type ExtensionMessage =
  | { command: "runAll" }
  | { command: "startMatrixDemo" }
  | { command: "stopMatrixDemo" }
  | { command: "getMatrixMetrics" }
  | { type: "integrationTestResponse"; payload: { echo: string; timestamp: number } };

// ============================================================================
// Data Generator Types
// ============================================================================

export type GeneratedData = {
  chunks: string[];
  totalBytes: number;
};
