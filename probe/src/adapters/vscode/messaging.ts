/**
 * VS Code webview messaging bridge.
 * Handles communication between the webview and extension.
 */

import type { ProbeMessage, ExtensionMessage } from "../../lib/types";

// VS Code API is provided globally in the webview
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

let vscode: ReturnType<typeof acquireVsCodeApi> | null = null;

/**
 * Initialize the VS Code API.
 * Must be called before using other messaging functions.
 */
export function initMessaging(): void {
  if (typeof acquireVsCodeApi !== "undefined") {
    vscode = acquireVsCodeApi();
  }
}

/**
 * Send a message to the extension.
 */
export function sendMessage(message: ProbeMessage): void {
  if (vscode) {
    vscode.postMessage(message);
  } else {
    console.warn("[Messaging] VS Code API not available");
  }
}

/**
 * Log a message to the extension console.
 */
export function log(message: string): void {
  sendMessage({ type: "log", payload: message });
}

/**
 * Register a handler for messages from the extension.
 */
export function onMessage(handler: (message: ExtensionMessage) => void): void {
  window.addEventListener("message", (event) => {
    handler(event.data as ExtensionMessage);
  });
}
