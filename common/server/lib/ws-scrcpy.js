'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const ENGINE_BIND_HOST = process.env.WS_SCRCPY_BIND_HOST || '127.0.0.1';

function checkWsScrcpy(port) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: ENGINE_BIND_HOST, port, path: '/', timeout: 1500 },
      (res) => {
        res.resume();
        resolve(res.statusCode !== undefined);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function createWsScrcpyManager({ nodeBin, recordsFile, wsScrcpyDir, wsScrcpyPort }) {
  let wsProc = null;
  let shuttingDown = false;

  function writeEngineConfig() {
    const cfgDir = path.dirname(recordsFile);
    fs.mkdirSync(cfgDir, { recursive: true });
    const cfgPath = path.join(cfgDir, 'ws-scrcpy-config.yaml');
    const yaml = [
      'runGoogTracker: true',
      'announceGoogTracker: true',
      'server:',
      '  - secure: false',
      `    port: ${wsScrcpyPort}`,
      '',
    ].join('\n');
    fs.writeFileSync(cfgPath, yaml);
    return cfgPath;
  }

  function startWsScrcpy() {
    const rootEntry = path.join(wsScrcpyDir, 'index.js');
    const distEntry = path.join(wsScrcpyDir, 'dist', 'index.js');
    const entry = fs.existsSync(rootEntry) ? rootEntry : distEntry;
    if (!fs.existsSync(entry)) {
      console.error('[ws-scrcpy] 未找到 index.js 或 dist/index.js，投屏引擎无法启动:', wsScrcpyDir);
      return;
    }

    const cfgPath = writeEngineConfig();
    const runner = path.join(__dirname, 'localhost-listen-runner.js');
    wsProc = spawn(nodeBin, [runner, entry], {
      cwd: wsScrcpyDir,
      env: {
        ...process.env,
        WS_SCRCPY_CONFIG: cfgPath,
        WS_SCRCPY_BIND_HOST: ENGINE_BIND_HOST,
        WS_SCRCPY_BIND_PORT: String(wsScrcpyPort),
        NODE_PATH: path.join(wsScrcpyDir, 'node_modules'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    wsProc.stdout.on('data', (data) => console.log('[ws-scrcpy]', data.toString().trim()));
    wsProc.stderr.on('data', (data) => console.error('[ws-scrcpy]', data.toString().trim()));
    wsProc.on('exit', (code) => {
      console.error('[ws-scrcpy] 进程退出，code =', code);
      wsProc = null;
      if (!shuttingDown) {
        setTimeout(() => {
          if (!wsProc && !shuttingDown) startWsScrcpy();
        }, 5000);
      }
    });
  }

  function stopWsScrcpy() {
    shuttingDown = true;
    if (!wsProc) return;
    try {
      wsProc.kill('SIGTERM');
    } catch (_) {
      /* ignore */
    }
    wsProc = null;
  }

  return { checkWsScrcpy: () => checkWsScrcpy(wsScrcpyPort), startWsScrcpy, stopWsScrcpy };
}

module.exports = { checkWsScrcpy, createWsScrcpyManager };
