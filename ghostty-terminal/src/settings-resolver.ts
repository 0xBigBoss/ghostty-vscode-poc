import type { DisplaySettings } from './types/messages';

/**
 * Configuration getter interface for testing
 * Allows mocking of vscode.workspace.getConfiguration()
 */
export interface ConfigGetter {
  get<T>(section: string, key: string): T | undefined;
}

/**
 * Resolve display settings with priority chain: ghostty.* > editor.* > defaults
 * Extracted for testability
 */
export function resolveDisplaySettings(config: ConfigGetter): DisplaySettings {
  const fontFamily = config.get<string>('ghostty', 'fontFamily') ||
                     config.get<string>('editor', 'fontFamily') ||
                     'monospace';

  const fontSize = config.get<number>('ghostty', 'fontSize') ||
                   config.get<number>('editor', 'fontSize') ||
                   15;

  return { fontFamily, fontSize };
}
