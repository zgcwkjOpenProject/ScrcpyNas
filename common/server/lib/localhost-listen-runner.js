'use strict';

const net = require('net');
const path = require('path');

const entry = process.argv[2];
const bindHost = process.env.WS_SCRCPY_BIND_HOST || '127.0.0.1';
const bindPort = parseInt(process.env.WS_SCRCPY_BIND_PORT || process.env.WS_SCRCPY_PORT || '8128', 10);

if (!entry) {
  console.error('[localhost-runner] missing engine entry');
  process.exit(1);
}

const originalListen = net.Server.prototype.listen;

// ws-scrcpy calls listen(port, callback), which binds to all interfaces on
// Linux. Patch only this child process and only the engine port
net.Server.prototype.listen = function patchedListen(...args) {
  const first = args[0];
  const second = args[1];
  const isTargetPort = Number(first) === bindPort;
  const hasExplicitHost =
    typeof second === 'string' ||
    (second && typeof second === 'object' && typeof second.host === 'string');

  if (isTargetPort && !hasExplicitHost) {
    if (typeof second === 'function') {
      return originalListen.call(this, first, bindHost, second);
    }
    return originalListen.call(this, first, bindHost, ...args.slice(1));
  }

  return originalListen.apply(this, args);
};

process.argv = [process.argv[0], entry, ...process.argv.slice(3)];
require(path.resolve(entry));
