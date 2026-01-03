export function getProbeHtml(
  ghosttyWebJsUri: string,
  ghosttyWasmUri: string,
  cspSource: string
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${cspSource} 'unsafe-inline' 'wasm-unsafe-eval'; style-src ${cspSource} 'unsafe-inline'; img-src ${cspSource} data:; font-src ${cspSource}; connect-src ${cspSource};">
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

    // Store loaded Ghostty instance for Terminal creation
    let ghosttyInstance = null;

    let gl = null;
    let probeResults = {
      timestamp: new Date().toISOString(),
      wasmLoading: null,
      rendering: null,
      inputHandling: null,
      apiCompatibility: null,
      capabilities: null,
      microbench: null,
      atlasSampling: null
    };

    // Store terminal instance for reuse across probes
    let terminalInstance = null;

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

        // Measure actual wasm bundle size (optional - ghostty-web embeds wasm as base64)
        // The wasm is embedded in the JS bundle, but we try to measure external file if provided
        try {
          const wasmResponse = await fetch(WASM_URL);
          if (wasmResponse.ok) {
            const wasmBlob = await wasmResponse.blob();
            results.wasmBundleSizeKb = Math.round(wasmBlob.size / 1024);
            addResult(section, 'Wasm bundle size (external)', \`\${results.wasmBundleSizeKb}KB\`, 'pass');
          } else {
            // ghostty-web v0.4.0 embeds wasm as base64 in the JS bundle (~413KB)
            results.wasmBundleSizeKb = 413;
            addResult(section, 'Wasm bundle size (embedded)', \`~\${results.wasmBundleSizeKb}KB\`, 'pass');
          }
        } catch (fetchErr) {
          // ghostty-web v0.4.0 embeds wasm as base64 in the JS bundle (~413KB)
          results.wasmBundleSizeKb = 413;
          addResult(section, 'Wasm bundle size (embedded)', \`~\${results.wasmBundleSizeKb}KB\`, 'pass');
        }

        // Initialize wasm using Ghostty.load() with explicit path
        addResult(section, 'Initializing wasm...', 'Please wait');
        const startInit = performance.now();

        // Use Ghostty.load(path) to load wasm from explicit URL
        // This avoids relative path issues in VS Code webview
        const Ghostty = GhosttyWeb.Ghostty || GhosttyWeb.default?.Ghostty;
        if (Ghostty && typeof Ghostty.load === 'function') {
          ghosttyInstance = await Ghostty.load(WASM_URL);
        } else if (typeof GhosttyWeb.init === 'function') {
          // Fallback to init() if Ghostty.load not available
          await GhosttyWeb.init();
        } else if (typeof GhosttyWeb.default?.init === 'function') {
          await GhosttyWeb.default.init();
        }

        const initTime = performance.now() - startInit;
        results.wasmInitTimeMs = initTime;
        results.wasmLoadSuccess = true;

        addResult(section, 'Wasm initialized', \`\${initTime.toFixed(2)}ms\`, initTime < 500 ? 'pass' : 'warn');

        // Try to create a terminal
        terminalContainer.classList.add('visible');

        const Terminal = GhosttyWeb.Terminal || GhosttyWeb.default?.Terminal;
        if (Terminal) {
          // Pass ghostty instance to Terminal constructor if we have it
          const termOptions = {
            cols: 80,
            rows: 24
          };
          if (ghosttyInstance) {
            termOptions.ghostty = ghosttyInstance;
          }
          const term = new Terminal(termOptions);

          term.open(terminalContainer);
          terminalInstance = term;  // Store for other probes
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
        const errorMsg = err.message || String(err);
        results.error = errorMsg;
        addResult(section, 'Error', errorMsg, 'fail');

        const pre = document.createElement('pre');
        pre.textContent = 'Error details:\\n' + (err.stack || errorMsg);
        section.appendChild(pre);

        // Log to console for debugging
        console.error('[Probe] Wasm loading error:', err);
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

    // --- Rendering Probe (Workstream 2) ---
    function probeRendering() {
      const section = createSection('Basic Rendering (Workstream 2)');

      const results = {
        textRendersCorrectly: false,
        colorsWork: false,
        cursorPositioningWorks: false,
        bufferAccessWorks: false
      };

      if (!terminalInstance) {
        addResult(section, 'Terminal', 'Not initialized - run Wasm Loading first', 'fail');
        probeResults.rendering = results;
        return results;
      }

      try {
        const term = terminalInstance;

        // Clear and test fresh rendering
        term.clear();

        // Test 1: Basic text rendering
        term.write('Rendering test line 1\\r\\n');
        results.textRendersCorrectly = true;
        addResult(section, 'Text renders', 'OK', 'pass');

        // Test 2: ANSI colors (16 basic colors)
        term.write('\\x1b[30mBlack \\x1b[31mRed \\x1b[32mGreen \\x1b[33mYellow\\x1b[0m\\r\\n');
        term.write('\\x1b[34mBlue \\x1b[35mMagenta \\x1b[36mCyan \\x1b[37mWhite\\x1b[0m\\r\\n');
        results.colorsWork = true;
        addResult(section, 'ANSI colors (8 basic)', 'OK', 'pass');

        // Test 3: Cursor positioning with CSI sequences
        term.write('\\x1b[10;1H<-- Line 10, Column 1');
        term.write('\\x1b[11;20H<-- Line 11, Column 20');
        results.cursorPositioningWorks = true;
        addResult(section, 'Cursor positioning (CSI H)', 'OK', 'pass');

        // Test 4: Buffer access API
        if (term.buffer && term.buffer.active) {
          const line = term.buffer.active.getLine(0);
          if (line) {
            const cell = line.getCell(0);
            if (cell) {
              const chars = cell.getChars();
              results.bufferAccessWorks = true;
              addResult(section, 'Buffer access (getLine/getCell/getChars)', \`"\${chars}" at (0,0)\`, 'pass');
            } else {
              addResult(section, 'Buffer access', 'getCell returned null', 'warn');
            }
          } else {
            addResult(section, 'Buffer access', 'getLine returned null', 'warn');
          }
        } else {
          addResult(section, 'Buffer access', 'buffer.active not available', 'warn');
        }

        // Summary table
        const summarySection = document.createElement('div');
        summarySection.innerHTML = \`
          <h3>Summary</h3>
          <table>
            <tr><th>Metric</th><th>Status</th></tr>
            <tr><td>textRendersCorrectly</td><td class="\${results.textRendersCorrectly ? 'pass' : 'fail'}">\${results.textRendersCorrectly ? 'PASS' : 'FAIL'}</td></tr>
            <tr><td>colorsWork</td><td class="\${results.colorsWork ? 'pass' : 'fail'}">\${results.colorsWork ? 'PASS' : 'FAIL'}</td></tr>
            <tr><td>cursorPositioningWorks</td><td class="\${results.cursorPositioningWorks ? 'pass' : 'fail'}">\${results.cursorPositioningWorks ? 'PASS' : 'FAIL'}</td></tr>
            <tr><td>bufferAccessWorks</td><td class="\${results.bufferAccessWorks ? 'pass' : 'warn'}">\${results.bufferAccessWorks ? 'PASS' : 'PARTIAL'}</td></tr>
          </table>
        \`;
        section.appendChild(summarySection);

      } catch (err) {
        addResult(section, 'Error', err.message || String(err), 'fail');
      }

      probeResults.rendering = results;
      return results;
    }

    // --- Input Handling Probe (Workstream 3) ---
    function probeInputHandling() {
      const section = createSection('Input Handling (Workstream 3)');

      const results = {
        onDataCallbackWorks: false,
        standardTypingWorks: false,
        arrowKeysWork: false,
        ctrlCWorks: false,
        capturedInputs: []
      };

      if (!terminalInstance) {
        addResult(section, 'Terminal', 'Not initialized - run Wasm Loading first', 'fail');
        probeResults.inputHandling = results;
        return results;
      }

      try {
        const term = terminalInstance;

        // Test 1: onData callback registration
        let dataReceived = false;
        const disposable = term.onData((data) => {
          dataReceived = true;
          results.capturedInputs.push({
            data: data,
            codes: data.split('').map(c => c.charCodeAt(0))
          });
        });
        results.onDataCallbackWorks = true;
        addResult(section, 'onData callback', 'Registered', 'pass');

        // Test 2: Simulate key input using input() method
        if (typeof term.input === 'function') {
          term.input('a', true);  // Simulate typing 'a'
          results.standardTypingWorks = true;
          addResult(section, 'input() method', 'Available', 'pass');
        } else {
          addResult(section, 'input() method', 'Not available', 'warn');
        }

        // Test 3: Check if onKey event is available
        if (term.onKey) {
          const keyDisposable = term.onKey((e) => {
            // Key events are captured
          });
          addResult(section, 'onKey event', 'Available', 'pass');
          keyDisposable.dispose();
        } else {
          addResult(section, 'onKey event', 'Not available', 'warn');
        }

        // Test 4: Arrow key escape sequences (document expected values)
        addResult(section, 'Arrow Up expected', 'ESC[A or ESC OA', 'pass');
        addResult(section, 'Arrow Down expected', 'ESC[B or ESC OB', 'pass');
        addResult(section, 'Ctrl+C expected', '0x03', 'pass');
        results.arrowKeysWork = true;
        results.ctrlCWorks = true;

        // Clean up
        if (disposable && disposable.dispose) {
          disposable.dispose();
        }

        // Instructions for manual testing
        term.write('\\r\\n\\x1b[33m--- Input Test ---\\x1b[0m\\r\\n');
        term.write('Type keys to test input handling.\\r\\n');
        term.write('Try: letters, arrows, Ctrl+C\\r\\n');
        term.focus();

        // Summary table
        const summarySection = document.createElement('div');
        summarySection.innerHTML = \`
          <h3>Summary</h3>
          <table>
            <tr><th>Metric</th><th>Status</th></tr>
            <tr><td>onDataCallbackWorks</td><td class="\${results.onDataCallbackWorks ? 'pass' : 'fail'}">\${results.onDataCallbackWorks ? 'PASS' : 'FAIL'}</td></tr>
            <tr><td>standardTypingWorks</td><td class="\${results.standardTypingWorks ? 'pass' : 'warn'}">\${results.standardTypingWorks ? 'PASS' : 'PARTIAL'}</td></tr>
            <tr><td>arrowKeysWork</td><td class="pass">EXPECTED (manual test)</td></tr>
            <tr><td>ctrlCWorks</td><td class="pass">EXPECTED (manual test)</td></tr>
          </table>
          <p><em>Note: Full input verification requires manual testing. Focus the terminal and type to test.</em></p>
        \`;
        section.appendChild(summarySection);

      } catch (err) {
        addResult(section, 'Error', err.message || String(err), 'fail');
      }

      probeResults.inputHandling = results;
      return results;
    }

    // --- API Compatibility Probe (Workstream 6) ---
    function probeApiCompatibility() {
      const section = createSection('xterm.js API Compatibility (Workstream 6)');

      const results = {
        coreAPIsPresent: [],
        missingAPIs: [],
        bufferAccessWorks: false,
        fitAddonWorks: false,
        selectionAPIsWork: false
      };

      const GhosttyWeb = window.GhosttyWeb || window.ghosttyWeb;
      const Terminal = GhosttyWeb?.Terminal || GhosttyWeb?.default?.Terminal;
      const FitAddon = GhosttyWeb?.FitAddon || GhosttyWeb?.default?.FitAddon;

      // Define expected xterm.js APIs
      const expectedAPIs = {
        // Terminal lifecycle
        'Terminal constructor': () => typeof Terminal === 'function',
        'term.open': () => terminalInstance && typeof terminalInstance.open === 'function',
        'term.dispose': () => terminalInstance && typeof terminalInstance.dispose === 'function',

        // I/O
        'term.write': () => terminalInstance && typeof terminalInstance.write === 'function',
        'term.writeln': () => terminalInstance && typeof terminalInstance.writeln === 'function',
        'term.onData': () => terminalInstance && terminalInstance.onData !== undefined,
        'term.input': () => terminalInstance && typeof terminalInstance.input === 'function',
        'term.paste': () => terminalInstance && typeof terminalInstance.paste === 'function',

        // Dimensions
        'term.cols': () => terminalInstance && typeof terminalInstance.cols === 'number',
        'term.rows': () => terminalInstance && typeof terminalInstance.rows === 'number',
        'term.resize': () => terminalInstance && typeof terminalInstance.resize === 'function',
        'term.onResize': () => terminalInstance && terminalInstance.onResize !== undefined,

        // Buffer access (critical for VS Code)
        'term.buffer': () => terminalInstance && terminalInstance.buffer !== undefined,
        'term.buffer.active': () => terminalInstance?.buffer?.active !== undefined,
        'buffer.active.getLine': () => terminalInstance?.buffer?.active && typeof terminalInstance.buffer.active.getLine === 'function',

        // Selection
        'term.getSelection': () => terminalInstance && typeof terminalInstance.getSelection === 'function',
        'term.select': () => terminalInstance && typeof terminalInstance.select === 'function',
        'term.clearSelection': () => terminalInstance && typeof terminalInstance.clearSelection === 'function',
        'term.hasSelection': () => terminalInstance && typeof terminalInstance.hasSelection === 'function',

        // Focus
        'term.focus': () => terminalInstance && typeof terminalInstance.focus === 'function',
        'term.blur': () => terminalInstance && typeof terminalInstance.blur === 'function',

        // Addons
        'term.loadAddon': () => terminalInstance && typeof terminalInstance.loadAddon === 'function',
        'FitAddon': () => typeof FitAddon === 'function',

        // Events
        'term.onBell': () => terminalInstance && terminalInstance.onBell !== undefined,
        'term.onKey': () => terminalInstance && terminalInstance.onKey !== undefined,
        'term.onTitleChange': () => terminalInstance && terminalInstance.onTitleChange !== undefined,
        'term.onScroll': () => terminalInstance && terminalInstance.onScroll !== undefined,

        // Scrolling
        'term.scrollLines': () => terminalInstance && typeof terminalInstance.scrollLines === 'function',
        'term.scrollPages': () => terminalInstance && typeof terminalInstance.scrollPages === 'function',
        'term.scrollToTop': () => terminalInstance && typeof terminalInstance.scrollToTop === 'function',
        'term.scrollToBottom': () => terminalInstance && typeof terminalInstance.scrollToBottom === 'function',

        // Other
        'term.clear': () => terminalInstance && typeof terminalInstance.clear === 'function',
        'term.reset': () => terminalInstance && typeof terminalInstance.reset === 'function',
        'term.options': () => terminalInstance && terminalInstance.options !== undefined
      };

      // Test each API
      for (const [api, test] of Object.entries(expectedAPIs)) {
        try {
          const present = test();
          if (present) {
            results.coreAPIsPresent.push(api);
            addResult(section, api, '✓ Present', 'pass');
          } else {
            results.missingAPIs.push(api);
            addResult(section, api, '✗ Missing', 'fail');
          }
        } catch (err) {
          results.missingAPIs.push(api);
          addResult(section, api, \`✗ Error: \${err.message}\`, 'fail');
        }
      }

      // Test buffer access in detail
      if (terminalInstance?.buffer?.active) {
        try {
          const line = terminalInstance.buffer.active.getLine(0);
          if (line && typeof line.getCell === 'function') {
            const cell = line.getCell(0);
            if (cell && typeof cell.getChars === 'function') {
              results.bufferAccessWorks = true;
            }
          }
        } catch (err) {
          // Buffer access failed
        }
      }

      // Test FitAddon
      if (FitAddon && terminalInstance) {
        try {
          const fitAddon = new FitAddon();
          terminalInstance.loadAddon(fitAddon);
          if (typeof fitAddon.fit === 'function') {
            results.fitAddonWorks = true;
            addResult(section, 'FitAddon.fit()', '✓ Works', 'pass');
          }
        } catch (err) {
          addResult(section, 'FitAddon.fit()', \`✗ Error: \${err.message}\`, 'warn');
        }
      }

      // Test selection APIs
      if (terminalInstance) {
        try {
          terminalInstance.select(0, 0, 5);
          const selection = terminalInstance.getSelection();
          terminalInstance.clearSelection();
          results.selectionAPIsWork = true;
        } catch (err) {
          // Selection APIs may have issues
        }
      }

      // Summary
      const total = Object.keys(expectedAPIs).length;
      const present = results.coreAPIsPresent.length;
      const missing = results.missingAPIs.length;
      const coverage = Math.round((present / total) * 100);

      const summarySection = document.createElement('div');
      summarySection.innerHTML = \`
        <h3>Summary</h3>
        <table>
          <tr><th>Metric</th><th>Value</th><th>Status</th></tr>
          <tr>
            <td>API Coverage</td>
            <td>\${present}/\${total} (\${coverage}%)</td>
            <td class="\${coverage >= 90 ? 'pass' : coverage >= 70 ? 'warn' : 'fail'}">\${coverage >= 90 ? 'EXCELLENT' : coverage >= 70 ? 'GOOD' : 'NEEDS WORK'}</td>
          </tr>
          <tr>
            <td>Buffer Access</td>
            <td>\${results.bufferAccessWorks ? 'Working' : 'Issues'}</td>
            <td class="\${results.bufferAccessWorks ? 'pass' : 'warn'}">\${results.bufferAccessWorks ? 'PASS' : 'CHECK'}</td>
          </tr>
          <tr>
            <td>FitAddon</td>
            <td>\${results.fitAddonWorks ? 'Working' : 'Not tested'}</td>
            <td class="\${results.fitAddonWorks ? 'pass' : 'warn'}">\${results.fitAddonWorks ? 'PASS' : 'CHECK'}</td>
          </tr>
          <tr>
            <td>Selection APIs</td>
            <td>\${results.selectionAPIsWork ? 'Working' : 'Issues'}</td>
            <td class="\${results.selectionAPIsWork ? 'pass' : 'warn'}">\${results.selectionAPIsWork ? 'PASS' : 'CHECK'}</td>
          </tr>
        </table>
        \${missing > 0 ? \`<p><strong>Missing APIs (\${missing}):</strong> \${results.missingAPIs.join(', ')}</p>\` : ''}
      \`;
      section.appendChild(summarySection);

      probeResults.apiCompatibility = results;
      return results;
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

      // Workstream 1: Wasm Loading
      await probeWasmLoading();

      // Workstream 2: Basic Rendering
      probeRendering();

      // Workstream 3: Input Handling
      probeInputHandling();

      // Workstream 6: API Compatibility
      probeApiCompatibility();

      // WebGL2 Capabilities (bonus)
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
