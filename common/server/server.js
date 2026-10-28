'use strict';

/**
 * ScrcpyNas - 编排服务
 *
 * adb、node、ws-scrcpy 全部打包在套件内，通过环境变量注入各二进制和目录路径，
 * 由 fnos/cmd/main 或 synology/package/app/start.sh 设置。
 *
 * 环境变量
 *   PORT           管理界面端口（默认 8129）
 *   WS_SCRCPY_PORT 投屏引擎端口（默认 8128）
 *   WS_SCRCPY_BIND_HOST 投屏引擎监听地址（默认 127.0.0.1）
 *   WS_SCRCPY_DIR  ws-scrcpy 引擎目录（含 index.js 或 dist/index.js）
 *   ADB_BIN        adb 可执行文件路径
 *   NODE_BIN       node 可执行文件路径（缺省用当前进程的 node）
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const {
  createAdb,
  checkTcp,
  findDevice,
  isUsbDevice,
  extractDeviceModel,
} = require('./lib/adb');
const { createSynologyAuth } = require('./lib/dsm-auth');
const { registerDsmWindowScriptRoute } = require('./lib/dsm-window');
const { readLogTail } = require('./lib/log-tail');
const { createRecordStore, makeRecordId, normalizeRecord } = require('./lib/records');
const { createRoutePaths } = require('./lib/routes');
const { registerApiRoutes } = require('./lib/api');
const { registerScrcpyProxyRoutes, createScrcpyUpgradeHandler } = require('./lib/scrcpy-proxy');
const { createWsScrcpyManager } = require('./lib/ws-scrcpy');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = parseInt(process.env.PORT || '8129', 10);
const SOCKET_PATH = (process.env.SOCKET_PATH || '').trim();
const WS_SCRCPY_DIR = process.env.WS_SCRCPY_DIR || path.join(__dirname, '..', 'engine');
const WS_SCRCPY_PORT = parseInt(process.env.WS_SCRCPY_PORT || '8128', 10);
const WS_SCRCPY_BIND_HOST = process.env.WS_SCRCPY_BIND_HOST || '127.0.0.1';
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/+$/, '');
const PLATFORM = (process.env.PLATFORM || '').trim().toLowerCase();
const ADB = process.env.ADB_BIN || 'adb';
const NODE_BIN = process.env.NODE_BIN || process.execPath;
const LOG_FILE = process.env.LOG_FILE || '';
const APP_LOG_FILE = process.env.APP_LOG_FILE || '';
const VAR_LOG_FILE = process.env.VAR_LOG_FILE || '';
const RECORDS_FILE =
  process.env.RECORDS_FILE ||
  path.join(path.dirname(VAR_LOG_FILE || APP_LOG_FILE || LOG_FILE || path.join(os.tmpdir(), 'scrcpyNas.log')), 'devices.json');

const { routeBases: ROUTE_BASES, appPath, buildProxyPath, escapeRegExp, isScrcpyPath } = createRoutePaths(BASE_PATH);
const { runAdb, parseDevices } = createAdb(ADB);
const { readRecords, writeRecords, upsertRecord } = createRecordStore(RECORDS_FILE);
const { checkWsScrcpy, startWsScrcpy, stopWsScrcpy } = createWsScrcpyManager({
  nodeBin: NODE_BIN,
  recordsFile: RECORDS_FILE,
  wsScrcpyDir: WS_SCRCPY_DIR,
  wsScrcpyPort: WS_SCRCPY_PORT,
});
const { authMiddleware, runDsmAuth, dsmAuthCgi } = createSynologyAuth({ platform: PLATFORM });

const app = express();
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});
app.use(express.json());
app.use(authMiddleware);
app.use(appPath(''), express.static(path.join(__dirname, 'public')));

if (BASE_PATH) {
  app.get(BASE_PATH, (_req, res) => res.redirect(`${BASE_PATH}/`));
}

if (PLATFORM === 'synology') {
  registerDsmWindowScriptRoute(app, appPath, __dirname);
}

registerScrcpyProxyRoutes(app, {
  appPath,
  routeBases: ROUTE_BASES,
  buildProxyPath,
  escapeRegExp,
  wsScrcpyHost: WS_SCRCPY_BIND_HOST,
  wsScrcpyPort: WS_SCRCPY_PORT,
});

// ---------------------------------------------------------------------------
// API 路由：所有 /api/* 处理器集中在 lib/api.js，依赖在此注入
// ---------------------------------------------------------------------------
registerApiRoutes(app, {
  appPath,
  runAdb,
  parseDevices,
  readRecords,
  writeRecords,
  upsertRecord,
  makeRecordId,
  normalizeRecord,
  checkWsScrcpy,
  checkTcp,
  findDevice,
  isUsbDevice,
  extractDeviceModel,
  wsScrcpyHost: WS_SCRCPY_BIND_HOST,
  wsScrcpyPort: WS_SCRCPY_PORT,
  platform: PLATFORM,
  readLogTail,
  logFile: LOG_FILE,
  appLogFile: APP_LOG_FILE,
  varLogFile: VAR_LOG_FILE,
});

// 处理进程终止信号
process.on('SIGTERM', () => {
  stopWsScrcpy();
  process.exit(0);
});

// 处理控制台中断信号
process.on('SIGINT', () => {
  stopWsScrcpy();
  process.exit(0);
});

// ---------------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------------
function prepareSocketPath(socketPath) {
  if (!socketPath || process.platform === 'win32') return;
  try {
    if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
  } catch (e) {
    console.error(`[server] 清理旧 socket 失败: ${socketPath}: ${e.message}`);
  }
}

// 监听就绪后修正 socket 权限并打印启动信息 触发 adb 探测和引擎自启
function onServerListening() {
  if (SOCKET_PATH && process.platform !== 'win32') {
    try {
      fs.chmodSync(SOCKET_PATH, 0o666);
    } catch (e) {
      console.error(`[server] 设置 socket 权限失败: ${SOCKET_PATH}: ${e.message}`);
    }
  }
  const listenAt = SOCKET_PATH && process.platform !== 'win32' ? SOCKET_PATH : `http://${HOST}:${PORT}`;
  console.log(`ScrcpyNas 编排服务已启动: ${listenAt}${BASE_PATH || ''}`);
  console.log(`adb: ${ADB}`);
  console.log(`engine: ${WS_SCRCPY_DIR} (internal ${WS_SCRCPY_BIND_HOST}:${WS_SCRCPY_PORT}, public path ${BASE_PATH || ''}/scrcpy/)`);
  console.log(`platform: ${PLATFORM || 'none'}${PLATFORM === 'synology' ? ` (DSM auth: ${dsmAuthCgi || 'unavailable'})` : ''}`);
  console.log('[adb] devices -l');
  runAdb(['devices', '-l']).then((r) => {
    console.log(`[adb] devices result code=${r.code}`);
    if (r.out) console.log(`[adb] devices out:\n${r.out}`);
    if (r.err) console.log(`[adb] devices err:\n${r.err}`);
  });
  runAdb(['start-server']).then(() => startWsScrcpy());
}

prepareSocketPath(SOCKET_PATH);
const server =
  SOCKET_PATH && process.platform !== 'win32'
    ? app.listen(SOCKET_PATH, onServerListening)
    : app.listen(PORT, HOST, onServerListening);

server.on('upgrade', createScrcpyUpgradeHandler({
  isScrcpyPath,
  buildProxyPath,
  wsScrcpyHost: WS_SCRCPY_BIND_HOST,
  wsScrcpyPort: WS_SCRCPY_PORT,
  platform: PLATFORM,
  runDsmAuth,
}));
