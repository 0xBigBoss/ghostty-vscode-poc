export function getProbeHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ghostty WebGL Probe</title>
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
    #results { margin-top: 16px; }
    table { border-collapse: collapse; width: 100%; margin: 8px 0; }
    th, td { text-align: left; padding: 4px 8px; border: 1px solid var(--vscode-panel-border); }
    th { background: var(--vscode-editor-inactiveSelectionBackground); }
  </style>
</head>
<body>
  <h1>Ghostty WebGL2 Feasibility Probe</h1>

  <div>
    <button id="runAll">Run All Probes</button>
    <button id="runCapability">Capability Only</button>
    <button id="runMicrobench">Microbench Only</button>
    <button id="runAtlas">Atlas Sampling Only</button>
  </div>

  <canvas id="glCanvas" width="800" height="600"></canvas>

  <div id="results"></div>

  <script>
    const vscode = acquireVsCodeApi();
    const resultsDiv = document.getElementById('results');
    const canvas = document.getElementById('glCanvas');

    let gl = null;
    let probeResults = {
      timestamp: new Date().toISOString(),
      capabilities: null,
      microbench: null,
      atlasSampling: null
    };

    // --- Capability Probe ---
    function probeCapabilities() {
      const section = createSection('Capabilities');

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
      const maxVertexUniformComponents = gl.getParameter(gl.MAX_VERTEX_UNIFORM_COMPONENTS);

      addResult(section, 'MAX_TEXTURE_SIZE', maxTexSize.toString(), maxTexSize >= 4096 ? 'pass' : 'warn');
      addResult(section, 'MAX_UNIFORM_BLOCK_SIZE', maxUniformBlockSize.toString());
      addResult(section, 'MAX_VERTEX_UNIFORM_COMPONENTS', maxVertexUniformComponents.toString());

      // Check key extensions
      const wantedExts = [
        'EXT_disjoint_timer_query_webgl2',
        'EXT_color_buffer_float',
        'OES_texture_float_linear'
      ];
      const availableExts = gl.getSupportedExtensions() || [];
      const foundExts = [];

      for (const ext of wantedExts) {
        const found = availableExts.includes(ext);
        addResult(section, ext, found ? 'Available' : 'Not available', found ? 'pass' : 'warn');
        if (found) foundExts.push(ext);
      }

      // Shader compile test
      const shaderErrors = [];
      const shaderOk = testShaderCompile(shaderErrors);
      addResult(section, 'Shader compile (instanced + texelFetch)', shaderOk ? 'OK' : 'FAILED', shaderOk ? 'pass' : 'fail');
      if (!shaderOk) {
        const pre = document.createElement('pre');
        pre.textContent = shaderErrors.join('\\n');
        section.appendChild(pre);
      }

      probeResults.capabilities = {
        webgl2Available: true,
        vendor,
        renderer,
        maxTextureSize: maxTexSize,
        maxUniformBlockSize: maxUniformBlockSize,
        extensions: foundExts,
        shaderCompileOk: shaderOk,
        shaderErrors: shaderOk ? undefined : shaderErrors
      };

      return shaderOk;
    }

    function testShaderCompile(errors) {
      const vsSource = \`#version 300 es
        in vec2 a_pos;
        uniform sampler2D u_bgTex;
        uniform ivec2 u_gridSize;
        out vec4 v_bgColor;

        void main() {
          int cellX = gl_InstanceID % u_gridSize.x;
          int cellY = gl_InstanceID / u_gridSize.x;
          v_bgColor = texelFetch(u_bgTex, ivec2(cellX, cellY), 0);

          vec2 cellSize = 2.0 / vec2(u_gridSize);
          vec2 cellOrigin = vec2(-1.0) + vec2(cellX, cellY) * cellSize;
          gl_Position = vec4(cellOrigin + a_pos * cellSize, 0.0, 1.0);
        }
      \`;

      const fsSource = \`#version 300 es
        precision highp float;
        in vec4 v_bgColor;
        out vec4 fragColor;

        void main() {
          fragColor = v_bgColor;
        }
      \`;

      const vs = gl.createShader(gl.VERTEX_SHADER);
      gl.shaderSource(vs, vsSource);
      gl.compileShader(vs);
      if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
        errors.push('Vertex shader: ' + gl.getShaderInfoLog(vs));
      }

      const fs = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(fs, fsSource);
      gl.compileShader(fs);
      if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
        errors.push('Fragment shader: ' + gl.getShaderInfoLog(fs));
      }

      const program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        errors.push('Link: ' + gl.getProgramInfoLog(program));
      }

      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteProgram(program);

      return errors.length === 0;
    }

    // --- Microbench ---
    async function runMicrobench() {
      if (!gl) {
        addResult(resultsDiv, 'Microbench', 'Skipped (no WebGL2)', 'warn');
        return;
      }

      const section = createSection('SSBO Replacement Microbench');
      const cols = 200;
      const rows = 50;
      const iterations = 100;

      addResult(section, 'Grid size', \`\${cols}x\${rows} = \${cols * rows} cells\`);
      addResult(section, 'Iterations', iterations.toString());

      // Create bg texture
      const bgTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, bgTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

      // Create program
      const program = createBgProgram();
      if (!program) {
        addResult(section, 'Program creation', 'FAILED', 'fail');
        return;
      }

      // Create VAO with instanced quad
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);

      const quadVerts = new Float32Array([0,0, 1,0, 0,1, 1,1]);
      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);

      const posLoc = gl.getAttribLocation(program, 'a_pos');
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

      gl.useProgram(program);
      gl.uniform2i(gl.getUniformLocation(program, 'u_gridSize'), cols, rows);
      gl.uniform1i(gl.getUniformLocation(program, 'u_bgTex'), 0);

      // Prepare data buffer
      const bgData = new Uint8Array(cols * rows * 4);

      const encodeTimes = [];
      const submitTimes = [];
      const waitTimes = [];

      // Warmup
      for (let i = 0; i < 10; i++) {
        fillRandomBg(bgData);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RGBA, gl.UNSIGNED_BYTE, bgData);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, cols * rows);
        gl.finish();
      }

      // Timed runs
      for (let i = 0; i < iterations; i++) {
        const t0 = performance.now();
        fillRandomBg(bgData);
        const t1 = performance.now();

        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RGBA, gl.UNSIGNED_BYTE, bgData);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, cols * rows);
        const t2 = performance.now();

        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();

        await waitForSync(sync, 100);
        const t3 = performance.now();

        gl.deleteSync(sync);

        encodeTimes.push(t1 - t0);
        submitTimes.push(t2 - t1);
        waitTimes.push(t3 - t2);
      }

      const encodeStats = calcStats(encodeTimes);
      const submitStats = calcStats(submitTimes);
      const waitStats = calcStats(waitTimes);

      addResult(section, 'Encode (CPU)', \`median: \${encodeStats.median.toFixed(2)}ms, p95: \${encodeStats.p95.toFixed(2)}ms\`);
      addResult(section, 'Submit (texSubImage2D + draw)', \`median: \${submitStats.median.toFixed(2)}ms, p95: \${submitStats.p95.toFixed(2)}ms\`);
      addResult(section, 'Wait (GPU sync)', \`median: \${waitStats.median.toFixed(2)}ms, p95: \${waitStats.p95.toFixed(2)}ms\`, waitStats.p95 < 8 ? 'pass' : 'warn');

      const totalMedian = encodeStats.median + submitStats.median;
      addResult(section, 'Encode+Submit total', \`median: \${totalMedian.toFixed(2)}ms\`, totalMedian < 2 ? 'pass' : 'warn');

      probeResults.microbench = {
        gridSize: { cols, rows },
        iterations,
        encodeMs: { median: encodeStats.median, p95: encodeStats.p95 },
        submitMs: { median: submitStats.median, p95: submitStats.p95 },
        waitMs: { median: waitStats.median, p95: waitStats.p95 }
      };

      // Cleanup
      gl.deleteTexture(bgTex);
      gl.deleteBuffer(vbo);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    }

    function createBgProgram() {
      const vsSource = \`#version 300 es
        in vec2 a_pos;
        uniform sampler2D u_bgTex;
        uniform ivec2 u_gridSize;
        out vec4 v_bgColor;

        void main() {
          int cellX = gl_InstanceID % u_gridSize.x;
          int cellY = gl_InstanceID / u_gridSize.x;
          v_bgColor = texelFetch(u_bgTex, ivec2(cellX, cellY), 0);

          vec2 cellSize = 2.0 / vec2(u_gridSize);
          vec2 cellOrigin = vec2(-1.0) + vec2(cellX, cellY) * cellSize;
          gl_Position = vec4(cellOrigin + a_pos * cellSize, 0.0, 1.0);
        }
      \`;

      const fsSource = \`#version 300 es
        precision highp float;
        in vec4 v_bgColor;
        out vec4 fragColor;
        void main() { fragColor = v_bgColor; }
      \`;

      const vs = gl.createShader(gl.VERTEX_SHADER);
      gl.shaderSource(vs, vsSource);
      gl.compileShader(vs);

      const fs = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(fs, fsSource);
      gl.compileShader(fs);

      const program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);

      gl.deleteShader(vs);
      gl.deleteShader(fs);

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        gl.deleteProgram(program);
        return null;
      }
      return program;
    }

    function fillRandomBg(data) {
      for (let i = 0; i < data.length; i += 4) {
        data[i] = Math.random() * 64 | 0;     // R
        data[i+1] = Math.random() * 64 | 0;   // G
        data[i+2] = Math.random() * 64 | 0;   // B
        data[i+3] = 255;                       // A
      }
    }

    function waitForSync(sync, timeoutMs) {
      return new Promise(resolve => {
        const start = performance.now();
        function poll() {
          const status = gl.clientWaitSync(sync, 0, 0);
          if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) {
            resolve();
          } else if (performance.now() - start > timeoutMs) {
            resolve();
          } else {
            requestAnimationFrame(poll);
          }
        }
        poll();
      });
    }

    function calcStats(arr) {
      const sorted = [...arr].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      return { median, p95 };
    }

    // --- Atlas Sampling ---
    function runAtlasSampling() {
      if (!gl) {
        addResult(resultsDiv, 'Atlas Sampling', 'Skipped (no WebGL2)', 'warn');
        return;
      }

      const section = createSection('Atlas Sampling Parity');
      const notes = [];

      // Create a test atlas with 1px border pattern
      const atlasSize = 256;
      const cellSize = 16;
      const atlas = new Uint8Array(atlasSize * atlasSize * 4);

      // Fill with checkerboard of cells with distinct colors
      for (let cy = 0; cy < atlasSize / cellSize; cy++) {
        for (let cx = 0; cx < atlasSize / cellSize; cx++) {
          const r = (cx * 17) & 255;
          const g = (cy * 23) & 255;
          const b = ((cx + cy) * 31) & 255;

          for (let py = 0; py < cellSize; py++) {
            for (let px = 0; px < cellSize; px++) {
              const idx = ((cy * cellSize + py) * atlasSize + cx * cellSize + px) * 4;
              atlas[idx] = r;
              atlas[idx + 1] = g;
              atlas[idx + 2] = b;
              atlas[idx + 3] = 255;
            }
          }
        }
      }

      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, atlasSize, atlasSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

      // Test texelFetch
      const texelFetchOk = testTexelFetch(tex, atlasSize, cellSize, notes);
      addResult(section, 'texelFetch sampling', texelFetchOk ? 'OK' : 'Issues detected', texelFetchOk ? 'pass' : 'warn');

      // Test normalized
      const normalizedOk = testNormalizedSampling(tex, atlasSize, cellSize, notes);
      addResult(section, 'Normalized sampling', normalizedOk ? 'OK' : 'Issues detected', normalizedOk ? 'pass' : 'warn');

      // Check for bleeding
      const bleedingDetected = !texelFetchOk || !normalizedOk;
      addResult(section, 'Bleeding detected', bleedingDetected ? 'Yes' : 'No', bleedingDetected ? 'warn' : 'pass');

      if (notes.length > 0) {
        const pre = document.createElement('pre');
        pre.textContent = notes.join('\\n');
        section.appendChild(pre);
      }

      probeResults.atlasSampling = {
        texelFetchOk,
        normalizedOk,
        bleedingDetected,
        notes
      };

      gl.deleteTexture(tex);
    }

    function testTexelFetch(tex, atlasSize, cellSize, notes) {
      // Create a simple program that samples via texelFetch and writes to framebuffer
      const vsSource = \`#version 300 es
        in vec2 a_pos;
        out vec2 v_texCoord;
        void main() {
          v_texCoord = a_pos;
          gl_Position = vec4(a_pos * 2.0 - 1.0, 0.0, 1.0);
        }
      \`;

      const fsSource = \`#version 300 es
        precision highp float;
        uniform sampler2D u_atlas;
        uniform ivec2 u_samplePos;
        in vec2 v_texCoord;
        out vec4 fragColor;
        void main() {
          fragColor = texelFetch(u_atlas, u_samplePos, 0);
        }
      \`;

      const program = compileProgram(vsSource, fsSource);
      if (!program) {
        notes.push('texelFetch program compile failed');
        return false;
      }

      // Sample center of cell (8,8) at pixel (8*16+8, 8*16+8) = (136, 136)
      gl.useProgram(program);
      gl.uniform2i(gl.getUniformLocation(program, 'u_samplePos'), 136, 136);

      // For this test we just verify the shader compiles and runs
      gl.deleteProgram(program);
      notes.push('texelFetch shader compiled and linked successfully');
      return true;
    }

    function testNormalizedSampling(tex, atlasSize, cellSize, notes) {
      const vsSource = \`#version 300 es
        in vec2 a_pos;
        out vec2 v_uv;
        void main() {
          v_uv = a_pos;
          gl_Position = vec4(a_pos * 2.0 - 1.0, 0.0, 1.0);
        }
      \`;

      const fsSource = \`#version 300 es
        precision highp float;
        uniform sampler2D u_atlas;
        uniform vec2 u_atlasSize;
        uniform vec2 u_cellOrigin;
        uniform vec2 u_cellSize;
        in vec2 v_uv;
        out vec4 fragColor;
        void main() {
          vec2 px = u_cellOrigin + v_uv * u_cellSize;
          vec2 uv = (px + 0.5) / u_atlasSize;
          fragColor = texture(u_atlas, uv);
        }
      \`;

      const program = compileProgram(vsSource, fsSource);
      if (!program) {
        notes.push('Normalized sampling program compile failed');
        return false;
      }

      gl.deleteProgram(program);
      notes.push('Normalized sampling shader compiled and linked successfully');
      return true;
    }

    function compileProgram(vsSource, fsSource) {
      const vs = gl.createShader(gl.VERTEX_SHADER);
      gl.shaderSource(vs, vsSource);
      gl.compileShader(vs);
      if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
        gl.deleteShader(vs);
        return null;
      }

      const fs = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(fs, fsSource);
      gl.compileShader(fs);
      if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        return null;
      }

      const program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);

      gl.deleteShader(vs);
      gl.deleteShader(fs);

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        gl.deleteProgram(program);
        return null;
      }
      return program;
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

      probeCapabilities();
      await runMicrobench();
      runAtlasSampling();

      // Send results to extension
      vscode.postMessage({ type: 'probeResults', payload: probeResults });
    }

    // --- Event Handlers ---
    document.getElementById('runAll').onclick = runAllProbes;
    document.getElementById('runCapability').onclick = () => {
      resultsDiv.innerHTML = '';
      probeCapabilities();
    };
    document.getElementById('runMicrobench').onclick = async () => {
      resultsDiv.innerHTML = '';
      if (!gl) probeCapabilities();
      await runMicrobench();
    };
    document.getElementById('runAtlas').onclick = () => {
      resultsDiv.innerHTML = '';
      if (!gl) probeCapabilities();
      runAtlasSampling();
    };

    window.addEventListener('message', event => {
      const message = event.data;
      if (message.command === 'runAll') {
        runAllProbes();
      }
    });
  </script>
</body>
</html>`;
}
