/**
 * Throughput test data generators.
 * Produces workloads for benchmarking terminal write performance.
 */

import type { GeneratedData } from "./types";

/** Target chunk size per spec (4KB) */
export const CHUNK_SIZE = 4096;

/** Default throughput target (30 MiB/s) */
export const TARGET_THROUGHPUT_MIBS = 30;

/** Default workload size per spec (10 MiB) */
export const SPEC_SIZE_MIB = 10;

/**
 * Generate plain ASCII text for throughput testing.
 * Produces exactly CHUNK_SIZE bytes per chunk.
 */
export function generatePlainText(sizeMiB: number): GeneratedData {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ";
  const targetBytes = sizeMiB * 1024 * 1024;
  const chunks: string[] = [];
  let totalBytes = 0;

  while (totalBytes < targetBytes) {
    let chunk = "";
    for (let i = 0; i < CHUNK_SIZE; i++) {
      chunk += chars[Math.floor(Math.random() * chars.length)];
    }
    chunks.push(chunk);
    totalBytes += chunk.length;
  }

  return { chunks, totalBytes };
}

/**
 * Generate SGR-heavy (color-changing) data.
 * Each unit: color code (5 bytes) + "Text" (4 bytes) = 9 bytes.
 * Builds complete units to avoid splitting escape sequences.
 */
export function generateSgrHeavy(sizeMiB: number): GeneratedData {
  const colors = [
    "\x1b[31m", // red
    "\x1b[32m", // green
    "\x1b[33m", // yellow
    "\x1b[34m", // blue
    "\x1b[35m", // magenta
    "\x1b[36m", // cyan
    "\x1b[0m",  // reset
  ];
  const targetBytes = sizeMiB * 1024 * 1024;
  const chunks: string[] = [];
  let totalBytes = 0;
  const UNIT_SIZE = 9; // color (5) + "Text" (4)
  const UNITS_PER_CHUNK = Math.floor(CHUNK_SIZE / UNIT_SIZE);

  while (totalBytes < targetBytes) {
    let chunk = "";
    for (let i = 0; i < UNITS_PER_CHUNK; i++) {
      chunk += colors[i % colors.length] + "Text";
    }
    chunks.push(chunk);
    totalBytes += chunk.length;
  }

  return { chunks, totalBytes };
}

/**
 * Generate cursor-movement-heavy data.
 * Each unit: ESC[rr;ccHX ESC[K = ~12 bytes max.
 * Builds complete units to avoid splitting escape sequences.
 */
export function generateCursorHeavy(sizeMiB: number): GeneratedData {
  const targetBytes = sizeMiB * 1024 * 1024;
  const chunks: string[] = [];
  let totalBytes = 0;
  const UNITS_PER_CHUNK = 300; // ~12 bytes each = ~3.6KB per chunk

  while (totalBytes < targetBytes) {
    let chunk = "";
    for (let i = 0; i < UNITS_PER_CHUNK; i++) {
      const row = (i % 20) + 1;
      const col = (i % 60) + 1;
      chunk += `\x1b[${row};${col}HX\x1b[K`;
    }
    chunks.push(chunk);
    totalBytes += chunk.length;
  }

  return { chunks, totalBytes };
}
