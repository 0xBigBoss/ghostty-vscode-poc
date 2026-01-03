import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { TerminalManager } from './terminal-manager';

let manager: TerminalManager | undefined;

/** Resolve cwd: ensure it's a directory, fallback to workspace or home */
function resolveCwd(uri?: vscode.Uri): string | undefined {
  if (!uri?.fsPath) {
    // Use first workspace folder or undefined (PtyService uses home)
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  try {
    const stat = fs.statSync(uri.fsPath);
    if (stat.isDirectory()) {
      return uri.fsPath;
    }
    // If file, use its parent directory
    return path.dirname(uri.fsPath);
  } catch {
    // Path doesn't exist, fallback
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }
}

export function activate(context: vscode.ExtensionContext) {
  manager = new TerminalManager(context);
  context.subscriptions.push(manager);  // Auto-dispose on deactivate

  context.subscriptions.push(
    vscode.commands.registerCommand('ghostty.newTerminal', () =>
      manager!.createTerminal({ cwd: resolveCwd() })
    ),
    vscode.commands.registerCommand('ghostty.newTerminalHere', (uri?: vscode.Uri) =>
      manager!.createTerminal({ cwd: resolveCwd(uri) })
    )
  );
}

export function deactivate() {
  // manager.dispose() called automatically via subscriptions
}
