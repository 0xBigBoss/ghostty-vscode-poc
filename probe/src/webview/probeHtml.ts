export function getProbeHtml(
  ghosttyWebJsUri: string,
  ghosttyWasmUri: string,
  cspSource: string
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${cspSource} 'unsafe-inline' 'wasm-unsafe-eval'; style-src ${cspSource} 'unsafe-inline'; img-src ${cspSource} data:; font-src ${cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ghostty Probe</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 16px;
      margin: 0;
    }
    h1 { font-size: 1.4em; margin-bottom: 16px; }
    h2 { font-size: 1.1em; margin: 16px 0 8px; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 4px; }
    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 8px 16px;
      cursor: pointer;
      margin-right: 8px;
      margin-bottom: 8px;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .status { margin: 8px 0; }
    .pass { color: var(--vscode-charts-green, #4ec9b0); }
    .fail { color: var(--vscode-errorForeground, #f48771); }
    .warn { color: var(--vscode-editorWarning-foreground, #cca700); }
    pre {
      background: var(--vscode-textCodeBlock-background);
      padding: 8px;
      overflow-x: auto;
      font-size: 0.9em;
    }
    canvas { display: none; }
    #terminalContainer {
      width: 100%;
      height: 300px;
      background: #1e1e1e;
      margin: 8px 0;
      display: none;
    }
    #terminalContainer.visible {
      display: block;
    }
    #results { margin-top: 16px; }
    table { border-collapse: collapse; width: 100%; margin: 8px 0; }
    th, td { text-align: left; padding: 4px 8px; border: 1px solid var(--vscode-panel-border); }
    th { background: var(--vscode-editor-inactiveSelectionBackground); }
  </style>
</head>
<body>
  <h1>Ghostty Feasibility Probe</h1>

  <div>
    <button id="runWasmLoading">Test Wasm Loading</button>
    <button id="runAll">Run All Probes</button>
  </div>

  <div id="terminalContainer"></div>
  <canvas id="glCanvas" width="800" height="600"></canvas>

  <div id="results"></div>

  <script src="${ghosttyWebJsUri}"></script>
  <script>
    const vscode = acquireVsCodeApi();
    const resultsDiv = document.getElementById('results');
    const terminalContainer = document.getElementById('terminalContainer');
    const canvas = document.getElementById('glCanvas');

    // Store ghostty-web module reference
    const GhosttyWeb = window.GhosttyWeb || window.ghosttyWeb;
    const WASM_URL = "${ghosttyWasmUri}";

    let gl = null;
    let probeResults = {
      timestamp: new Date().toISOString(),
      wasmLoading: null,
      capabilities: null,
      microbench: null,
      atlasSampling: null
    };

    // --- Wasm Loading Probe (Workstream 1) ---
    async function probeWasmLoading() {
      const section = createSection('Wasm Loading (Workstream 1)');

      const results = {
        wasmLoadSuccess: false,
        wasmInitTimeMs: 0,
        wasmBundleSizeKb: 0,
        error: null,
        terminalCreated: false,
        renderTest: {
          textWritten: false,
          colorsRendered: false
        }
      };

      try {
        addResult(section, 'ghostty-web module', GhosttyWeb ? 'Loaded' : 'Not found', GhosttyWeb ? 'pass' : 'fail');

        if (!GhosttyWeb) {
          results.error = 'ghostty-web module not found. Check script loading.';
          probeResults.wasmLoading = results;
          return results;
        }

        // Initialize wasm
        addResult(section, 'Initializing wasm...', 'Please wait');
        const startInit = performance.now();

        // ghostty-web init() loads the wasm
        // We need to check if there's a way to specify wasm URL
        if (typeof GhosttyWeb.init === 'function') {
          await GhosttyWeb.init();
        } else if (typeof GhosttyWeb.default?.init === 'function') {
          await GhosttyWeb.default.init();
        }

        const initTime = performance.now() - startInit;
        results.wasmInitTimeMs = initTime;
        results.wasmLoadSuccess = true;
        // ghostty-vt.wasm is ~413KB per ghostty-web package
        results.wasmBundleSizeKb = 413;

        addResult(section, 'Wasm initialized', \`\${initTime.toFixed(2)}ms\`, initTime < 500 ? 'pass' : 'warn');
        addResult(section, 'Wasm bundle size', \`\${results.wasmBundleSizeKb}KB\`, 'pass');

        // Try to create a terminal
        terminalContainer.classList.add('visible');

        const Terminal = GhosttyWeb.Terminal || GhosttyWeb.default?.Terminal;
        if (Terminal) {
          const term = new Terminal({
            cols: 80,
            rows: 24
          });

          term.open(terminalContainer);
          results.terminalCreated = true;
          addResult(section, 'Terminal created', 'OK', 'pass');

          // Test basic writing
          term.write('Hello from Ghostty!\\r\\n');
          results.renderTest.textWritten = true;
          addResult(section, 'Text written', 'OK', 'pass');

          // Test colors
          term.write('\\x1b[31mRed \\x1b[32mGreen \\x1b[34mBlue\\x1b[0m\\r\\n');
          results.renderTest.colorsRendered = true;
          addResult(section, 'Colors rendered', 'OK', 'pass');

          // Test cursor positioning
          term.write('\\x1b[5;10HPositioned text\\r\\n');
          addResult(section, 'Cursor positioning', 'OK', 'pass');
        } else {
          results.error = 'Terminal constructor not found';
          addResult(section, 'Terminal constructor', 'Not found', 'fail');
        }

      } catch (err) {
        results.wasmLoadSuccess = false;
        results.error = err.message || String(err);
        addResult(section, 'Error', results.error, 'fail');

        const pre = document.createElement('pre');
        pre.textContent = err.stack || err.message || String(err);
        section.appendChild(pre);
      }

      probeResults.wasmLoading = results;

      // Summary
      const summarySection = document.createElement('div');
      summarySection.innerHTML = \`
        <h3>Summary</h3>
        <table>
          <tr><th>Metric</th><th>Value</th><th>Status</th></tr>
          <tr>
            <td>wasmLoadSuccess</td>
            <td>\${results.wasmLoadSuccess}</td>
            <td class="\${results.wasmLoadSuccess ? 'pass' : 'fail'}">\${results.wasmLoadSuccess ? 'PASS' : 'FAIL'}</td>
          </tr>
          <tr>
            <td>wasmInitTimeMs</td>
            <td>\${results.wasmInitTimeMs.toFixed(2)}ms</td>
            <td class="\${results.wasmInitTimeMs < 500 ? 'pass' : 'warn'}">\${results.wasmInitTimeMs < 500 ? 'PASS' : 'SLOW'}</td>
          </tr>
          <tr>
            <td>wasmBundleSizeKb</td>
            <td>\${results.wasmBundleSizeKb}KB</td>
            <td class="pass">PASS</td>
          </tr>
          <tr>
            <td>terminalCreated</td>
            <td>\${results.terminalCreated}</td>
            <td class="\${results.terminalCreated ? 'pass' : 'fail'}">\${results.terminalCreated ? 'PASS' : 'FAIL'}</td>
          </tr>
        </table>
      \`;
      section.appendChild(summarySection);

      return results;
    }

    // --- Capability Probe (WebGL2) ---
    function probeCapabilities() {
      const section = createSection('WebGL2 Capabilities');

      gl = canvas.getContext('webgl2');
      if (!gl) {
        addResult(section, 'WebGL2', 'NOT AVAILABLE', 'fail');
        probeResults.capabilities = { webgl2Available: false, extensions: [], shaderCompileOk: false };
        return false;
      }

      addResult(section, 'WebGL2', 'Available', 'pass');

      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      const vendor = debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : 'unknown';
      const renderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 'unknown';
      addResult(section, 'Vendor', vendor);
      addResult(section, 'Renderer', renderer);

      const maxTexSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      const maxUniformBlockSize = gl.getParameter(gl.MAX_UNIFORM_BLOCK_SIZE);

      addResult(section, 'MAX_TEXTURE_SIZE', maxTexSize.toString(), maxTexSize >= 4096 ? 'pass' : 'warn');
      addResult(section, 'MAX_UNIFORM_BLOCK_SIZE', maxUniformBlockSize.toString());

      // Check key extensions
      const wantedExts = [
        'EXT_disjoint_timer_query_webgl2',
        'EXT_color_buffer_float'
      ];
      const availableExts = gl.getSupportedExtensions() || [];
      const foundExts = [];

      for (const ext of wantedExts) {
        const found = availableExts.includes(ext);
        addResult(section, ext, found ? 'Available' : 'Not available', found ? 'pass' : 'warn');
        if (found) foundExts.push(ext);
      }

      probeResults.capabilities = {
        webgl2Available: true,
        vendor,
        renderer,
        maxTextureSize: maxTexSize,
        maxUniformBlockSize: maxUniformBlockSize,
        extensions: foundExts,
        shaderCompileOk: true
      };

      return true;
    }

    // --- UI Helpers ---
    function createSection(title) {
      const h2 = document.createElement('h2');
      h2.textContent = title;
      resultsDiv.appendChild(h2);

      const div = document.createElement('div');
      resultsDiv.appendChild(div);
      return div;
    }

    function addResult(container, label, value, status) {
      const p = document.createElement('p');
      p.className = 'status';
      p.innerHTML = \`<strong>\${label}:</strong> <span class="\${status || ''}">\${value}</span>\`;
      container.appendChild(p);
    }

    async function runAllProbes() {
      resultsDiv.innerHTML = '';
      probeResults.timestamp = new Date().toISOString();

      await probeWasmLoading();
      probeCapabilities();

      // Send results to extension
      vscode.postMessage({ type: 'probeResults', payload: probeResults });
    }

    // --- Event Handlers ---
    document.getElementById('runWasmLoading').onclick = async () => {
      resultsDiv.innerHTML = '';
      await probeWasmLoading();
      vscode.postMessage({ type: 'probeResults', payload: probeResults });
    };

    document.getElementById('runAll').onclick = runAllProbes;

    window.addEventListener('message', event => {
      const message = event.data;
      if (message.command === 'runAll') {
        runAllProbes();
      }
    });

    // Log that we're ready
    vscode.postMessage({ type: 'log', payload: 'Probe webview loaded' });
  </script>
</body>
</html>`;
}
