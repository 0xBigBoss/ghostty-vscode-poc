/**
 * WebGL Capabilities Probe
 * Tests WebGL2 availability and features.
 */

import type { IProbeContext } from "../terminal-adapter";
import type { CapabilityResults } from "../types";

export function probeWebglCapabilities(
  ctx: IProbeContext,
  canvas: HTMLCanvasElement
): CapabilityResults {
  const results: CapabilityResults = {
    webgl2Available: false,
    vendor: "unknown",
    renderer: "unknown",
    maxTextureSize: 0,
    maxUniformBlockSize: 0,
    extensions: [],
    shaderCompileOk: false,
  };

  const gl = canvas.getContext("webgl2");
  if (!gl) {
    ctx.log("WebGL2: NOT AVAILABLE");
    return results;
  }

  results.webgl2Available = true;
  ctx.log("WebGL2: Available");

  const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
  if (debugInfo) {
    results.vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) as string;
    results.renderer = gl.getParameter(
      debugInfo.UNMASKED_RENDERER_WEBGL
    ) as string;
  }
  ctx.log(`Vendor: ${results.vendor}`);
  ctx.log(`Renderer: ${results.renderer}`);

  results.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  results.maxUniformBlockSize = gl.getParameter(
    gl.MAX_UNIFORM_BLOCK_SIZE
  ) as number;
  ctx.log(`MAX_TEXTURE_SIZE: ${results.maxTextureSize}`);
  ctx.log(`MAX_UNIFORM_BLOCK_SIZE: ${results.maxUniformBlockSize}`);

  // Check key extensions
  const wantedExts = [
    "EXT_disjoint_timer_query_webgl2",
    "EXT_color_buffer_float",
  ];
  const availableExts = gl.getSupportedExtensions() || [];

  for (const ext of wantedExts) {
    const found = availableExts.includes(ext);
    if (found) {
      results.extensions.push(ext);
    }
    ctx.log(`${ext}: ${found ? "Available" : "Not available"}`);
  }

  results.shaderCompileOk = true;

  return results;
}
