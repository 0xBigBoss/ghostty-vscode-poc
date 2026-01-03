/**
 * Probe function type definitions.
 */

import type { IProbeContext } from "../terminal-adapter";
import type {
  WasmLoadingResults,
  RenderingResults,
  InputHandlingResults,
  ThroughputResults,
  VsCodeIntegrationResults,
  ApiCompatibilityResults,
  CapabilityResults,
} from "../types";

/** Base probe function signature */
export type ProbeFunction<T> = (ctx: IProbeContext) => Promise<T>;

/** Specific probe function types */
export type WasmLoadingProbe = ProbeFunction<WasmLoadingResults>;
export type RenderingProbe = ProbeFunction<RenderingResults>;
export type InputHandlingProbe = ProbeFunction<InputHandlingResults>;
export type ThroughputProbe = ProbeFunction<ThroughputResults>;
export type VsCodeIntegrationProbe = ProbeFunction<VsCodeIntegrationResults>;
export type ApiCompatibilityProbe = ProbeFunction<ApiCompatibilityResults>;
export type CapabilitiesProbe = ProbeFunction<CapabilityResults>;

/** All available probes */
export interface ProbeRegistry {
  wasmLoading?: WasmLoadingProbe;
  rendering?: RenderingProbe;
  inputHandling?: InputHandlingProbe;
  throughput?: ThroughputProbe;
  vsCodeIntegration?: VsCodeIntegrationProbe;
  apiCompatibility?: ApiCompatibilityProbe;
  capabilities?: CapabilitiesProbe;
}
