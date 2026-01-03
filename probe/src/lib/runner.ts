/**
 * Probe runner orchestration.
 *
 * Note: Currently the probe execution is handled in the webview adapter.
 * This module provides the runner interface for future CLI/browser adapters.
 */

import type { ProbeResults } from "./types";
import type { IProbeContext } from "./terminal-adapter";
import type { ProbeRegistry } from "./probes/types";

/**
 * Run all registered probes and collect results.
 */
export async function runAllProbes(
  ctx: IProbeContext,
  probes: ProbeRegistry
): Promise<ProbeResults> {
  const results: ProbeResults = {
    timestamp: new Date().toISOString(),
  };

  if (probes.wasmLoading) {
    try {
      results.wasmLoading = await probes.wasmLoading(ctx);
    } catch (error) {
      ctx.log(`Wasm loading probe failed: ${error}`);
    }
  }

  if (probes.rendering && ctx.terminal) {
    try {
      results.rendering = await probes.rendering(ctx);
    } catch (error) {
      ctx.log(`Rendering probe failed: ${error}`);
    }
  }

  if (probes.inputHandling && ctx.terminal) {
    try {
      results.inputHandling = await probes.inputHandling(ctx);
    } catch (error) {
      ctx.log(`Input handling probe failed: ${error}`);
    }
  }

  if (probes.throughput && ctx.terminal) {
    try {
      results.throughput = await probes.throughput(ctx);
    } catch (error) {
      ctx.log(`Throughput probe failed: ${error}`);
    }
  }

  if (probes.apiCompatibility && ctx.terminal) {
    try {
      results.apiCompatibility = await probes.apiCompatibility(ctx);
    } catch (error) {
      ctx.log(`API compatibility probe failed: ${error}`);
    }
  }

  if (probes.vsCodeIntegration) {
    try {
      results.vsCodeIntegration = await probes.vsCodeIntegration(ctx);
    } catch (error) {
      ctx.log(`VS Code integration probe failed: ${error}`);
    }
  }

  if (probes.capabilities) {
    try {
      results.capabilities = await probes.capabilities(ctx);
    } catch (error) {
      ctx.log(`Capabilities probe failed: ${error}`);
    }
  }

  return results;
}

/**
 * Run a single probe by name.
 */
export async function runProbe<K extends keyof ProbeRegistry>(
  ctx: IProbeContext,
  probeName: K,
  probe: NonNullable<ProbeRegistry[K]>
): Promise<ProbeResults> {
  const results: ProbeResults = {
    timestamp: new Date().toISOString(),
  };

  try {
    const probeResult = await probe(ctx);
    (results as Record<string, unknown>)[probeName] = probeResult;
  } catch (error) {
    ctx.log(`Probe ${probeName} failed: ${error}`);
  }

  return results;
}
